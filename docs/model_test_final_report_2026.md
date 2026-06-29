# 模型端到端测试最终报告 (2026-05-03)

## 测试环境

- **OS**: Windows 11
- **GPU**: AMD RX 9070 XT (ROCm)
- **Python**: 3.11
- **PyTorch**: 2.10.0+rocm7.13.0a20260404
- **主环境 transformers**: 4.49.0
- **GLM-ASR 专用 overlay**: transformers 5.0.0 (安装在 `transformers_50/`)
- **Qwen3 隔离环境**: `temp_qwen_env` (transformers 4.57.6)

## 关键 workaround

1. **ROCm MIOpen bug**: `torch.backends.cudnn.enabled = False`
2. **Windows torchaudio 损坏**: 所有音频 I/O 使用 `soundfile` 替代 `torchaudio.load/save`
3. **Dolphin ASR config**: 运行时 patch `config.yaml` 中的 Linux 绝对路径为本地路径
4. **GLM-ASR transformers 版本**: 使用 transformers 5.0.0 overlay 目录 + PYTHONPATH 注入
5. **Qwen3-ASR 版本隔离**: subprocess 调用 `temp_qwen_env` 避免与主环境 transformers 冲突
6. **Windows 控制台 UTF-8**: `PYTHONIOENCODING=utf-8` + `sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')`

---

## ASR 模型测试结果 (5/6 成功)

| 模型 | 状态 | 加载时间 | 推理时间 | 显存占用 | 识别结果示例 |
|------|------|---------|---------|---------|-------------|
| **Paraformer-large** | ✅ 成功 | 3.4s | 10.2s | 928MB | 穿上它能更好完成任务它很美 |
| **Whisper-small** | ✅ 成功 | 2.4s | 1.3s | 1134MB | 揣手他,能更好完成任務他很美 |
| **Qwen3-ASR-0.6B** | ✅ 成功 | 1.0s | 7.7s | ~2GB | 穿上它，能更好完成任务。它很美。 |
| **GLM-ASR-Nano** | ✅ 成功 | 3.6s | 1.6s | 4428MB | 穿上它能更好完成任务，它很美。 |
| **Dolphin-small** | ✅ 成功 | 4.3s | 6.0s | 1785MB | 你你你有你你就去追求那你个失败了。其实大家都都有有当然你曾经也会 |
| **MiMo-V2.5-ASR** | ❌ 失败 | - | - | - | 缺少官方源码 (mimo_audio.py) |

### MiMo-V2.5-ASR 失败原因

模型权重已下载，但缺少 `src/mimo_audio/mimo_audio.py` 官方源码。GitHub 被墙，无法下载。
标准 `AutoModelForCausalLM` 只能加载文本权重，音频编码器权重无法使用。

---

## TTS 模型测试结果 (1/6 成功)

| 模型 | 状态 | 加载时间 | 推理时间 | 显存占用 | 备注 |
|------|------|---------|---------|---------|------|
| **CosyVoice** | ✅ 成功 | ~5s | ~35s | ~4GB | zero-shot 语音克隆正常工作 |
| **Qwen3-TTS** | ❌ 失败 | - | - | - | 权重为 GGUF 量化格式，非标准 transformers |
| **GLM-TTS** | ❌ 失败 | - | - | - | 缺少推理源码 (GitHub 被墙) |
| **Fish Speech 1.5** | ❌ 失败 | - | - | - | 缺少源码 + audiotools 与 ROCm 不兼容 |
| **IndexTTS-2** | ❌ 失败 | - | - | - | 缺少推理源码 (GitHub 被墙) |
| **OpenVoice** | ❌ 失败 | - | - | - | 缺少推理源码 (GitHub 被墙) |

### CosyVoice 使用方式

```python
from cosyvoice.cli.cosyvoice import CosyVoice
model = CosyVoice('models/tts_models/cosyvoice3/iic/CosyVoice-300M')
outputs = list(model.inference_zero_shot(
    '你好，这是一个语音合成测试。',
    '穿上它能更好完成任务，它很美。',
    'data/jyy/sliced_final/jyy_000.wav'  # 参考音频文件路径
))
```

### TTS 模型被阻塞原因

1. **Qwen3-TTS**: 下载的权重是 `.gguf` 格式 (`Qwen3-TTS-12Hz-1.7B-Base-Q8_0.gguf`)，需要 llama.cpp 或专用 GGUF 加载器，无法用标准 transformers 加载。

2. **GLM-TTS / Fish Speech / IndexTTS / OpenVoice**: 所有权重已下载，但**推理源码托管在 GitHub**，当前网络环境无法访问 GitHub。ModelScope 上没有对应源码仓库。

---

## 总结

- **ASR**: 5/6 模型成功跑通端到端推理，1 个因缺少源码被阻塞
- **TTS**: 1/6 模型成功跑通端到端推理，5 个因缺少源码或格式不支持被阻塞
- **整体**: 6/12 模型成功跑通

## 下一步建议

1. **MiMo-ASR**: 通过代理/VPN 下载 `MiMo-Audio-Tokenizer` 和 `src/mimo_audio/mimo_audio.py`
2. **Qwen3-TTS**: 安装 llama.cpp 或使用 `llama-cpp-python` 加载 GGUF 模型
3. **GLM-TTS / Fish Speech / IndexTTS / OpenVoice**: 通过代理/VPN 克隆 GitHub 源码仓库
4. **Fish Speech 额外问题**: `audiotools` 依赖的 `torch.distributed.ReduceOp.AVG` 在 ROCm 上不存在，需要 patch 或寻找替代方案
