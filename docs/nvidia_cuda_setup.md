# NVIDIA CUDA 环境部署（RTX 5070 / Blackwell）

本文说明如何在 **NVIDIA GPU**（尤其是 RTX 5070 / Blackwell SM 12.0）上运行 Nuwa，并与 AMD ROCm 机器共用同一套代码。

通用安装脚本：[`scripts/setup_local_ai.ps1`](../scripts/setup_local_ai.ps1)  
AMD 深挖文档：[`rx9070xt_ai_setup.md`](rx9070xt_ai_setup.md)  
显存策略（8GB）：[`voxcpm_deployment.md`](voxcpm_deployment.md)

---

## 1. 硬件注意点

| 项目 | 说明 |
|------|------|
| 架构 | Blackwell (SM 12.0) 需要 **PyTorch ≥ 2.7** + **CUDA 12.8** wheels（`cu128`） |
| 显存 | RTX 5070 Laptop 常见约 **8GB**，不宜默认「大 LLM + 大 TTS」同驻 |
| 探测 | Nuwa 通过 `nvidia-smi` 自动选择 `cuda`；可用 `NUWA_GPU_BACKEND` 覆盖 |

---

## 2. 一键安装 AI 虚拟环境

在仓库根目录：

```powershell
.\scripts\setup_local_ai.ps1 -Backend cuda
# 或依赖自动检测：
.\scripts\setup_local_ai.ps1
```

脚本会创建 `envs/ai-cuda/`，并安装 `torch` / `torchvision` / `torchaudio`（cu128）。

验证：

```powershell
.\envs\ai-cuda\Scripts\python.exe -c "import torch; print(torch.__version__, torch.cuda.is_available(), torch.cuda.get_device_name(0))"
```

期望：`True` 与 GPU 名称（如 `NVIDIA GeForce RTX 5070 ...`）。

可选：

```powershell
$env:NUWA_GPU_BACKEND = "cuda"   # 强制；也可用 cpu / rocm / auto
```

---

## 3. Ollama（LLM）

安装 **CUDA 版** Ollama（官方 Windows 安装包即可），然后：

```powershell
ollama pull gemma4:e4b
```

Nuwa 只 HTTP 代理到 `localhost:11434`，不负责选择 Ollama 的 GPU 后端。

---

## 4. 轻量显存策略（≤8GB，默认建议）

与 `voxcpm_deployment.md` **策略 A** 对齐：

| 组件 | 建议 |
|------|------|
| LLM（Ollama） | GPU |
| ASR / TTS | 显存紧张时用 CPU，或串行使用 GPU（本阶段不做自动热切换） |

强制 ASR/TTS 走 CPU 时：

```powershell
$env:NUWA_GPU_BACKEND = "cpu"
```

（注意：这也会让后端选择 `envs/ai/` 而非 `envs/ai-cuda/`。）

若只想限制可见 GPU 设备，可设 `CUDA_VISIBLE_DEVICES`（Nuwa 在未设置时默认注入 `0`）。

---

## 5. 与 AMD 机器的差异

| | NVIDIA (本页) | AMD ROCm |
|--|---------------|----------|
| venv | `envs/ai-cuda/` | `envs/ai-rocm/` |
| PyTorch | cu128 | gfx120X nightly |
| ROCm cudnn workaround | 不启用 | 启用（`NUWA_GPU_BACKEND=rocm`） |
| SMI | `nvidia-smi` | `rocm-smi` |

同一仓库、同一后端：启动时会打日志 `GPU backend resolved backend=... python=...`。
