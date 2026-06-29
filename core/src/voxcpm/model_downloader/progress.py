"""进度报告：支持 tqdm、Rich、回调函数。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from tqdm import tqdm


@dataclass
class ProgressInfo:
    """下载进度快照。"""

    downloaded: int      # 已下载字节
    total: int           # 总字节
    speed: float         # 当前速度（字节/秒）
    eta: float           # 预计剩余时间（秒）
    threads_active: int  # 活跃线程数

    @property
    def percent(self) -> float:
        return (self.downloaded / self.total * 100) if self.total else 0.0


ProgressCallback = Callable[[ProgressInfo], None]


class TqdmProgressBar:
    """基于 tqdm 的进度条实现。"""

    def __init__(self, total: int, desc: str = "Downloading"):
        self.bar = tqdm(total=total, unit="B", unit_scale=True, desc=desc)
        self._last_downloaded = 0

    def update(self, info: ProgressInfo) -> None:
        delta = info.downloaded - self._last_downloaded
        if delta > 0:
            self.bar.update(delta)
            self._last_downloaded = info.downloaded
        self.bar.set_postfix(
            speed=f"{info.speed / 1024 / 1024:.1f} MB/s",
            eta=f"{info.eta:.0f}s",
            threads=info.threads_active,
        )

    def close(self) -> None:
        self.bar.close()


class RichProgressReporter:
    """基于 Rich 的进度报告（适用于嵌入 Tauri 前端或 CI 环境）。"""

    def __init__(self, total: int, desc: str = "Downloading"):
        self.total = total
        self.desc = desc
        self._last_downloaded = 0

    def update(self, info: ProgressInfo) -> None:
        # Rich 的 Live 渲染可以在这里接入
        pct = info.percent
        bar = "█" * int(pct // 5) + "░" * (20 - int(pct // 5))
        print(
            f"\r{self.desc} [{bar}] {pct:.1f}% "
            f"{info.speed / 1024 / 1024:.1f} MB/s ETA {info.eta:.0f}s",
            end="",
            flush=True,
        )
        self._last_downloaded = info.downloaded

    def close(self) -> None:
        print()
