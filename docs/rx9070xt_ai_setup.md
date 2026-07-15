RX 9070 XT 本地 AI 环境部署指南 (纯 Windows 11)
================================================================================

> 通用安装脚本：`.\scripts\setup_local_ai.ps1 -Backend rocm`（venv：`envs/ai-rocm/`）  
> NVIDIA / RTX 5070 请看：[`nvidia_cuda_setup.md`](nvidia_cuda_setup.md)

硬件: AMD RX 9070 XT 16GB GDDR6 (gfx1201, RDNA 4)
目标: 部署 Gemma 4 E4B (LLM) + GPT-SoVITS (TTS) + Whisper (ASR)
参考: PTT PC_Shopping trfmk1 心得 + ROCm/TheRock 官方文档

================================================================================
一、环境概览
================================================================================

组件                    用途                    GPU 后端
─────────────────────────────────────────────────────────
Ollama + ROCm           Gemma 4 E4B LLM 推理    ROCm (HIP)
PyTorch ROCm (TheRock)  GPT-SoVITS 推理          ROCm (HIP)
PyTorch ROCm (TheRock)  Whisper 语音识别         ROCm (HIP) 或 CPU
─────────────────────────────────────────────────────────

显存预算 (16GB VRAM):
  Gemma 4 E4B Q4_K_M:  ~5.5-6 GB
  GPT-SoVITS 推理:     ~2-3 GB
  Whisper small:        ~1 GB
  合计:                 ~8.5-10 GB → 16GB 绑绑有余，可同时驻留

================================================================================
二、前置安装 (需手动)
================================================================================

1. AMD 显卡驱动 (确保最新)
   https://www.amd.com/en/support

2. AMD PyTorch on Windows 预览驱动
   https://www.amd.com/en/resources/support-articles/release-notes/RN-AMDGPU-WINDOWS-PYTORCH-PREVIEW.html

3. AMD HIP SDK (最新版)
   https://www.amd.com/zh-tw/developer/resources/rocm-hub/hip-sdk.html
   安装后检查: C:\Program Files\AMD\ROCm\<version>\bin\rocblas\library\
   应包含 gfx1201 相关文件

4. MSVC x64 运行时
   https://learn.microsoft.com/zh-tw/cpp/windows/latest-supported-vc-redist

5. Ollama
   https://ollama.com/download

================================================================================
三、PyTorch ROCm 环境 (用于 GPT-SoVITS / Whisper)
================================================================================

使用 ROCm/TheRock 团队提供的 nightly PyTorch 包，专门支持 gfx120X。


# 创建虚拟环境
python -m venv ai_env
ai_env\Scripts\Activate

# 安装 PyTorch ROCm (TheRock nightly, gfx120X)
uv pip install --index-url https://rocm.nightlies.amd.com/v2-staging/gfx120X-all/ torch torchvision torchaudio

# 验证
python -c "import torch; print(torch.__version__); print(torch.cuda.is_available()); print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'NO GPU')"

# 升级 PyTorch ROCm (后续更新时)
uv pip install --upgrade --index-url https://rocm.nightlies.amd.com/v2-staging/gfx120X-all/ torch torchvision torchaudio

================================================================================
四、Ollama 配置 (用于 Gemma 4 E4B)
================================================================================

安装 Ollama 后，需要让它找到 gfx1201 的 ROCm 库。

1. 设置环境变量 (系统级):
   ROCBLAS_TENSILE_LIBPATH = C:\Program Files\AMD\ROCm\<version>\bin\rocblas\library

2. 重启 Ollama

3. 拉取模型:
   ollama pull gemma4:e4b

4. 验证 GPU 识别:
   检查日志: C:\Users\<USER>\AppData\Local\Ollama\server.log
   应看到: library=ROCm compute=gfx1201 name="AMD Radeon RX 9070 XT"

================================================================================
五、已知问题与解决方案
================================================================================

1. MIOpen Bug (9070 XT 特有)
   症状: GPU 核心满载后崩溃驱动
   解决: 在代码中添加 torch.backends.cudnn.enabled = False
   注意: ComfyUI/SD.Next 已自动处理，GPT-SoVITS 需手动添加

2. Flash Attention 不可用
   Windows ROCm 下无法使用 Flash Attention
   影响不大，GPT-SoVITS 和 Whisper 推理不依赖它

3. 偶发 OOM
   16GB 对我们的场景足够，但如果同时加载多个大模型可能触发
   解决: 使用模型量化 + 分时加载

4. ROCm 7 Windows 版仍为预览状态
   可能存在稳定性问题，建议保存工作频繁

================================================================================
六、环境变量汇总
================================================================================

ROCBLAS_TENSILE_LIBPATH = C:\Program Files\AMD\ROCm\<version>\bin\rocblas\library
TORCH_ROCM_AOTRITON_ENABLE_EXPERIMENTAL = 1

================================================================================
七、部署脚本
================================================================================

自动化部署脚本: scripts/setup_local_ai.ps1
验证脚本: scripts/verify_local_ai.py
