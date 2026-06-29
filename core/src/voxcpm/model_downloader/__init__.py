"""生产级模型下载器：多线程分片、断点续传、自动重试、多源切换。"""

from .downloader import ChunkedDownloader, download

__all__ = ["ChunkedDownloader", "download"]
