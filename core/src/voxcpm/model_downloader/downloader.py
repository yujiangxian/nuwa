"""生产级多线程分片下载器。

核心特性：
- 多线程 Range 分片下载，每个 chunk 独立连接
- JSON 元数据断点续传（.download 文件）
- 速度监控 + 慢速连接自动重建
- 多源 fallback（HF / HF-Mirror / ModelScope）
- 校验和验证
"""

from __future__ import annotations

import json
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Callable

import httpx

from .progress import ProgressInfo, TqdmProgressBar
from .sources import SourceChain
from .verify import ChecksumVerifier, parse_checksum_string


@dataclass
class Chunk:
    """单个下载分片的状态。"""

    index: int
    start: int
    end: int
    downloaded: int = 0
    status: str = "pending"  # pending / downloading / done / failed
    source_index: int = 0    # 当前使用的源索引
    last_speed: float = 0.0  # 最近测得的速度（字节/秒）
    last_update_time: float = field(default_factory=time.time)
    last_update_bytes: int = 0

    @property
    def size(self) -> int:
        return self.end - self.start + 1

    @property
    def remaining(self) -> int:
        return self.size - self.downloaded

    def is_slow(self, threshold: float, window: float) -> bool:
        """检查该 chunk 是否长期处于低速状态。"""
        if self.status != "downloading":
            return False
        elapsed = time.time() - self.last_update_time
        if elapsed < window:
            return False
        return self.last_speed < threshold


class ChunkedDownloader:
    """多线程分片下载器。"""

    def __init__(
        self,
        url: str,
        dest: str | Path,
        *,
        threads: int = 16,
        chunk_size: int = 8 * 1024 * 1024,  # 8MB
        mirrors: list[str] | None = None,
        checksum: str | None = None,
        on_progress: Callable[[ProgressInfo], None] | None = None,
        min_speed: float = 1 * 1024 * 1024,  # 1 MB/s
        speed_window: float = 15.0,          # 15 秒
        max_retries: int = 5,
        timeout: float = 60.0,
    ):
        self.url = url
        self.dest = Path(dest)
        self.threads = threads
        self.chunk_size = chunk_size
        self.min_speed = min_speed
        self.speed_window = speed_window
        self.max_retries = max_retries
        self.timeout = timeout

        # 多源管理
        self.source_chain = SourceChain()
        if mirrors:
            for m in mirrors:
                self.source_chain.add_mirror(m)

        # 校验
        parsed = parse_checksum_string(checksum)
        self.verifier = (
            ChecksumVerifier(algorithm=parsed[0], expected=parsed[1])
            if parsed else None
        )

        # 进度回调
        self._progress_callback = on_progress
        self._progress_lock = threading.Lock()
        self._downloaded_total = 0
        self._total_size = 0
        self._start_time = 0.0

        # 元数据文件
        self._meta_path = self.dest.with_suffix(self.dest.suffix + ".download")

        # 运行时状态
        self._chunks: list[Chunk] = []
        self._cancelled = False
        self._lock = threading.Lock()

    # ------------------------------------------------------------------
    # 公开 API
    # ------------------------------------------------------------------

    def download(self) -> Path:
        """执行下载，返回最终文件路径。"""
        # 1. 探测文件信息
        self._probe()

        # 2. 准备本地文件
        self._prepare_file()

        # 3. 加载或创建分片计划
        self._load_or_create_chunks()

        # 4. 启动下载
        self._start_time = time.time()
        self._run_download()

        # 5. 校验
        if self.verifier and not self.verifier.verify(self.dest):
            raise RuntimeError("文件校验和验证失败")

        # 6. 清理元数据
        if self._meta_path.exists():
            self._meta_path.unlink()

        return self.dest

    def cancel(self) -> None:
        """取消下载。"""
        self._cancelled = True

    # ------------------------------------------------------------------
    # 内部实现
    # ------------------------------------------------------------------

    def _probe(self) -> None:
        """通过 HEAD 请求获取文件大小和 Range 支持情况。"""
        urls = list(self.source_chain.iter_urls(self.url, ""))
        last_err = None
        for url in urls:
            try:
                with httpx.Client(timeout=self.timeout, follow_redirects=True) as client:
                    resp = client.head(url)
                    resp.raise_for_status()
                    self._total_size = int(resp.headers.get("content-length", 0))
                    self._accept_ranges = resp.headers.get("accept-ranges", "none") != "none"
                    self._effective_url = url
                    return
            except Exception as e:
                last_err = e
                continue
        raise RuntimeError(f"无法探测文件信息: {last_err}")

    def _prepare_file(self) -> None:
        """创建或截断目标文件。"""
        self.dest.parent.mkdir(parents=True, exist_ok=True)
        if not self.dest.exists():
            # 预分配空文件（有助于随机写入）
            with self.dest.open("wb") as f:
                if self._total_size:
                    f.truncate(self._total_size)

    def _load_or_create_chunks(self) -> None:
        """从元数据文件恢复分片状态，或创建新的分片计划。"""
        if self._meta_path.exists():
            try:
                raw = json.loads(self._meta_path.read_text(encoding="utf-8"))
                self._chunks = [Chunk(**c) for c in raw["chunks"]]
                self._downloaded_total = sum(c.downloaded for c in self._chunks)
                # 把未完成的 chunk 重置为 pending
                for c in self._chunks:
                    if c.status == "downloading":
                        c.status = "pending"
                return
            except Exception:
                pass  # 元数据损坏，重新创建

        # 新建分片
        if not self._accept_ranges or self._total_size == 0:
            # 不支持 Range，单 chunk 流式下载
            self._chunks = [Chunk(index=0, start=0, end=self._total_size - 1)]
        else:
            self._chunks = []
            idx = 0
            pos = 0
            while pos < self._total_size:
                end = min(pos + self.chunk_size - 1, self._total_size - 1)
                self._chunks.append(Chunk(index=idx, start=pos, end=end))
                pos = end + 1
                idx += 1

        self._save_meta()

    def _save_meta(self) -> None:
        """持久化分片状态到元数据文件。"""
        payload = {
            "url": self.url,
            "dest": str(self.dest),
            "total_size": self._total_size,
            "chunks": [asdict(c) for c in self._chunks],
        }
        tmp = self._meta_path.with_suffix(".download.tmp")
        tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(self._meta_path)

    def _run_download(self) -> None:
        """主下载循环：线程池 + 慢速监控。"""
        bar = None
        if self._progress_callback is None:
            bar = TqdmProgressBar(total=self._total_size, desc=self.dest.name)
            self._progress_callback = bar.update

        try:
            with ThreadPoolExecutor(max_workers=self.threads) as pool:
                # 持续提交未完成的 chunk，直到全部完成或取消
                futures: dict = {}
                while not self._cancelled:
                    # 提交新的 pending chunk
                    for chunk in self._chunks:
                        if chunk.status == "pending":
                            future = pool.submit(self._download_chunk, chunk)
                            futures[future] = chunk
                            chunk.status = "downloading"

                    if not futures:
                        break  # 全部完成

                    # 等待任意一个 future 完成，同时做慢速检测
                    done, _ = wait_with_timeout(futures.keys(), timeout=2.0)
                    for fut in done:
                        chunk = futures.pop(fut)
                        try:
                            fut.result()
                            chunk.status = "done"
                        except Exception:
                            chunk.status = "failed"
                            chunk.source_index += 1  # 下次换源

                    # 慢速连接重建
                    self._rebuild_slow_chunks(pool, futures)

                    # 更新进度
                    self._report_progress(len(futures))
                    self._save_meta()

                if self._cancelled:
                    raise KeyboardInterrupt("下载已取消")
        finally:
            if bar:
                bar.close()

    def _download_chunk(self, chunk: Chunk) -> None:
        """下载单个分片。"""
        if self._cancelled:
            return

        # 选择源
        urls = list(self.source_chain.iter_urls(self.url, ""))
        url = urls[chunk.source_index % len(urls)]

        headers = {}
        if self._accept_ranges:
            range_start = chunk.start + chunk.downloaded
            headers["Range"] = f"bytes={range_start}-{chunk.end}"

        with httpx.Client(timeout=self.timeout, follow_redirects=True) as client:
            with client.stream("GET", url, headers=headers) as resp:
                resp.raise_for_status()
                with self.dest.open("r+b") as f:
                    f.seek(chunk.start + chunk.downloaded)
                    for data in resp.iter_bytes(chunk_size=64 * 1024):
                        if self._cancelled:
                            with self._lock:
                                chunk.status = "pending"
                            return
                        f.write(data)
                        with self._lock:
                            chunk.downloaded += len(data)
                            self._downloaded_total += len(data)

                        # 更新速度统计
                        now = time.time()
                        delta = now - chunk.last_update_time
                        if delta >= 1.0:
                            bytes_delta = chunk.downloaded - chunk.last_update_bytes
                            chunk.last_speed = bytes_delta / delta
                            chunk.last_update_time = now
                            chunk.last_update_bytes = chunk.downloaded

    def _rebuild_slow_chunks(self, pool: ThreadPoolExecutor, futures: dict) -> None:
        """检测慢速连接，取消并重新提交。"""
        to_cancel = []
        for fut, chunk in futures.items():
            if chunk.is_slow(self.min_speed, self.speed_window):
                to_cancel.append((fut, chunk))

        for fut, chunk in to_cancel:
            # 取消旧 future
            fut.cancel()
            chunk.status = "pending"
            # 换到下一个源
            chunk.source_index += 1
            # 清理 future 引用
            if fut in futures:
                del futures[fut]

    def _report_progress(self, active_futures: int = 0) -> None:
        """触发进度回调。"""
        if not self._progress_callback:
            return
        elapsed = time.time() - self._start_time
        speed = self._downloaded_total / elapsed if elapsed > 0 else 0
        remaining = self._total_size - self._downloaded_total
        eta = remaining / speed if speed > 0 else 0

        info = ProgressInfo(
            downloaded=self._downloaded_total,
            total=self._total_size,
            speed=speed,
            eta=eta,
            threads_active=active_futures,
        )
        self._progress_callback(info)


# ----------------------------------------------------------------------
# 辅助函数
# ----------------------------------------------------------------------

def wait_with_timeout(futures, timeout: float):
    """兼容 Python 3.10 的 as_completed 超时等待。"""
    from concurrent.futures import wait, FIRST_COMPLETED
    if not futures:
        return set(), set()
    done, pending = wait(futures, timeout=timeout, return_when=FIRST_COMPLETED)
    return done, pending


def download(
    url: str,
    dest: str | Path,
    *,
    threads: int = 16,
    chunk_size: int = 8 * 1024 * 1024,
    mirrors: list[str] | None = None,
    checksum: str | None = None,
    on_progress: Callable[[ProgressInfo], None] | None = None,
    **kwargs,
) -> Path:
    """便捷函数：一键下载。"""
    dl = ChunkedDownloader(
        url=url,
        dest=dest,
        threads=threads,
        chunk_size=chunk_size,
        mirrors=mirrors,
        checksum=checksum,
        on_progress=on_progress,
        **kwargs,
    )
    return dl.download()
