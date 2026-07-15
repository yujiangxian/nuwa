# SPDX-License-Identifier: MIT
"""Shared torch device helpers for Nuwa inference scripts."""
from __future__ import annotations

import os
import sys


def gpu_backend() -> str:
    """Return concrete backend: cuda | rocm | cpu | auto."""
    raw = (os.environ.get("NUWA_GPU_BACKEND") or "auto").strip().lower()
    if raw in ("cuda", "rocm", "cpu", "auto"):
        return raw
    return "auto"


def apply_backend_torch_tweaks(torch_mod) -> None:
    """Apply ROCm MIOpen workaround only when backend is rocm."""
    if gpu_backend() == "rocm":
        torch_mod.backends.cudnn.enabled = False


def resolve_torch_device(torch_mod) -> str:
    """
    Return 'cuda' or 'cpu' for model loading.

    - cpu backend → always cpu
    - cuda / rocm / auto → cuda if torch.cuda.is_available() else cpu
    """
    apply_backend_torch_tweaks(torch_mod)
    backend = gpu_backend()
    if backend == "cpu":
        return "cpu"
    if torch_mod.cuda.is_available():
        return "cuda"
    if backend in ("cuda", "rocm"):
        print(
            f"WARNING: NUWA_GPU_BACKEND={backend} but torch.cuda.is_available() "
            "is False; using CPU",
            file=sys.stderr,
        )
    return "cpu"
