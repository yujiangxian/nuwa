# Design: Dual GPU Backend Compatibility (AMD ROCm + NVIDIA CUDA)

**Date:** 2026-07-15  
**Status:** Approved for planning  
**Goal:** Let the same Nuwa codebase run on AMD RX 9070 XT (ROCm) and NVIDIA RTX 5070 (CUDA / Blackwell) without forking install or inference paths.

---

## 1. Problem

Nuwa today is **operationally** tied to AMD RX 9070 XT + ROCm via docs and setup assumptions, while runtime code is largely vendor-agnostic:

- LLM: HTTP proxy to Ollama (GPU chosen by Ollama install, not Nuwa).
- ASR/TTS: Python subprocesses using `torch.cuda.is_available()` and a single `envs/ai/` venv.
- GPU monitor: probes `rocm-smi` first, then `nvidia-smi`.
- ROCm-specific workaround (`torch.backends.cudnn.enabled = False`) is applied unconditionally in inference scripts.

A machine with RTX 5070 needs:

1. CUDA 12.8+ / PyTorch ≥ 2.7 (Blackwell SM 12.0).
2. Correct Python venv selection.
3. ROCm-only workarounds **not** applied on NVIDIA.
4. Docs and install scripts that describe both platforms.
5. Light VRAM guidance for ~8GB cards (no full model hot-swap in this scope).

---

## 2. Goals and Non-Goals

### Goals

- First-class `gpu_backend`: `auto | cuda | rocm | cpu`.
- Auto-detect via `nvidia-smi` / `rocm-smi`, overridable by `NUWA_GPU_BACKEND`.
- Python resolution prefers `envs/ai-cuda/` or `envs/ai-rocm/`, then falls back to `envs/ai/`.
- Inject backend into inference subprocesses; condition ROCm workarounds.
- GPU info API prefers the active backend’s SMI tool.
- Setup script + README / architecture docs for dual platforms.
- Document light VRAM strategy for 8GB NVIDIA (align with existing `docs/voxcpm_deployment.md` strategy A).

### Non-Goals

- LLM ↔ TTS VRAM hot-swap / eviction orchestration.
- Large frontend GPU picker redesign (optional display of detected backend only if cheap).
- New DCU / `torch.npu` abstraction.
- Changing Ollama’s internal GPU selection (docs only).
- Guaranteeing every third-party model wheel works on Blackwell (verify PyTorch; document fallbacks).

---

## 3. Decisions (locked)

| Topic | Decision |
|-------|----------|
| Scope | Dual-machine compatibility (B), light VRAM docs only |
| Selection | Auto-detect + `NUWA_GPU_BACKEND` override (C) |
| Venv layout | Prefer `envs/ai-cuda/` / `envs/ai-rocm/`; else `envs/ai/` (C) |
| Approach | Runtime abstraction (detect → resolve Python → inject env), not docs-only and not full GPU orchestrator |
| Dual SMI present | Prefer `cuda` unless override says otherwise |

---

## 4. Architecture

```text
┌─────────────────────────────────────────────────────────┐
│  NUWA_GPU_BACKEND=auto|cuda|rocm|cpu                    │
└───────────────────────────┬─────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────┐
│  Rust: resolve_gpu_backend()                            │
│    auto → nvidia-smi? → cuda                            │
│         → rocm-smi?   → rocm                            │
│         → else        → cpu                             │
└───────────────────────────┬─────────────────────────────┘
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
 python_exe()         inference spawn      /api/system/gpu
 ai-cuda|ai-rocm|ai   inject env vars      prefer matching SMI
        │                   │
        ▼                   ▼
   Ollama (external)   inference_*.py
   CUDA or ROCm build  conditional cudnn off; device=cuda|cpu
```

### 4.1 Backend resolution

New module or functions (suggested location: `backend/server/src/util/gpu_backend.rs` or extend `util/mod.rs`):

```text
enum GpuBackend { Auto, Cuda, Rocm, Cpu }

fn parse_override(env: Option<&str>) -> Option<GpuBackend>  // from NUWA_GPU_BACKEND
async fn detect_gpu_backend() -> GpuBackend                  // probe SMI tools
fn resolve_gpu_backend() -> GpuBackend                       // override or detect; Auto collapses to concrete
```

Rules:

1. If `NUWA_GPU_BACKEND` is set to `cuda|rocm|cpu`, use it (invalid values → log warn, treat as `auto`).
2. If unset or `auto`: try `nvidia-smi` (success → `cuda`), else `rocm-smi` (success → `rocm`), else `cpu`.
3. Log once at startup: resolved backend + python path.

### 4.2 Python executable resolution

Update `util::python_exe()` (or `python_exe_for(backend)`):

| Resolved backend | Candidate order |
|------------------|-----------------|
| `cuda` | `envs/ai-cuda/Scripts/python.exe` → `envs/ai/Scripts/python.exe` → `ai_env/...` → `python` |
| `rocm` | `envs/ai-rocm/Scripts/python.exe` → `envs/ai/Scripts/python.exe` → `ai_env/...` → `python` |
| `cpu` | `envs/ai/Scripts/python.exe` → `ai_env/...` → `python` (do not require vendor venv) |

Also consider Unix-style `bin/python` if present (for future non-Windows; Windows remains primary).

### 4.3 Inference subprocess environment

In `services/inference.rs`, when spawning ASR/TTS Python:

- Set `NUWA_GPU_BACKEND=<resolved>` (concrete: `cuda|rocm|cpu`).
- Optionally set `CUDA_VISIBLE_DEVICES=0` only when backend is `cuda` and not already set (do not override user).
- Do **not** invent ROCm path env vars in Rust; document them for AMD hosts.

Python scripts:

- Read `NUWA_GPU_BACKEND`.
- Apply `torch.backends.cudnn.enabled = False` **only when backend is `rocm`**.
- Device selection:
  - `cpu` → force CPU.
  - `cuda` / `rocm` → use `cuda` if `torch.cuda.is_available()` else CPU + clear log/warning.
- Prefer a small shared helper (e.g. `scripts/nuwa_torch_device.py` or inline helper duplicated minimally) to avoid drift across `inference_*.py`.

### 4.4 GPU monitoring API

Update `query_gpu_info()`:

1. Resolve backend (same rules as above).
2. If `cuda` → `nvidia-smi` first; if fail, optionally try `rocm-smi`.
3. If `rocm` → `rocm-smi` first; if fail, optionally try `nvidia-smi`.
4. If `cpu` → return `None` (or attempt either SMI only for display if cheap — prefer `None` for honesty).

Optional response field (if low cost): `backend: "cuda"|"rocm"|"cpu"` so the UI can show which path is active. Keep existing `GpuInfo` fields; additive field only.

### 4.5 Setup script

Add `scripts/setup_local_ai.ps1` (referenced historically, missing from repo):

1. Detect GPU (same heuristics as Rust: nvidia-smi / rocm-smi).
2. Honor `-Backend cuda|rocm|cpu` and/or `$env:NUWA_GPU_BACKEND`.
3. Create target venv:
   - cuda → `envs/ai-cuda`
   - rocm → `envs/ai-rocm`
   - cpu → `envs/ai`
4. Install PyTorch:
   - **CUDA (RTX 5070 / Blackwell):** `torch` with CUDA 12.8 index (e.g. `cu128`), target ≥ 2.7.x; print verify command.
   - **ROCm:** existing gfx120X nightly index from `docs/rx9070xt_ai_setup.md`.
   - **CPU:** CPU wheels from pytorch.org.
5. Install remaining AI deps needed by current ASR/TTS scripts (align with AGENTS.md / existing docs; keep list maintainable).
6. Print next steps for Ollama (CUDA vs ROCm).

Verification snippet (script end):

```powershell
python -c "import torch; print(torch.__version__, torch.cuda.is_available(), torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'NO_GPU')"
```

### 4.6 Documentation

| Doc | Change |
|-----|--------|
| `README.md` | Tech stack: dual GPU; link setup script; keep AMD as one tested target, add NVIDIA RTX 5070 |
| `docs/architecture/overview.md` | Target hardware: AMD ROCm **or** NVIDIA CUDA |
| `docs/rx9070xt_ai_setup.md` | Keep as AMD deep-dive; cross-link to generic setup |
| New or short `docs/nvidia_cuda_setup.md` | CUDA 12.8, Blackwell notes, Ollama CUDA, venv path, VRAM strategy A pointer |
| `docs/voxcpm_deployment.md` | Cross-link; mark strategy A as default light VRAM policy for 8GB |
| `AGENTS.md` / `CONTRIBUTING.md` | Mention `envs/ai-cuda` / `envs/ai-rocm` and `NUWA_GPU_BACKEND` |

Light VRAM policy (document only):

- Default recommendation on ≤8GB NVIDIA: LLM on GPU (Ollama); ASR/TTS may use CPU if VRAM tight.
- No automatic eviction in this design.

### 4.7 Frontend (minimal)

- No required UI redesign.
- If `GpuInfo` gains `backend`, show a small label on Models / GpuBar (“CUDA” / “ROCm” / “CPU”).
- Do not wire dead `AppConfig.backend` for inference in this design (optional follow-up: rename/document as unused or remove later).

---

## 5. Error Handling

| Case | Behavior |
|------|----------|
| Invalid `NUWA_GPU_BACKEND` | Warn, fall back to auto-detect |
| Vendor venv missing | Fall back to `envs/ai/`, then system Python; log which path was chosen |
| Backend `cuda`/`rocm` but `torch.cuda.is_available()` false | Run on CPU with explicit warning in script JSON/stderr |
| Both SMI tools missing | Backend `cpu`; GPU API returns `None` |
| Setup script on unsupported GPU | Fail with clear message pointing to docs |

---

## 6. Testing

- Unit-test backend parsing and candidate path ordering (Rust), with mocked env / paths where feasible.
- Manual on RTX 5070: setup script → `torch.cuda.is_available()==True` → one ASR + one TTS smoke + `/api/system/gpu` shows NVIDIA name.
- Manual on AMD (or CI skip if no hardware): confirm ROCm path still selected when override/`rocm-smi` present; cudnn disable still applied only under `rocm`.
- Regression: with `NUWA_GPU_BACKEND=cpu`, scripts do not require GPU.

---

## 7. Rollout

1. Rust util + inference env injection + GPU probe order.
2. Python script helper / conditional ROCm workaround.
3. `setup_local_ai.ps1` + verify printout.
4. Docs / README updates.
5. Optional GpuBar backend label.

---

## 8. Success Criteria

- On RTX 5070: dedicated or fallback venv with working CUDA PyTorch; Nuwa resolves `cuda`; ASR/TTS can use GPU when VRAM allows.
- On RX 9070 XT: existing ROCm workflow still works; ROCm workarounds still applied.
- Override `NUWA_GPU_BACKEND=cpu|cuda|rocm` always wins over detection.
- README no longer claims the project is AMD-only.
