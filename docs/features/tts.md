# 功能规格：语音合成 (TTS)

---

## 1. 功能概述

将文本转换为语音。支持：
- 文本输入合成语音
- 参考音频克隆音色（zero-shot voice cloning）
- 多种后端模型切换（CosyVoice、GLM-TTS、Qwen3-TTS、OpenVoice）

---

## 2. 支持的模型

| 模型 | 大小 | 特点 | 状态 |
|------|------|------|------|
| CosyVoice-300M | ~5.4GB | 阿里，zero-shot 克隆效果最佳 | ✅ 已部署 |
| GLM-TTS | ~3.6GB | 智谱，端到端 | ✅ 已部署 |
| GLM-TTS (Full) | ~8.3GB | 智谱，完整版 | ✅ 已部署 |
| Qwen3-TTS-Base | ~2.3GB | 阿里，多说话人 | ✅ 已部署 |
| OpenVoice | ~430MB | MyShell，声音克隆 | ✅ 已部署 |

---

## 3. 数据流

```
User 输入文本
    │
    ▼
POST /api/inference/tts
{ text, model_id?, ref_audio, ref_text }
    │
    ▼
Rust 确定模型、解析参考音频路径
    │
    ▼
生成输出路径: output/tts_{uuid}.wav
    │
    ▼
tokio::process::Command(python, inference_script, --text, ..., --output, ...)
    │
    ▼
Python 加载模型 ──▶ 推理 ──▶ 生成 WAV
    │
    ▼
Rust 验证文件存在 ──▶ 返回 { success, output_path }
    │
    ▼
前端: new Audio(`/api/audio/${output_path}`).play()
```

---

## 4. 接口定义

```http
POST /api/inference/tts
Content-Type: application/json

{
  "text": "你好，这是一个测试。",
  "model_id": "tts/cosyvoice3",
  "ref_audio": "assets/datasets/cliced_v2/data1_vocals_000.wav",
  "ref_text": "大家好，欢迎使用人工智能语音助手。"
}

Response:
{
  "success": true,
  "output_path": "tts_abc123.wav",
  "error": null
}

// 获取音频
GET /api/audio/tts_abc123.wav
Content-Type: audio/wav
```

---

## 5. 参考音频管理

### 5.1 默认参考音频

当请求中 `ref_audio` 和 `ref_text` 为空时，后端使用配置中的默认值：

```rust
const DEFAULT_REF_AUDIO: &str = "assets/datasets/cliced_v2/data1_vocals_000.wav";
const DEFAULT_REF_TEXT: &str = "大家好，欢迎使用人工智能语音助手。";
```

### 5.2 音色库（未来）

```
assets/voices/
  ├── jyy/
  │   ├── ref.wav
  │   └── ref.txt
  ├── stefanie/
  │   ├── ref.wav
  │   └── ref.txt
  └── custom/
      ├── ref.wav
      └── ref.txt
```

用户上传参考音频 + 对应文本，保存为"音色"，后续 TTS 可选择音色而非手动传路径。

---

## 6. 前端使用场景

### 6.1 VoiceStudio 合成

```typescript
const handleSynthesize = async () => {
  const { data } = await api.post('/api/inference/tts', {
    text: synthText,
    ref_audio: '',
    ref_text: '',
  });
  if (data.success) {
    setGeneratedAudioUrl(`/api/audio/${data.output_path}`);
  }
};
```

### 6.2 ChatPage 播放按钮

```typescript
const handlePlayTTS = async (msg: ChatMessage) => {
  const { data } = await api.post('/api/inference/tts', {
    text: msg.content,
    ref_audio: '',
    ref_text: '',
  });
  const audio = new Audio(`/api/audio/${data.output_path}`);
  await audio.play();
};
```

---

## 7. 性能优化（关键）

| 问题 | 现状 | 目标 |
|------|------|------|
| 首次加载 | ~5s 模型加载 + ~10s 推理 = ~16s | < 3s |
| 后续推理 | ~0.5s | < 0.5s |
| 模型常驻 | 每次子进程重新加载 | Python 长驻进程 / 服务化 |

### 优化方案

1. **模型常驻服务**：启动一个独立的 Python TTS 服务进程，模型加载一次，通过 HTTP/Unix Socket 接收请求
2. **预热机制**：后端启动后异步预热默认 TTS 模型
3. **输出缓存**：相同 (text + ref_audio_hash) 直接返回缓存文件

---

## 8. 已知问题

| 问题 | 方案 |
|------|------|
| 首次推理极慢（16s）| 模型常驻服务化 |
| CosyVoice 源码路径硬编码 | 改为配置项 |
| 无音色库管理 | 增加 voices 目录和 UI |
