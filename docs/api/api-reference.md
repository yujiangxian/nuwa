# API 接口规范

---

## 1. 通用约定

- **Base URL**: `http://localhost:8080`
- **Content-Type**: `application/json`（除文件上传外）
- **编码**: UTF-8
- **错误格式**: `{ "error": "错误描述" }`

---

## 2. 对话接口

### POST /api/chat

转发到 Ollama 进行对话。

**请求体:**
```json
{
  "messages": [
    { "role": "user", "content": "你好" }
  ],
  "system": "你是一个有用的AI助手。"
}
```

**响应:**
```json
{
  "role": "assistant",
  "content": "你好！有什么我可以帮你的吗？",
  "model": "gemma4:e4b",
  "done": true
}
```

---

## 3. ASR 接口

### POST /api/inference/asr

识别服务器本地音频文件。

**请求体:**
```json
{
  "audio_path": "path/to/audio.wav",
  "model_id": "asr/paraformer-large"
}
```

**响应:**
```json
{
  "success": true,
  "text": "识别结果",
  "error": null
}
```

### POST /api/inference/asr/upload

上传音频文件进行识别。

**请求体:** `multipart/form-data`
- `audio`: 音频文件 blob
- `model_id` (可选): 模型 ID

**响应:** 同上

---

## 4. TTS 接口

### POST /api/inference/tts

合成语音。

**请求体:**
```json
{
  "text": "要合成的文本",
  "model_id": "tts/cosyvoice3",
  "ref_audio": "",
  "ref_text": ""
}
```

**响应:**
```json
{
  "success": true,
  "output_path": "tts_xxx.wav",
  "error": null
}
```

### GET /api/audio/{filename}

获取生成的音频文件。

**响应:** `audio/wav`

---

## 5. 模型管理接口

### GET /api/models

获取模型列表。

**响应:**
```json
[
  {
    "id": "tts/cosyvoice3",
    "name": "CosyVoice-3",
    "model_type": "tts",
    "source": "local",
    "path": "models/tts/cosyvoice3",
    "size_mb": 5486.25,
    "files": 16,
    "main_files": ["..."],
    "description": "6 个模型文件 · 5.4 GB · 阿里 · 语音合成",
    "version": "1.0",
    "quant": "ONNX",
    "sample_rate": 24000
  }
]
```

### POST /api/models/scan

重新扫描模型目录。

**响应:** 同上

---

## 6. 配置接口

### GET /api/config

获取配置。

**响应:**
```json
{
  "current_llm_model": "gemma4:e4b",
  "current_asr_model": "asr/paraformer-large",
  "current_tts_model": "tts/cosyvoice3",
  "current_voice_id": null,
  "ref_audio_path": "assets/datasets/cliced_v2/data1_vocals_000.wav",
  "ref_text": "大家好，欢迎使用人工智能语音助手。",
  "theme": "dark",
  "auto_play": true,
  "language": "zh-CN",
  "models_dir": "models",
  "output_dir": "output",
  "voices_dir": "assets/voices"
}
```

### POST /api/config

更新配置（完整对象替换）。

**请求体:** 完整的 AppConfig 对象

**响应:** 更新后的配置

---

## 7. 下载接口

### GET /api/downloads/presets

获取可下载的预设模型列表。

### GET /api/downloads/repo-files?repo_id=xxx&source=xxx

获取仓库文件列表。

### POST /api/downloads/batch

开始批量下载。

**请求体:**
```json
{
  "repo_id": "Qwen/Qwen3-ASR-0.6B",
  "source": "modelscope",
  "files": ["model.safetensors", "config.json"],
  "dest_dir": "models/asr/qwen3-asr-0.6b"
}
```

---

## 8. 健康检查

### GET /health

**响应:**
```json
{ "status": "ok" }
```
