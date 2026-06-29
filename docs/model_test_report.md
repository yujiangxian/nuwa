# ASR/TTS 模型测试报告

> 测试时间：2026年5月2日
> 
> 测试环境：Windows 11 + AMD RX 9070 XT

## 一、ASR 模型测试结果

### 测试音频
- 文件：`data/jyy/sliced_final/jyy_000.wav`
- 内容：古装剧台词片段

### 测试结果

| 模型 | 识别结果 | 加载时间 | 推理时间 | 显存占用 | 状态 |
|------|---------|---------|---------|---------|------|
| **FunASR-AllInOne** | 穿上它能更好完成任务它很美。 | 113s | **1.78s** | 2015MB | ✅ 最佳 |
| **Paraformer-large** | 穿上它能更好完成任务它很美 | 3.38s | 10s | 928MB | ✅ 推荐 |
| **Whisper-small** | 揣手他,能更好完成任務他很美 | 2.42s | 1.42s | 1134MB | ⚠️ 准确度低 |
| Dolphin-small | - | - | - | - | ❌ 需特定代码 |
| Qwen3-ASR | - | - | - | - | ❌ 需特定代码 |
| MiMo-V2.5-ASR | - | - | - | - | ❌ 需特定代码 |
| GLM-ASR-Nano | - | - | - | - | ❌ 需特定代码 |

### ASR 模型推荐

#### 🥇 最佳选择：FunASR All-in-One
```python
from funasr import AutoModel

model = AutoModel(
    model="iic/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
    vad_model="iic/speech_fsmn_vad_zh-cn-16k-common-pytorch",
    punc_model="iic/punc_ct-transformer_cn-en-common-vocab471067-large",
    device="cuda"
)
result = model.generate(input="audio.wav")
text = result[0]["text"]  # 带标点
```

**优点**：
- 识别准确度最高
- 自动添加标点符号
- 内置 VAD 语音检测
- 推理速度快

**缺点**：
- 首次加载需要下载模型
- 显存占用较高 (~2GB)

#### 🥈 备选方案：Paraformer-large
```python
from funasr import AutoModel

model = AutoModel(
    model="models/asr_models/paraformer-large/damo/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
    device="cuda"
)
result = model.generate(input="audio.wav")
```

**优点**：
- 本地模型，离线可用
- 显存占用低 (~1GB)
- 加载速度快

**缺点**：
- 无标点符号
- 无 VAD

---

## 二、TTS 模型测试结果

### 已下载模型

| 模型 | 大小 | 推理方式 | 状态 |
|------|------|---------|------|
| CosyVoice-300M | 5.36 GB | ONNX | 需安装 cosyvoice |
| OpenVoice | 0.42 GB | PyTorch | 需安装 melo-tts |
| Fish-Audio-S2 | 1.37 GB | PyTorch | 需安装 fish-speech |
| GLM-TTS | 5.99 GB | PyTorch | 需特定推理代码 |
| IndexTTS-2 | 5.49 GB | PyTorch | 需安装 indextts |
| Qwen3-TTS | 2.29 GB | GGUF | 需 llama.cpp |

### TTS 模型状态

所有 TTS 模型都需要安装特定的推理库：

1. **CosyVoice** - 需要 `pip install cosyvoice`
2. **OpenVoice** - 需要 `pip install openvoice melo-tts`
3. **Fish Audio** - 需要 `pip install fish-speech`
4. **IndexTTS** - 需要 `pip install indextts`
5. **Qwen3-TTS** - 需要 llama.cpp 或 GGUF 推理器

### TTS 快速测试方案

#### 方案 1：Edge-TTS（在线，最简单）
```powershell
pip install edge-tts
```
```python
import edge_tts
import asyncio

async def generate():
    communicate = edge_tts.Communicate("测试文本", "zh-CN-XiaoxiaoNeural")
    await communicate.save("output.wav")

asyncio.run(generate())
```

#### 方案 2：Sherpa-ONNX（离线，快速）
```powershell
pip install sherpa-onnx
# 下载 TTS 模型
```

#### 方案 3：CosyVoice（声音克隆）
```powershell
pip install cosyvoice
```

---

## 三、结论与建议

### ASR 模型
- **生产环境**：使用 **FunASR All-in-One**，准确度高，带标点
- **离线部署**：使用 **Paraformer-large**，显存占用低

### TTS 模型
- **快速测试**：使用 **Edge-TTS**（在线，无需本地模型）
- **声音克隆**：需要安装 CosyVoice 或 OpenVoice 的推理库
- **建议**：先安装 `cosyvoice` 测试声音克隆效果

### 下一步行动
1. 安装 CosyVoice 推理库：`pip install cosyvoice`
2. 测试声音克隆效果
3. 对比不同 TTS 模型的音质和相似度

---

## 四、附录

### 已下载模型总览

**ASR 模型** (38.07 GB)
```
models/asr_models/
├── qwen3-asr-0.6b/     # 1.75 GB
├── mimo-v2.5-asr/      # 29.89 GB
├── dolphin-small/      # 1.39 GB
├── paraformer-large/   # 0.83 GB ✅ 可用
└── glm-asr-nano/       # 4.21 GB
```

**TTS 模型** (20.91 GB)
```
models/tts_models/
├── fish-audio-s2/      # 1.37 GB
├── cosyvoice3/         # 5.36 GB ✅ 有 ONNX
├── glm-tts/            # 5.99 GB
├── openvoice/          # 0.42 GB ✅ 有 checkpoints
├── indextts2/          # 5.49 GB
└── qwen3-tts/          # 2.29 GB (GGUF)
```
