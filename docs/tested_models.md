# 已测试可用模型统一清单

> 维护时间: 2026-05-05  
> 测试环境: Windows 11 + AMD RX 9070 XT (ROCm)  
> 维护原则: 每个模型必须有"状态"（可用/部分可用/不可用），有明确的使用限制说明

---

## 目录

- [ASR 语音识别模型](#asr-语音识别模型)
- [TTS 语音合成模型](#tts-语音合成模型)
- [LLM 大语言模型](#llm-大语言模型)
- [推荐方案速查](#推荐方案速查)

---

## ASR 语音识别模型

### ✅ 已验证可用（4个）

#### 1. Paraformer-Large ⭐ 推荐生产

| 属性 | 值 |
|------|-----|
| **状态** | ✅ 可用 |
| **厂商** | 阿里达摩院 (FunASR) |
| **本地路径** | `models/asr/paraformer-large/` |
| **大小** | 848 MB |
| **格式** | PyTorch (.pt) |
| **采样率** | 16000 Hz |
| **加载时间** | ~2.5s |
| **推理时间** | ~6s (10s 音频) |
| **显存占用** | ~928 MB |

**特点**: 中文识别最稳定，FunASR 工具链完整，显存占用最低  
**限制**: 无标点符号（可用 punc 模型补充）

```python
from funasr import AutoModel

model = AutoModel(
    model="models/asr/paraformer-large/damo/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
    device="cuda"
)
result = model.generate(input="audio.wav")
text = result[0]["text"]
```

---

#### 2. Whisper Tiny

| 属性 | 值 |
|------|-----|
| **状态** | ✅ 可用 |
| **厂商** | OpenAI |
| **本地路径** | `models/asr/whisper-tiny/` |
| **大小** | 144 MB |
| **格式** | PyTorch (.bin) |
| **采样率** | 16000 Hz |
| **加载时间** | ~1.7s |
| **推理时间** | ~1s (10s 音频) |
| **显存占用** | ~1.1 GB |

**特点**: 加载最快，多语言支持  
**限制**: 中文准确度一般（繁体输出"任務"），tiny 版精度有限

```python
import whisper
model = whisper.load_model("models/asr/whisper-tiny/pytorch_model.bin")
result = model.transcribe("audio.wav", language="zh")
```

---

#### 3. GLM-ASR-Nano

| 属性 | 值 |
|------|-----|
| **状态** | ✅ 可用 |
| **厂商** | 智谱 AI |
| **本地路径** | `models/asr/glm-asr-nano/` |
| **大小** | 4.3 GB |
| **格式** | Safetensors |
| **采样率** | **16000 Hz（强制）** |
| **加载时间** | ~6.5s |
| **推理时间** | ~1s (10s 音频) |
| **显存占用** | ~4.4 GB |

**特点**: 识别结果带标点，语义完整，端到端语音理解  
**⚠️ 关键限制**: 传入音频**必须是 16000Hz 采样率**，否则 feature extractor 输出常量特征，导致识别结果完全错误

```python
from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor
import librosa

# 必须重采样到 16000Hz
audio, sr = librosa.load("audio.wav", sr=16000)

model = AutoModelForSpeechSeq2Seq.from_pretrained("models/asr/glm-asr-nano")
processor = AutoProcessor.from_pretrained("models/asr/glm-asr-nano")
```

---

#### 4. Qwen3-ASR-0.6B ⭐ 识别效果最佳

| 属性 | 值 |
|------|-----|
| **状态** | ✅ 可用（需隔离环境） |
| **厂商** | 阿里通义千问 |
| **本地路径** | `models/asr/qwen3-asr-0.6b/` |
| **大小** | 1.8 GB |
| **格式** | Safetensors |
| **采样率** | 24000 Hz |
| **加载时间** | ~0.9s |
| **推理时间** | ~6.6s (10s 音频) |
| **显存占用** | ~1.6 GB |

**特点**: 识别结果最规范，带标点和正确断句，多语言支持（中英日粤）  
**⚠️ 关键限制**: `qwen-asr` 包与 `transformers 5.8.0.dev0` 不兼容，必须在**隔离环境**（transformers 4.57.x）中运行

```python
# 必须在 temp_qwen_env 中运行
from qwen_asr import AutoModelForAudioCaptioning

model = AutoModelForAudioCaptioning.from_pretrained(
    "models/asr/qwen3-asr-0.6b",
    device_map="cuda"
)
```

---

### ❌ 未成功（2个）

#### 5. MiMo-V2.5-ASR (8B)

| 属性 | 值 |
|------|-----|
| **状态** | ❌ 不可用 |
| **厂商** | 小米 |
| **本地路径** | 未下载完整（`external/` 中） |
| **大小** | 30.6 GB |
| **失败原因** | `'MiMoAudioTokenizer' object has no attribute 'all_tied_weights_keys'` |
| **根因** | MiMo tokenizer 依赖的 transformers API 在 5.8.0.dev0 中已变更 |
| **修复路径** | 创建隔离环境，安装 `transformers==4.45.0` |

---

#### 6. Dolphin-small

| 属性 | 值 |
|------|-----|
| **状态** | ❌ 不可用 |
| **厂商** | DataoceanAI |
| **失败原因** | `'DolphinSpeech2Text' object has no attribute 'partial_ar'` |
| **根因** | `dolphin` 库依赖的 `espnet2` 与当前 torch/transformers 版本不兼容 |
| **修复路径** | 安装兼容版本的 espnet，或使用 ONNX 版本 |

---

### ASR 模型本地文件清单

```
models/asr/
├── firered/                    # ❌ 空目录
├── glm-asr-nano/               # ✅ 完整 (4.3GB)
│   ├── config.json
│   ├── model.safetensors
│   ├── tokenizer.json
│   └── ...
├── glm-asr-nano-full/          # ❌ 空目录
├── paraformer-large/           # ✅ 完整 (848MB)
│   └── damo/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch/model.pt
├── qwen3-asr-0.6b/             # ⚠️ 有 safetensors，可能缺 tokenizer (1.8GB)
└── whisper-tiny/               # ⚠️ 只有 pytorch_model.bin (144MB)
```

---

## TTS 语音合成模型

### ⚠️ 模型文件已下载，但推理未打通（0/6 成功）

> TTS 模型的核心问题是：**GitHub 网络不通**导致所有需要从 GitHub 克隆/安装的库无法获取，加上依赖版本冲突。

#### 1. CosyVoice-3

| 属性 | 值 |
|------|-----|
| **状态** | ⚠️ 文件完整，库未安装 |
| **厂商** | 阿里 (FunAudioLLM) |
| **本地路径** | `models/tts/cosyvoice3/` |
| **大小** | 5.5 GB |
| **格式** | ONNX + PyTorch |
| **采样率** | 24000 Hz |
| **问题** | `cosyvoice` PyPI 包非官方包，无法导入；GitHub 克隆超时 |
| **修复路径** | 从 ModelScope 克隆 CosyVoice 仓库，`pip install -r requirements.txt` |

**备注**: 当前只有 zero-shot 音色克隆，无情感控制。生产需下载 **CosyVoice-300M-Instruct**（~3GB）获得情感指令能力。

---

#### 2. GLM-TTS ⭐ 默认 TTS

| 属性 | 值 |
|------|-----|
| **状态** | ✅ 可用 |
| **厂商** | 智谱 AI |
| **本地路径** | `models/tts/glm-tts-full/` (8.5GB) |
| **格式** | Safetensors + PyTorch |
| **采样率** | 24000 Hz |
| **加载时间** | ~12s (CPU) / ~20s (GPU) |
| **推理时间** | ~23s/短句 (GPU) / ~60s/短句 (CPU) |
| **特点** | Zero-shot 声音克隆 + 多段情绪合成 (happy/calm/excited/sad/surprised)，LLM 骨架支持自然语调和情感表达 |
| **脚本** | `scripts/inference_tts_glm.py` (单句) / `scripts/inference_tts_glm_script.py` (多段情绪) |
| **限制** | 当前仅 CPU 推理可用 (ROCm 7.1 环境 `torch.cuda.is_available()` 为 false)；Windows 下需绕过 pynini/FFmpeg torchcodec 依赖 |

---

#### 3. Qwen3-TTS

| 属性 | 值 |
|------|-----|
| **状态** | ⚠️ 模型不完整 |
| **厂商** | 阿里通义千问 |
| **本地路径** | `models/tts/qwen3-tts/` (GGUF, 2.3GB) |
| **格式** | GGUF (Q8_0) |
| **问题** | 仅有 Talker 的 GGUF 权重，缺 Predictor/Encoder/Decoder/Tokenizer |
| **修复路径** | 下载完整 HuggingFace 格式模型，或在 transformers 4.57.x 环境中运行 |

---

#### 4. Fish Speech S2

| 属性 | 值 |
|------|-----|
| **状态** | ❌ 依赖冲突 |
| **厂商** | Fish Audio |
| **问题** | `audiotools` 安装后 `torch.distributed.ReduceOp.AVG` 不存在；numpy 版本冲突（要求 <=1.26.4，实际 2.0.2） |
| **修复路径** | 创建隔离环境，安装 `numpy==1.26.4`，从 ModelScope 下载源码 |

---

#### 5. IndexTTS-2

| 属性 | 值 |
|------|-----|
| **状态** | ❌ 网络不通 |
| **厂商** | IndexTTS |
| **问题** | `pip install git+https://github.com/index-tts/index-tts.git` 超时 |
| **修复路径** | 配置 GitHub 代理或使用 gitee 镜像 |

---

#### 6. OpenVoice

| 属性 | 值 |
|------|-----|
| **状态** | ⚠️ 文件完整，库未安装 |
| **厂商** | MyShell |
| **本地路径** | `models/tts/openvoice/` (431MB) |
| **格式** | PyTorch (.pth) |
| **问题** | PyPI 无 `openvoice` 包，GitHub 克隆超时 |
| **修复路径** | 从 GitHub/gitee 克隆仓库安装 |

---

### TTS 模型本地文件清单

```
models/tts/
├── cosyvoice3/                 # ⚠️ 文件完整 (5.5GB)
│   └── iic/CosyVoice-300M/...
├── cosyvoice_src/              # 源码目录 (6MB，非模型)
├── glm-tts/                    # ⚠️ 文件完整 (3.7GB)
├── glm-tts-full/               # ⚠️ 文件完整 (8.5GB)
├── glm-tts-full-ms/            # ⚠️ 文件完整 (8.5GB) ModelScope 版
├── gpt_sovits_pretrained/      # ❌ 空目录
├── openvoice/                  # ⚠️ 文件完整 (431MB)
├── qwen3-tts/                  # ⚠️ 不完整，只有 GGUF (2.3GB)
├── qwen3-tts-base/             # ⚠️ 有 safetensors (2.4GB)
├── qwen3-tts-base-ms/          # ⚠️ 有 safetensors (4.3GB)
└── qwen3-tts-tokenizer/        # ⚠️ 只有 tokenizer (651MB)
```

---

## LLM 大语言模型

| 模型 | 状态 | 管理方式 | 大小 | 说明 |
|------|------|----------|------|------|
| **Gemma 4 E4B** | ✅ 可用 | Ollama 外部管理 | 8.95 GB | INT4 量化，多模态理解 |

> LLM 模型由 Ollama 统一管理，不在 `models/llm/` 目录中。

---

## 推荐方案速查

### ASR 生产环境推荐

| 场景 | 推荐模型 | 理由 |
|------|----------|------|
| **默认首选** | Paraformer-Large | 最稳定、显存最低、FunASR 生态完整 |
| **效果最好** | Qwen3-ASR-0.6B | 识别最规范，带标点断句，多语言 |
| **低延迟** | Whisper Tiny | 加载推理最快，但中文准确度一般 |
| **带标点** | GLM-ASR-Nano | 端到端理解，但需严格 16000Hz 输入 |

### TTS 下一步优先修复

| 优先级 | 模型 | 关键动作 |
|--------|------|----------|
| P0 | CosyVoice-3 | 解决 GitHub 网络，安装官方库 |
| P0 | GLM-TTS | 同上 + 实现 cross-fade 长文本修复 |
| P1 | Qwen3-TTS | 下载完整 HuggingFace 格式模型 |
| P2 | OpenVoice | 安装官方库，验证声音克隆效果 |

---

## 维护记录

| 日期 | 变更 |
|------|------|
| 2026-05-05 | 创建本文档，统一 ASR/TTS/LLM 模型状态 |
| 2026-05-03 | ASR 4/6 模型测试通过，TTS 0/6 通过 |
| 2026-05-02 | ASR 初步测试，Paraformer + Whisper 可用 |
