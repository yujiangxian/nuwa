# Dual GPU Backend Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Nuwa resolve `cuda` / `rocm` / `cpu` at runtime, pick the matching Python venv, inject backend into ASR/TTS subprocesses, and document dual-platform setup for RTX 5070 (CUDA) and RX 9070 XT (ROCm).

**Architecture:** A small Rust `gpu_backend` util parses `NUWA_GPU_BACKEND` and probes `nvidia-smi`/`rocm-smi`. `python_exe()` prefers `envs/ai-cuda` or `envs/ai-rocm`. Inference spawns set `NUWA_GPU_BACKEND`. Python helper applies ROCm-only cudnn workaround and resolves device. Setup script + docs cover install; GpuBar shows optional `backend` label.

**Tech Stack:** Rust (Axum server), Python 3.10+ (inference scripts), PowerShell setup, React GpuBar (minimal).

**Spec:** `docs/superpowers/specs/2026-07-15-gpu-backend-compat-design.md`

---

## File map

| File | Responsibility |
|------|----------------|
| `backend/server/src/util/gpu_backend.rs` | Parse override, detect SMI, resolve concrete backend, python candidate paths |
| `backend/server/src/util/mod.rs` | Re-export; `python_exe()` delegates to gpu_backend |
| `backend/server/src/services/inference.rs` | Inject env on all 3 Python spawns |
| `backend/server/src/handlers/system.rs` | Probe order by backend; add `backend` field to `GpuInfo` |
| `backend/server/src/main.rs` | Log resolved backend + python path at startup |
| `scripts/nuwa_torch_device.py` | Shared: apply ROCm cudnn patch; return `"cuda"` or `"cpu"` |
| `scripts/inference_asr_*.py`, `inference_tts_*.py` (production only) | Use helper instead of unconditional cudnn disable |
| `scripts/setup_local_ai.ps1` | Create vendor venv + install PyTorch |
| `docs/nvidia_cuda_setup.md` | NVIDIA / Blackwell setup + light VRAM policy |
| `README.md`, `docs/architecture/overview.md`, `docs/rx9070xt_ai_setup.md`, `AGENTS.md`, `CONTRIBUTING.md`, `docs/voxcpm_deployment.md` | Dual-GPU docs |
| `app/web/src/lib/modelTypes.ts`, `GpuBar.tsx` | Optional `backend` display |

Out of scope (do not touch): showcase `_run_*.py` scripts, Ollama proxy logic, VRAM hot-swap.

---

### Task 1: Rust `GpuBackend` parse + path candidates (unit tests first)

**Files:**
- Create: `backend/server/src/util/gpu_backend.rs`
- Modify: `backend/server/src/util/mod.rs`
- Test: unit tests inside `gpu_backend.rs`

- [ ] **Step 1: Write failing tests for parse + python candidates**

Create `backend/server/src/util/gpu_backend.rs` with tests only first (types + `parse_override` / `python_candidates` stubs that `unimplemented!()` or wrong behavior):

```rust
// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

//! GPU backend resolution: NUWA_GPU_BACKEND override + SMI detection + Python venv paths.

use std::path::{Path, PathBuf};
use std::process::Command;

/// Concrete (or requested) GPU backend.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GpuBackend {
    Cuda,
    Rocm,
    Cpu,
}

impl GpuBackend {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Cuda => "cuda",
            Self::Rocm => "rocm",
            Self::Cpu => "cpu",
        }
    }
}

/// Parse `NUWA_GPU_BACKEND` value. Returns `None` for unset/empty/`auto`.
/// Invalid values return `None` (caller treats as auto) — tests cover this.
pub fn parse_override(raw: Option<&str>) -> Option<GpuBackend> {
    let _ = raw;
    None // intentionally wrong until Step 3
}

/// Ordered Python executable candidates for a concrete backend under `root`.
pub fn python_candidates(root: &Path, backend: GpuBackend) -> Vec<PathBuf> {
    let _ = (root, backend);
    Vec::new()
}

/// Pick first existing candidate, else `python` / `python3` fallbacks.
pub fn resolve_python_exe(root: &Path, backend: GpuBackend) -> PathBuf {
    for c in python_candidates(root, backend) {
        if c.exists() {
            return c;
        }
    }
    PathBuf::from("python")
}

/// Sync probe: nvidia-smi then rocm-smi (used by detect).
pub fn smi_available(tool: &str) -> bool {
    Command::new(tool)
        .arg("--help")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Auto-detect concrete backend. Prefer CUDA when both present.
pub fn detect_backend() -> GpuBackend {
    if smi_available("nvidia-smi") {
        return GpuBackend::Cuda;
    }
    if smi_available("rocm-smi") {
        return GpuBackend::Rocm;
    }
    GpuBackend::Cpu
}

/// Resolve: override if concrete; else detect. `auto`/invalid/unset → detect.
pub fn resolve_backend() -> GpuBackend {
    match parse_override(std::env::var("NUWA_GPU_BACKEND").ok().as_deref()) {
        Some(b) => b,
        None => detect_backend(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn parse_override_accepts_cuda_rocm_cpu_case_insensitive() {
        assert_eq!(parse_override(Some("cuda")), Some(GpuBackend::Cuda));
        assert_eq!(parse_override(Some("ROCM")), Some(GpuBackend::Rocm));
        assert_eq!(parse_override(Some("Cpu")), Some(GpuBackend::Cpu));
    }

    #[test]
    fn parse_override_auto_empty_invalid_are_none() {
        assert_eq!(parse_override(None), None);
        assert_eq!(parse_override(Some("")), None);
        assert_eq!(parse_override(Some("auto")), None);
        assert_eq!(parse_override(Some("  auto  ")), None);
        assert_eq!(parse_override(Some("vulkan")), None);
    }

    #[test]
    fn python_candidates_cuda_prefers_ai_cuda_then_ai() {
        let root = PathBuf::from("C:/proj");
        let c = python_candidates(&root, GpuBackend::Cuda);
        assert_eq!(
            c[0],
            root.join("envs/ai-cuda/Scripts/python.exe")
        );
        assert_eq!(c[1], root.join("envs/ai/Scripts/python.exe"));
        assert!(c.iter().any(|p| p == &root.join("ai_env/Scripts/python.exe")));
    }

    #[test]
    fn python_candidates_rocm_prefers_ai_rocm() {
        let root = PathBuf::from("C:/proj");
        let c = python_candidates(&root, GpuBackend::Rocm);
        assert_eq!(c[0], root.join("envs/ai-rocm/Scripts/python.exe"));
        assert_eq!(c[1], root.join("envs/ai/Scripts/python.exe"));
    }

    #[test]
    fn python_candidates_cpu_skips_vendor_venvs() {
        let root = PathBuf::from("C:/proj");
        let c = python_candidates(&root, GpuBackend::Cpu);
        assert_eq!(c[0], root.join("envs/ai/Scripts/python.exe"));
        assert!(!c.iter().any(|p| p.to_string_lossy().contains("ai-cuda")));
        assert!(!c.iter().any(|p| p.to_string_lossy().contains("ai-rocm")));
    }
}
```

Wire module in `util/mod.rs` — add at top after existing imports section:

```rust
pub mod gpu_backend;
```

Keep existing `python_exe()` for now (Task 2 changes it).

- [ ] **Step 2: Run tests — expect parse/candidates FAIL**

Run: `cd backend/server && cargo test --lib util::gpu_backend::tests -- --nocapture`

Expected: FAIL (parse returns `None`, candidates empty).

- [ ] **Step 3: Implement `parse_override` and `python_candidates`**

Replace stubs:

```rust
pub fn parse_override(raw: Option<&str>) -> Option<GpuBackend> {
    let s = raw?.trim();
    if s.is_empty() {
        return None;
    }
    match s.to_ascii_lowercase().as_str() {
        "auto" => None,
        "cuda" => Some(GpuBackend::Cuda),
        "rocm" => Some(GpuBackend::Rocm),
        "cpu" => Some(GpuBackend::Cpu),
        other => {
            tracing::warn!(value = other, "Invalid NUWA_GPU_BACKEND; treating as auto");
            None
        }
    }
}

pub fn python_candidates(root: &Path, backend: GpuBackend) -> Vec<PathBuf> {
    let mut out = Vec::new();
    match backend {
        GpuBackend::Cuda => {
            out.push(root.join("envs/ai-cuda/Scripts/python.exe"));
            out.push(root.join("envs/ai-cuda/bin/python"));
        }
        GpuBackend::Rocm => {
            out.push(root.join("envs/ai-rocm/Scripts/python.exe"));
            out.push(root.join("envs/ai-rocm/bin/python"));
        }
        GpuBackend::Cpu => {}
    }
    out.push(root.join("envs/ai/Scripts/python.exe"));
    out.push(root.join("envs/ai/bin/python"));
    out.push(root.join("ai_env/Scripts/python.exe"));
    out.push(root.join("ai_env/bin/python"));
    out
}
```

- [ ] **Step 4: Re-run tests — expect PASS**

Run: `cd backend/server && cargo test --lib util::gpu_backend::tests`

Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/server/src/util/gpu_backend.rs backend/server/src/util/mod.rs
git commit -m "feat(backend): add GpuBackend parse and Python venv candidate paths"
```

---

### Task 2: Wire `python_exe()` + startup log + inference env injection

**Files:**
- Modify: `backend/server/src/util/mod.rs`
- Modify: `backend/server/src/services/inference.rs`
- Modify: `backend/server/src/main.rs`

- [ ] **Step 1: Replace `python_exe()` in `util/mod.rs`**

```rust
/// Returns the Python executable path for the resolved GPU backend.
pub fn python_exe() -> PathBuf {
    let backend = gpu_backend::resolve_backend();
    gpu_backend::resolve_python_exe(&project_root(), backend)
}
```

- [ ] **Step 2: Add helper on Command in `inference.rs`**

Near top of `inference.rs` after imports:

```rust
use crate::util::gpu_backend::{self, GpuBackend};

fn apply_inference_env(cmd: &mut tokio::process::Command) -> GpuBackend {
    let backend = gpu_backend::resolve_backend();
    cmd.env("NUWA_GPU_BACKEND", backend.as_str());
    if backend == GpuBackend::Cuda {
        // Do not override if user already set CUDA_VISIBLE_DEVICES
        if std::env::var_os("CUDA_VISIBLE_DEVICES").is_none() {
            cmd.env("CUDA_VISIBLE_DEVICES", "0");
        }
    }
    backend
}
```

Update each of the three `Command::new(util::python_exe())` blocks to:

```rust
let mut cmd = tokio::process::Command::new(util::python_exe());
let backend = apply_inference_env(&mut cmd);
tracing::info!(backend = backend.as_str(), "inference Python env");
// then .arg(...) chain on cmd, then .output()
```

Apply to `transcribe`, `synthesize`, and `synthesize_script`.

- [ ] **Step 3: Log at startup in `main.rs`**

After tracing subscriber init (or near first info log), add:

```rust
{
    use nuwa_server::util::{self, gpu_backend};
    let backend = gpu_backend::resolve_backend();
    let py = util::python_exe();
    tracing::info!(
        backend = backend.as_str(),
        python = %py.display(),
        "GPU backend resolved"
    );
}
```

(Adjust crate name if binary uses different path — match existing `use` style in `main.rs`.)

- [ ] **Step 4: Compile check**

Run: `cd backend/server && cargo test --lib util::gpu_backend::tests && cargo check`

Expected: success.

- [ ] **Step 5: Commit**

```bash
git add backend/server/src/util/mod.rs backend/server/src/services/inference.rs backend/server/src/main.rs
git commit -m "feat(backend): select Python venv by GPU backend and inject NUWA_GPU_BACKEND"
```

---

### Task 3: GPU info API prefers active backend + `backend` field

**Files:**
- Modify: `backend/server/src/handlers/system.rs`
- Modify: `app/web/src/lib/modelTypes.ts`
- Modify: `app/web/src/components/models/GpuBar.tsx`

- [ ] **Step 1: Extend `GpuInfo` and `query_gpu_info`**

```rust
#[derive(serde::Serialize)]
pub struct GpuInfo {
    pub name: String,
    pub total_vram_mb: u64,
    pub used_vram_mb: u64,
    pub free_vram_mb: u64,
    pub usage_percent: f64,
    /// Resolved Nuwa GPU backend: "cuda" | "rocm" | "cpu"
    pub backend: String,
}

async fn query_gpu_info() -> Option<GpuInfo> {
    use crate::util::gpu_backend::{self, GpuBackend};
    let backend = gpu_backend::resolve_backend();
    let attach = |mut info: GpuInfo| {
        info.backend = backend.as_str().to_string();
        Some(info)
    };

    match backend {
        GpuBackend::Cuda => {
            if let Some(info) = query_nvidia_smi().await {
                return attach(info);
            }
            if let Some(info) = query_rocm_smi().await {
                return attach(info);
            }
        }
        GpuBackend::Rocm => {
            if let Some(info) = query_rocm_smi().await {
                return attach(info);
            }
            if let Some(info) = query_nvidia_smi().await {
                return attach(info);
            }
        }
        GpuBackend::Cpu => {
            tracing::info!("GPU backend is cpu; skipping SMI");
            return None;
        }
    }
    tracing::info!("No GPU detected via SMI for backend={}", backend.as_str());
    None
}
```

Update `query_rocm_smi` / `query_nvidia_smi` constructors to include `backend: String::new()` (filled by `attach`).

- [ ] **Step 2: Frontend type + GpuBar label**

`modelTypes.ts`:

```ts
export interface GpuInfo {
  name: string;
  total_vram_mb: number;
  used_vram_mb: number;
  free_vram_mb: number;
  usage_percent: number;
  backend?: string;
}
```

In `GpuBar.tsx`, next to the name span, if `gpuInfo.backend`:

```tsx
{gpuInfo.backend && (
  <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded"
        style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
    {gpuInfo.backend}
  </span>
)}
```

- [ ] **Step 3: `cargo check` + frontend typecheck if available**

Run: `cd backend/server && cargo check`  
Run: `cd app/web && npx tsc --noEmit` (or project’s usual check; skip if too heavy — at least ensure TS compiles in CI later).

- [ ] **Step 4: Commit**

```bash
git add backend/server/src/handlers/system.rs app/web/src/lib/modelTypes.ts app/web/src/components/models/GpuBar.tsx
git commit -m "feat: prefer active GPU backend for SMI and show backend on GpuBar"
```

---

### Task 4: Python `nuwa_torch_device` helper + production inference scripts

**Files:**
- Create: `scripts/nuwa_torch_device.py`
- Modify: `scripts/inference_asr_paraformer.py`, `scripts/inference_asr_whisper.py`, `scripts/inference_tts_cosyvoice.py`, `scripts/inference_tts_gptsovits.py`, `scripts/inference_tts_glm.py`, `scripts/inference_tts_glm_script.py`

- [ ] **Step 1: Create helper**

```python
# SPDX-License-Identifier: MIT
"""Shared torch device helpers for Nuwa inference scripts."""
from __future__ import annotations

import os
import sys
from pathlib import Path


def _ensure_scripts_on_path() -> None:
    scripts = Path(__file__).resolve().parent
    s = str(scripts)
    if s not in sys.path:
        sys.path.insert(0, s)


def gpu_backend() -> str:
    """Return concrete backend: cuda | rocm | cpu (default auto→cuda if available else cpu)."""
    raw = (os.environ.get("NUWA_GPU_BACKEND") or "auto").strip().lower()
    if raw in ("cuda", "rocm", "cpu"):
        return raw
    return "auto"


def apply_backend_torch_tweaks(torch_mod) -> None:
    """ROCm MIOpen workaround only when backend is rocm."""
    if gpu_backend() == "rocm":
        torch_mod.backends.cudnn.enabled = False


def resolve_torch_device(torch_mod) -> str:
    """
    Return 'cuda' or 'cpu' for model loading.
    - cpu backend → always cpu
    - cuda/rocm/auto → cuda if torch.cuda.is_available() else cpu
    """
    apply_backend_torch_tweaks(torch_mod)
    backend = gpu_backend()
    if backend == "cpu":
        return "cpu"
    if torch_mod.cuda.is_available():
        return "cuda"
    if backend in ("cuda", "rocm"):
        print(
            f"WARNING: NUWA_GPU_BACKEND={backend} but torch.cuda.is_available() is False; using CPU",
            file=sys.stderr,
        )
    return "cpu"
```

- [ ] **Step 2: Update Paraformer (pattern for ASR)**

Replace:

```python
import torch
torch.backends.cudnn.enabled = False
```

With:

```python
import torch
from nuwa_torch_device import resolve_torch_device
_DEVICE = resolve_torch_device(torch)
```

And use `device=_DEVICE` in `AutoModel(...)`.

Same for Whisper.

- [ ] **Step 3: Update CosyVoice / GPT-SoVITS**

CosyVoice: remove unconditional cudnn line; set `use_gpu = resolve_torch_device(torch) == "cuda"`.

GPT-SoVITS: `'device': resolve_torch_device(torch)`.

- [ ] **Step 4: Update GLM TTS scripts**

After `import torch`, call `resolve_torch_device(torch)` (applies ROCm tweak) and set `_GPU = (resolve_torch_device(torch) == "cuda")` — or call once:

```python
from nuwa_torch_device import resolve_torch_device
_DEVICE = resolve_torch_device(torch)
_GPU = _DEVICE == "cuda"
```

Keep existing CPU monkey-patch when `not _GPU`.

- [ ] **Step 5: Smoke-import helper**

Run: `python -c "import sys; sys.path.insert(0, 'scripts'); from nuwa_torch_device import resolve_torch_device; print('ok')"`

From repo root. Expected: `ok`.

- [ ] **Step 6: Commit**

```bash
git add scripts/nuwa_torch_device.py scripts/inference_asr_paraformer.py scripts/inference_asr_whisper.py scripts/inference_tts_cosyvoice.py scripts/inference_tts_gptsovits.py scripts/inference_tts_glm.py scripts/inference_tts_glm_script.py
git commit -m "feat(scripts): shared torch device helper with ROCm-only cudnn workaround"
```

---

### Task 5: `scripts/setup_local_ai.ps1`

**Files:**
- Create: `scripts/setup_local_ai.ps1`

- [ ] **Step 1: Write setup script**

```powershell
# SPDX-License-Identifier: MIT
# Creates envs/ai-cuda | envs/ai-rocm | envs/ai and installs matching PyTorch.
param(
    [ValidateSet("auto", "cuda", "rocm", "cpu")]
    [string]$Backend = $(if ($env:NUWA_GPU_BACKEND) { $env:NUWA_GPU_BACKEND } else { "auto" })
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

function Test-Smi($name) {
    try { & $name --help *> $null; return ($LASTEXITCODE -eq 0) } catch { return $false }
}

function Resolve-Backend([string]$b) {
    $b = $b.Trim().ToLowerInvariant()
    if ($b -eq "auto" -or $b -eq "") {
        if (Test-Smi "nvidia-smi") { return "cuda" }
        if (Test-Smi "rocm-smi") { return "rocm" }
        return "cpu"
    }
    return $b
}

$Resolved = Resolve-Backend $Backend
Write-Host "Resolved GPU backend: $Resolved"

$VenvRel = switch ($Resolved) {
    "cuda" { "envs\ai-cuda" }
    "rocm" { "envs\ai-rocm" }
    default { "envs\ai" }
}
$Venv = Join-Path $Root $VenvRel
$Py = Join-Path $Venv "Scripts\python.exe"

if (-not (Test-Path $Py)) {
    Write-Host "Creating venv at $VenvRel ..."
    New-Item -ItemType Directory -Force -Path (Split-Path $Venv) | Out-Null
    python -m venv $Venv
}

& $Py -m pip install --upgrade pip
switch ($Resolved) {
    "cuda" {
        # Blackwell / RTX 5070: CUDA 12.8 wheels
        & $Py -m pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128
    }
    "rocm" {
        & $Py -m pip install --index-url https://rocm.nightlies.amd.com/v2-staging/gfx120X-all/ torch torchvision torchaudio
    }
    default {
        & $Py -m pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu
    }
}

Write-Host "Verifying torch..."
& $Py -c "import torch; print(torch.__version__); print(torch.cuda.is_available()); print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'NO_GPU')"

Write-Host ""
Write-Host "Next:"
Write-Host "  set NUWA_GPU_BACKEND=$Resolved   # optional override"
if ($Resolved -eq "cuda") {
    Write-Host "  Install CUDA-enabled Ollama; see docs/nvidia_cuda_setup.md"
} elseif ($Resolved -eq "rocm") {
    Write-Host "  Configure ROCBLAS_TENSILE_LIBPATH; see docs/rx9070xt_ai_setup.md"
}
Write-Host "Done. Venv: $VenvRel"
```

- [ ] **Step 2: Dry-run help / syntax check**

Run: `powershell -NoProfile -Command "& { $null = [System.Management.Automation.Language.Parser]::ParseFile('scripts/setup_local_ai.ps1', [ref]$null, [ref]$errs); if ($errs) { $errs; exit 1 } else { 'parse ok' } }"`

Expected: `parse ok`.

- [ ] **Step 3: Commit**

```bash
git add scripts/setup_local_ai.ps1
git commit -m "feat(scripts): add setup_local_ai.ps1 for CUDA/ROCm/CPU venvs"
```

---

### Task 6: Documentation

**Files:**
- Create: `docs/nvidia_cuda_setup.md`
- Modify: `README.md`, `docs/architecture/overview.md`, `docs/rx9070xt_ai_setup.md`, `AGENTS.md`, `CONTRIBUTING.md`, `docs/voxcpm_deployment.md`

- [ ] **Step 1: Write `docs/nvidia_cuda_setup.md`**

Include: RTX 5070 / Blackwell needs PyTorch ≥2.7 + cu128; run `.\scripts\setup_local_ai.ps1 -Backend cuda`; `NUWA_GPU_BACKEND`; Ollama CUDA install; light VRAM strategy A (LLM GPU, ASR/TTS CPU if 8GB tight); link to `docs/voxcpm_deployment.md`.

- [ ] **Step 2: Update README tech stack + local env + docs table**

- LLM: `Ollama (CUDA 或 ROCm)`  
- GPU: `AMD RX 9070 XT (ROCm) / NVIDIA RTX 5070 (CUDA)`  
- Local env: list both; point to `setup_local_ai.ps1`  
- Docs table: add `nvidia_cuda_setup.md`

- [ ] **Step 3: Update architecture overview constraints**

Target: Windows PC with AMD ROCm **or** NVIDIA CUDA. Dual with DCU remains aspirational note only if already present — do not expand DCU scope.

- [ ] **Step 4: Cross-links**

- `rx9070xt_ai_setup.md` top: link to `setup_local_ai.ps1` and `nvidia_cuda_setup.md`  
- `voxcpm_deployment.md`: note strategy A is default light VRAM policy for ≤8GB; link nvidia setup  
- `AGENTS.md`: document `envs/ai-cuda`, `envs/ai-rocm`, `NUWA_GPU_BACKEND`, `nuwa_torch_device.py`  
- `CONTRIBUTING.md`: prerequisites mention vendor venvs + setup script

- [ ] **Step 5: Commit**

```bash
git add docs/nvidia_cuda_setup.md README.md docs/architecture/overview.md docs/rx9070xt_ai_setup.md AGENTS.md CONTRIBUTING.md docs/voxcpm_deployment.md
git commit -m "docs: dual GPU setup for NVIDIA CUDA and AMD ROCm"
```

---

### Task 7: Verification pass

**Files:** none new

- [ ] **Step 1: Backend tests**

Run: `cd backend/server && cargo test --lib util::gpu_backend::tests`

Expected: PASS.

- [ ] **Step 2: Full backend `cargo test` if time permits**

Run: `cd backend/server && cargo test`

Expected: PASS (or pre-existing failures noted, not introduced by this work).

- [ ] **Step 3: Manual note for operator (this machine RTX 5070)**

Document in commit message / PR that operator should run:

```powershell
.\scripts\setup_local_ai.ps1 -Backend cuda
$env:NUWA_GPU_BACKEND = "cuda"
cd backend/server; cargo run
# GET http://localhost:8080/api/system/gpu → NVIDIA name + backend cuda
```

- [ ] **Step 4: Final commit only if docs/verification notes added; else skip empty commit**

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| `gpu_backend` auto/cuda/rocm/cpu + `NUWA_GPU_BACKEND` | 1–2 |
| Prefer nvidia when both SMI present | 1 (`detect_backend`) |
| `envs/ai-cuda` / `ai-rocm` then `ai` | 1–2 |
| Inject env into ASR/TTS | 2 |
| ROCm-only cudnn disable | 4 |
| GPU API probe order + optional backend field | 3 |
| Setup script | 5 |
| Docs dual platform + light VRAM | 6 |
| No hot-swap / no Ollama code change | out of scope |
| Startup log | 2 |

## Self-review notes

- No TBD placeholders in task steps.
- Type names consistent: `GpuBackend::{Cuda,Rocm,Cpu}`, `as_str()` → `"cuda"|"rocm"|"cpu"`.
- Showcase `_run_*.py` intentionally untouched (YAGNI).
- `smi_available("nvidia-smi")` using `--help` may return non-zero on some installs; if detection flakes in practice, follow-up: try `nvidia-smi -L` / `rocm-smi` with no args — implementers may adjust `smi_available` to accept exit code 0 **or** executable found via `where`.
