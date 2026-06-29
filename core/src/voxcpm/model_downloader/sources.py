"""下载源管理：支持 HuggingFace / HF-Mirror / ModelScope / 直链。"""

from __future__ import annotations

import urllib.parse
from dataclasses import dataclass
from typing import Iterator


@dataclass(frozen=True)
class DownloadSource:
    """单个下载源配置。"""

    name: str
    base_url: str
    # 是否需要替换 repo_id 的格式，例如 HF: "owner/repo" -> "owner/repo/resolve/main/file"
    resolve_pattern: str | None = None

    def resolve(self, repo_id: str, filename: str, revision: str = "main") -> str:
        """将 repo_id + filename 解析为完整 URL。"""
        if self.resolve_pattern:
            path = self.resolve_pattern.format(
                repo_id=repo_id,
                filename=filename,
                revision=revision,
            )
            return urllib.parse.urljoin(self.base_url, path)
        # 直链模式：repo_id 本身就是完整 URL
        return repo_id


# 预置源
HUGGINGFACE = DownloadSource(
    name="huggingface",
    base_url="https://huggingface.co",
    resolve_pattern="{repo_id}/resolve/{revision}/{filename}",
)

HF_MIRROR = DownloadSource(
    name="hf-mirror",
    base_url="https://hf-mirror.com",
    resolve_pattern="{repo_id}/resolve/{revision}/{filename}",
)

MODELSCOPE = DownloadSource(
    name="modelscope",
    base_url="https://www.modelscope.cn",
    resolve_pattern="models/{repo_id}/resolve/{revision}/{filename}",
)

DIRECT = DownloadSource(
    name="direct",
    base_url="",
)

DEFAULT_SOURCES = [HF_MIRROR, MODELSCOPE, HUGGINGFACE]


class SourceChain:
    """多源 fallback 链：主源失败时自动切换备用源。"""

    def __init__(self, sources: list[DownloadSource] | None = None):
        self.sources = sources or DEFAULT_SOURCES.copy()

    def add_mirror(self, url: str) -> None:
        """动态添加镜像源。"""
        self.sources.insert(0, DownloadSource(name="custom", base_url=url.rstrip("/")))

    def iter_urls(self, repo_id: str, filename: str = "", revision: str = "main") -> Iterator[str]:
        """按优先级 yield 所有可能的下载 URL。

        支持两种模式：
        1. repo_id 为 "owner/repo" 格式 -> 按 resolve_pattern 拼接
        2. repo_id 为完整 URL -> 做域名替换 fallback
        """
        # 模式 2：完整 URL，提取路径后换域名
        if repo_id.startswith(("http://", "https://")):
            parsed = urllib.parse.urlparse(repo_id)
            for src in self.sources:
                if src.name == "direct":
                    yield repo_id
                else:
                    mirror_url = urllib.parse.urljoin(src.base_url, parsed.path)
                    if parsed.query:
                        mirror_url += "?" + parsed.query
                    yield mirror_url
            return

        # 模式 1：repo_id + filename 拼接
        for src in self.sources:
            yield src.resolve(repo_id, filename, revision)

    def __repr__(self) -> str:
        return f"SourceChain({[s.name for s in self.sources]})"
