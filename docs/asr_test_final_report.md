# ASR 模型测试最终报告

> 测试时间：2026年5月2日
> 
> 测试环境：Windows 11 + AMD RX 9070 XT

## 测试结果总览

| 模型 | 状态 | 识别结果 | 加载时间 | 推理时间 | 显存占用 |
|------|------|---------|---------|---------|---------|
| **Paraformer-large** | ✅ 成功 | 穿上它能更好完成任务它很美 | 2.31s | 6.06s | 928MB |
| **Whisper-small** | ✅ 成功 | 揣手他,能更好完成任务他很美 | 1.74s | 0.95s | 1134MB |
| Qwen3-ASR-0.6B | ❌ 失败 | - | - | - | 库版本冲突 |
| MiMo-V2.5-ASR | ❌ 失败 | - | - | - | 需特定推理代码 |
| GLM-ASR-Nano | ❌ 失败 | - | - | - | Transformers 不支持 |
| Dolphin-small | ❌ 失败 | - | - | - | 需官方推理代码 |

## 推荐方案

### 🥇 最佳选择：Paraformer-large (FunASR)

**优点**：
- ✅ 识别准确度高（正确识别"穿上它"而非"揣手他"）
- ✅ 显存占用低（约 1GB）
- ✅ 部署简单，FunASR 工具链完整
- ✅ 支持离线部署

**使用方法**：
```python
from funasr import AutoModel

model = AutoModel(
    model="models/asr_models/paraformer-large/damo/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
    device="cuda"
)
result = model.generate(input="audio.wav")
text = result[0]["text"]
```

### 🥈 备选方案：FunASR All-in-One

**带标点符号版本**：
```python
from funasr import AutoModel

model = AutoModel(
    model="iic/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
    vad_model="iic/speech_fsmn_vad_zh-cn-16k-common-pytorch",
    punc_model="iic/punc_ct-transformer_cn-en-common-vocab471067-large",
    device="cuda"
)
```

## 未成功模型说明

### Qwen3-ASR-0.6B
- **问题**：qwen-asr 库与当前 transformers 版本冲突
- **解决**：需要从源码安装最新 transformers，或使用 ONNX 版本

### MiMo-V2.5-ASR  
- **问题**：模型加载成功，但 processor 不支持音频输入
- **解决**：需要查看小米官方文档获取正确的推理方式

### GLM-ASR-Nano
- **问题**：transformers 不识别 `glmasr` 模型类型
- **解决**：需要从源码安装最新 transformers

### Dolphin-small
- **问题**：使用自定义模型格式
- **解决**：需要官方推理库：https://github.com/DataoceanAI/dolphin

## 结论

**立即可用**：
- Paraformer-large ✅ (推荐用于古装剧台词识别)

**需要额外配置**：
- Qwen3-ASR (需要安装最新 transformers)
- FunASR All-in-One (需要下载额外模型)

**不建议使用**：
- Whisper-small (对古装剧台词识别准确度低)
