"""model_downloader 实战测试：下载真实文件验证多线程 + 断点续传。"""

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from voxcpm.model_downloader import ChunkedDownloader

# 测试文件：约 90MB，适合验证多线程分片
TEST_URL = "https://hf-mirror.com/sentence-transformers/paraphrase-MiniLM-L6-v2/resolve/main/pytorch_model.bin"
TEST_DEST = Path("_test_download_pytorch_model.bin")


def test_full_download():
    """测试完整下载。"""
    print("=" * 60)
    print("Test 1: 完整多线程下载 (16 threads)")
    print("=" * 60)

    if TEST_DEST.exists():
        TEST_DEST.unlink()
    meta = TEST_DEST.with_suffix(TEST_DEST.suffix + ".download")
    if meta.exists():
        meta.unlink()

    dl = ChunkedDownloader(
        url=TEST_URL,
        dest=TEST_DEST,
        threads=16,
        chunk_size=4 * 1024 * 1024,  # 4MB 分片，方便观察多线程
        min_speed=512 * 1024,         # 512KB/s 阈值
        speed_window=10,
    )

    def on_progress(info):
        print(
            f"\r{info.percent:5.1f}% | "
            f"{info.speed / 1024 / 1024:5.1f} MB/s | "
            f"ETA {info.eta:4.0f}s | "
            f"threads {info.threads_active:2d}",
            end="",
            flush=True,
        )

    dl._progress_callback = on_progress
    start = time.time()
    dl.download()
    elapsed = time.time() - start
    print(f"\n[OK] 完成，耗时 {elapsed:.1f}s，均速 {TEST_DEST.stat().st_size / 1024 / 1024 / elapsed:.1f} MB/s")


def test_resume():
    """测试断点续传：先下一半，中断，再续传。"""
    print("\n" + "=" * 60)
    print("Test 2: 断点续传（模拟中断后恢复）")
    print("=" * 60)

    # 先删掉目标文件，保留元数据（模拟中断）
    if TEST_DEST.exists():
        TEST_DEST.unlink()

    # 先启动一次下载，2 秒后强制中断
    dl1 = ChunkedDownloader(
        url=TEST_URL,
        dest=TEST_DEST,
        threads=16,
        chunk_size=4 * 1024 * 1024,
    )

    def brief_progress(info):
        print(f"\r首次下载: {info.percent:.1f}% | {info.speed / 1024 / 1024:.1f} MB/s", end="", flush=True)

    dl1._progress_callback = brief_progress

    # 在后台线程启动下载，主线程 3 秒后取消
    import threading

    def do_download():
        try:
            dl1.download()
        except KeyboardInterrupt:
            pass

    t = threading.Thread(target=do_download)
    t.start()
    time.sleep(3)
    dl1.cancel()
    t.join(timeout=5)
    print("\n[STOP] 已模拟中断")

    # 记录中断时的进度
    meta = TEST_DEST.with_suffix(TEST_DEST.suffix + ".download")
    if meta.exists():
        import json
        meta_data = json.loads(meta.read_text(encoding="utf-8"))
        downloaded = sum(c["downloaded"] for c in meta_data["chunks"])
        total = meta_data["total_size"]
        print(f"   中断时进度: {downloaded / total * 100:.1f}% ({downloaded / 1024 / 1024:.1f} MB / {total / 1024 / 1024:.1f} MB)")

    # 重新启动下载（断点续传）
    print("   3 秒后启动断点续传...")
    time.sleep(1)

    dl2 = ChunkedDownloader(
        url=TEST_URL,
        dest=TEST_DEST,
        threads=16,
        chunk_size=4 * 1024 * 1024,
    )

    def resume_progress(info):
        print(f"\r续传下载: {info.percent:.1f}% | {info.speed / 1024 / 1024:.1f} MB/s", end="", flush=True)

    dl2._progress_callback = resume_progress
    start = time.time()
    dl2.download()
    elapsed = time.time() - start
    print(f"\n[OK] 续传完成，续传阶段耗时 {elapsed:.1f}s")


def cleanup():
    """清理测试文件。"""
    for f in [TEST_DEST, TEST_DEST.with_suffix(TEST_DEST.suffix + ".download")]:
        if f.exists():
            f.unlink()
    print("\n[CLEAN] 测试文件已清理")


if __name__ == "__main__":
    try:
        test_full_download()
        test_resume()
    finally:
        cleanup()
