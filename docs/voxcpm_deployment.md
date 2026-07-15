# VoxCPM 部署策略与集成方案

本文档记录将 VoxCPM 作为项目首选 TTS 的部署策略，覆盖本地 CPU 验证与笔记本 RTX 5070 8G 部署两个阶段。

> **轻量显存默认策略**：≤8GB NVIDIA 上优先采用下文 **策略 A**（LLM GPU + TTS/ASR CPU）。  
> 通用 CUDA 安装见 [`nvidia_cuda_setup.md`](nvidia_cuda_setup.md)；脚本：`.\scripts\setup_local_ai.ps1 -Backend cuda`。

---

## 1. 硬件与模型搭配评估

### 1.1 笔记本 RTX 5070 8G 约束

| 资源 | 容量 | 瓶颈分析 |
|------|------|---------|
| 显存 | **8GB** | 核心瓶颈，无法同时承载大 LLM + 大 TTS |
| 内存 | 32GB | 充裕，可支撑 CPU fallback |
| GPU 架构 | Blackwell (SM 12.0) | 需 PyTorch ≥2.7 + CUDA 12.8 |

### 1.2 推荐模型搭配

| 组件 | 推荐模型 | VRAM 占用 | 说明 |
|------|---------|-----------|------|
| LLM | `gemma4:e4b` (Ollama Q4) | ~4.5GB | 多模态，8GB 显存最佳搭档 |
| TTS | **VoxCPM 0.5B** | ~3-4GB | 零样本克隆，情感丰富 |
| ASR | Whisper small / SenseVoice-Small | CPU 运行 | 不抢显存 |

> 注意：VoxCPM **不支持 ASR**，无法替代 Whisper。ASR 保持现有方案或升级 SenseVoice。

---

## 2. 显存部署策略

### 策略 A：LLM GPU + TTS CPU（⭐ 推荐，先实行）

| 组件 | 运行位置 | 显存占用 | 内存占用 |
|------|---------|---------|---------|
| Gemma 4 E4B | GPU | ~4.5GB | 少量 |
| VoxCPM 0.5B | **CPU** | 0 | ~2GB |
| Whisper ASR | CPU | 0 | ~1GB |

- **优点**：系统简单稳定，绝不 OOM，对话流畅
- **缺点**：TTS 非实时，10 秒语音约需 10-20 秒生成（CPU）
- **适用**：验证质量、日常对话、对延迟不敏感场景

### 策略 B：GPU 串行热切换（追求速度）

| 阶段 | GPU 模型 | 操作 |
|------|---------|------|
| 对话思考 | Gemma 4 E4B | 常驻显存 |
| 语音合成前 | 卸载 Gemma → 加载 VoxCPM | 切换 2-3 秒 |
| 语音合成 | VoxCPM 0.5B | GPU 全速，RTF ~0.3-0.5 |
| 合成完毕 | 卸载 VoxCPM → 加载 Gemma | 切换 2-3 秒 |

- **优点**：两者都享受 GPU 加速，TTS 接近实时
- **缺点**：切换有冷启动延迟，需代码管理显存生命周期
- **适用**：对 TTS 速度要求高、可接受合成前等待的场景

### 策略 C：双模型同驻 GPU（⚠️ 极限，不推荐）

尝试 Gemma E4B (4.5GB) + VoxCPM 0.5B (3GB) 同时驻留，总计逼近 8GB 上限。
- 长文本/长语音时极易 OOM
- 仅作实验，不作为默认策略

---

## 3. 关键风险：PyTorch 版本与 Blackwell 兼容性

RTX 5070 为 Blackwell 架构 (SM 12.0)，VoxCPM 官方推荐 `torch==2.5.1+cu121`，但 **PyTorch 2.5 不支持 Blackwell**。

| PyTorch | CUDA | 支持 5070 | 与 VoxCPM 兼容性 |
|---------|------|----------|----------------|
| 2.5.1 | 12.1 | ❌ | 官方推荐，但 5070 不可用 |
| 2.7.1 | 12.8 | ✅ | **需实测** |

**应对方案**：
1. 笔记本安装 `torch==2.7.1+cu128`，测试 VoxCPM 前向传播
2. 若报错，改用 ONNX Runtime 路径或回退 CPU 推理
3. 台式机 ROCm 环境暂不迁移 VoxCPM，保持 GPT-SoVITS 主链路

---

## 4. 项目文件导航

| 文件 | 用途 |
|------|------|
| `scripts/chat_with_voice_voxcpm.py` | 端到端语音对话（策略 A） |
| `scripts/start_voxcpm_tts.py` | VoxCPM FastAPI 服务（可选） |
| `tts_test/setup_voxcpm.ps1` | CPU 环境安装脚本 |
| `tts_test/test_voxcpm.py` | CPU 质量验证脚本 |
| `scripts/setup_voxcpm_laptop.ps1` | 笔记本 RTX 5070 环境安装脚本 |

---

## 5. 快速开始

### 5.1 台式机 CPU 验证（现在）

```powershell
# 1. 安装环境
.\tts_test\setup_voxcpm.ps1
.\tts_test\voxcpm_env\Scripts\Activate.ps1

# 2. 运行质量验证
python tts_test\test_voxcpm.py

# 3. 运行端到端对话（CPU 模式）
python scripts\chat_with_voice_voxcpm.py
```

### 5.2 笔记本 RTX 5070 部署（验证后）

```powershell
# 1. 安装 Blackwell 兼容环境
.\scripts\setup_voxcpm_laptop.ps1
.\laptop_env\Scripts\Activate.ps1

# 2. 启动 Ollama
ollama run gemma4:e4b

# 3. 运行端到端对话（自动检测 GPU，TTS 可配 CPU/GPU）
python scripts\chat_with_voice_voxcpm.py
```

---

## 6. 参考音频来源

项目中可用的参考音频：

| 路径 | 说话人 | 时长估算 | 用途 |
|------|--------|---------|------|
| `GPT-SoVITS-main/ref_audio.wav` | 孙燕姿 | ~10s | 主参考音频 |
| `output/ref_candidates/ref_data1_002_mid.wav` | 孙燕姿 | ~5s | 候选 |
| `data/孙燕姿/data1_vocals_000.wav` | 孙燕姿 | ~12s | 候选 |
| `GPT-SoVITS-main/ref_audio_jyy.wav` | jyy | ~15s | 备选说话人 |

---

*文档版本: 2026-04-21*
