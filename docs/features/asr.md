# 功能规格：语音识别 (ASR)

---

## 1. 功能概述

将音频转换为文本。支持：
- 上传本地音频文件识别
- 前端录音实时识别（VoiceStudio / ChatPage 麦克风）
- 多种后端模型切换（Paraformer、Whisper、GLM-ASR、Qwen3-ASR）

---

## 2. 支持的模型

| 模型 | 参数量 | 大小 | 语言 | 特点 | 状态 |
|------|--------|------|------|------|------|
| Paraformer-Large | — | ~850MB | 中文 | FunASR 出品，中文最优 | ✅ 已部署 |
| Whisper Tiny | 39M | ~150MB | 多语言 | OpenAI，轻量 | ✅ 已部署 |
| Whisper Small | 244M | ~1GB | 多语言 | 比 Tiny 更准 | ❌ 未下载 |
| Whisper Medium | 769M | ~3GB | 多语言 | 高准确度 | ❌ 未下载 |
| Whisper Large-V3 | 1550M | ~6GB | 多语言 | 英文最优 | ❌ 未下载 |
| GLM-ASR-Nano | ~0.5B | ~4.2GB | 中文 | 端到端语音理解 | ✅ 已部署 |
| Qwen3-ASR-0.6B | 0.6B | ~1.8GB | 多语言 | 阿里最新 | ✅ 已部署 |
| Qwen3-ASR-1.7B | 1.7B | ~2.5GB | 多语言 | 比 0.6B 更准 | ❌ 未下载 |
| SenseVoice-Small | — | ~1GB | 多语言 | 极速、情感检测 | ❌ 未下载 |

---

## 3. 数据流

### 3.1 文件上传识别

```
User 选择音频文件
    │
    ▼
POST /api/inference/asr/upload
Content-Type: multipart/form-data
{ audio: File, model_id?: String }
    │
    ▼
Rust 保存到临时目录
    │
    ▼
tokio::process::Command(python, inference_script, --audio, temp_path)
    │
    ▼
Python 加载模型 ──▶ 推理 ──▶ 输出 JSON
    │
    ▼
Rust 读取 JSON ──▶ 返回 { success, text }
    │
    ▼
清理临时文件
```

### 3.2 服务器本地文件识别

```
POST /api/inference/asr
{ audio_path: "path/to/audio.wav", model_id?: String }
    │
    ▼
Rust 检查路径 ──▶ Python 子进程
    │
    ▼
返回 { success, text }
```

---

## 4. 接口定义

### 4.1 上传音频识别

```http
POST /api/inference/asr/upload
Content-Type: multipart/form-data

Form fields:
  - audio: <audio file blob>
  - model_id: "asr/paraformer-large"  (可选)

Response:
{
  "success": true,
  "text": "今天天气不错，适合出门散步。",
  "error": null
}
```

### 4.2 本地文件识别

```http
POST /api/inference/asr
Content-Type: application/json

{
  "audio_path": "assets/datasets/cliced_v2/data1_vocals_000.wav",
  "model_id": "asr/paraformer-large"
}

Response:
{
  "success": true,
  "text": "当然是觉得你有梦想...",
  "error": null
}
```

---

## 5. Python 推理脚本规范

每个 ASR 模型对应一个 Python 脚本，统一接口：

```bash
python inference_asr_{model}.py \
  --model-path /path/to/model \
  --audio /path/to/audio.wav \
  --output-json /tmp/result.json
```

输出 JSON 格式：
```json
{
  "success": true,
  "text": "识别结果文本",
  "inference_time_sec": 2.5
}
```

---

## 6. 前端使用场景

### 6.1 VoiceStudio 录音转写

```typescript
// MediaRecorder 录制音频
const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
recorder.onstop = async () => {
  const blob = new Blob(chunks, { type: 'audio/webm' });
  const formData = new FormData();
  formData.append('audio', blob);
  const { data } = await api.post('/api/inference/asr/upload', formData);
  setSynthText(data.text);
};
```

### 6.2 ChatPage 语音输入（TODO）

```typescript
// 点击 Mic 开始录音，停止后自动识别并填入输入框
```

---

## 7. 已知问题

| 问题 | 方案 |
|------|------|
| PowerShell 子进程输出中文乱码 | `PYTHONIOENCODING=utf-8` + `io.TextIOWrapper` |
| 录音格式兼容性 | 统一用 `audio/webm`，后端用 FFmpeg 或 soundfile 转换 |
| 长音频处理 | 超过 30 秒需切片或流式处理 |
