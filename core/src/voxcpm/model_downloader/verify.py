"""文件校验：SHA256 / MD5 / 文件大小。"""

from __future__ import annotations

import hashlib
from pathlib import Path


class ChecksumVerifier:
    """校验和验证器。"""

    SUPPORTED_ALGORITHMS = {"sha256", "md5", "sha1"}

    def __init__(self, algorithm: str = "sha256", expected: str | None = None):
        algorithm = algorithm.lower().replace("-", "")
        if algorithm not in self.SUPPORTED_ALGORITHMS:
            raise ValueError(f"不支持的校验算法: {algorithm}")
        self.algorithm = algorithm
        self.expected = expected

    def compute(self, filepath: Path | str, chunk_size: int = 8192 * 1024) -> str:
        """计算文件的校验和。"""
        hasher = hashlib.new(self.algorithm)
        path = Path(filepath)
        with path.open("rb") as f:
            while chunk := f.read(chunk_size):
                hasher.update(chunk)
        return hasher.hexdigest()

    def verify(self, filepath: Path | str) -> bool:
        """验证文件校验和是否匹配。"""
        if not self.expected:
            return True
        actual = self.compute(filepath)
        return actual.lower() == self.expected.lower()

    def verify_size(self, filepath: Path | str, expected_size: int) -> bool:
        """验证文件大小。"""
        actual_size = Path(filepath).stat().st_size
        return actual_size == expected_size


def parse_checksum_string(checksum_str: str | None) -> tuple[str, str] | None:
    """解析 'sha256:abc123...' 格式的校验字符串。"""
    if not checksum_str:
        return None
    if ":" not in checksum_str:
        return ("sha256", checksum_str)
    algo, value = checksum_str.split(":", 1)
    return (algo, value)
