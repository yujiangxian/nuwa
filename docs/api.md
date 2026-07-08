# Nuwa Backend API Reference

**Base URL:** `http://localhost:3017`

The Nuwa backend is an Axum/Rust server that proxies LLM chat to Ollama, manages local AI models (ASR/TTS/LLM), orchestrates model downloads, and serves audio output.

All endpoints return JSON unless noted otherwise. Error responses use the shape `{ "error": "<message>" }`.

---

## 1. Health

### `GET /health`

Simple liveness check. Pass `?detailed=1` for per-dependency status.

**Query parameters:**

| Param    | Type   | Default | Description                        |
|----------|--------|---------|------------------------------------|
| detailed | string | absent  | Set to `"1"` for dependency probes |

**Response** (basic):

```json
{ "status": "ok" }
```

**Response** (detailed):

```json
{
  "status": "healthy",
  "checks": {
    "ollama": "ok",
    "output_dir": "ok"
  }
}
```

`status` is `"degraded"` when any check fails. Individual check values: `"ok"`, `"unreachable"`, or `"error"`.

---

## 2. Chat

### `POST /api/chat`

Non-streaming chat completion via Ollama. Forwards messages to the configured LLM model and returns the full response.

**Request body:**

```json
{
  "messages": [
    { "role": "user", "content": "Hello" }
  ],
  "model": "gemma4:e4b",
  "system": "You are a helpful assistant.",
  "temperature": 0.7,
  "top_p": 0.9,
  "top_k": 40,
  "num_predict": 512,
  "repeat_penalty": 1.1
}
```

| Field           | Type          | Required | Default        | Notes                                      |
|-----------------|---------------|----------|----------------|--------------------------------------------|
| messages        | ChatMessage[] | yes      | --             | Array of `{ role, content }` objects       |
| model           | string        | no       | `"gemma4:e4b"` | Ollama model name                          |
| system          | string        | no       | null           | System prompt prepended to messages        |
| temperature     | float         | no       | null           | Clamped to [0.0, 2.0]                      |
| top_p           | float         | no       | null           | Clamped to [0.0, 1.0]                      |
| top_k           | integer       | no       | null           | Clamped to [0, 100]                        |
| num_predict     | integer       | no       | null           | Clamped to [1, 8192]; -1 means unlimited   |
| repeat_penalty  | float         | no       | null           | Clamped to [0.0, 2.0]                      |

Model selection fallback order: `current_llm_model` config -> `current_model_id` config -> request `model` field.

**Response** (200):

```json
{
  "role": "assistant",
  "content": "Hello! How can I help you today?",
  "model": "gemma4:e4b",
  "done": true
}
```

**Error** (200 with error field):

```json
{ "error": "Ollama error: model not found" }
```

Errors are returned with HTTP 200 and a top-level `error` string.

### `POST /api/chat/stream`

Streaming chat completion. Same request body as `POST /api/chat`. Returns `Content-Type: application/x-ndjson` -- one JSON object per line.

**Streaming chunks:**

```json
{"delta":"Hello"}
{"delta":", how"}
{"delta":" can I help?"}
{"done":true}
```

On error, a single chunk is emitted:

```json
{"error":"无法连接 Ollama：...。请确认 Ollama 已启动且模型已加载。"}
```

Each chunk has exactly one of: `delta` (string), `done` (boolean), or `error` (string). The stream always ends with either a `{"done":true}` chunk or an `{"error":"..."}` chunk.

---

## 3. Configuration

### `GET /api/config`

Returns the full application configuration object.

**Response:**

```json
{
  "voxcpm_tts_path": null,
  "voxcpm_server_path": null,
  "models_dir": "models",
  "output_dir": "output",
  "voices_dir": "assets/datasets/voices",
  "backend": "ollama",
  "threads": 8,
  "default_cfg": 3.0,
  "default_timesteps": 10,
  "current_llm_model": "gemma4:e4b",
  "current_asr_model": "asr/whisper-tiny",
  "current_tts_model": "tts/cosyvoice3",
  "current_models": {
    "llm": "gemma4:e4b",
    "asr": "asr/whisper-tiny",
    "tts": "tts/cosyvoice3"
  },
  "current_model_id": null,
  "current_mode": "chat",
  "current_voice_id": null,
  "theme": "dark",
  "model_meta": {}
}
```

### `POST /api/config`

Replace the entire configuration. The request body must be the full `AppConfig` object (same shape as the GET response). On success the config is persisted to disk.

**Error** (200 with error):

```json
{ "error": "保存配置失败: ..." }
```

On persist failure the in-memory config is rolled back to its previous state.

### `POST /api/config/set-model`

Incrementally set the current model for a given type without overwriting unrelated config fields.

**Request body:**

```json
{
  "model_type": "tts",
  "model_id": "tts/cosyvoice-instruct"
}
```

| Field      | Type   | Required | Description                         |
|------------|--------|----------|-------------------------------------|
| model_type | string | yes      | One of: `"llm"`, `"asr"`, `"tts"`  |
| model_id   | string | yes      | Model identifier                    |

**Response:** Full `AppConfig` object (same as `GET /api/config`).

Side effects: updates `current_models` map and the legacy `current_llm_model`/`current_asr_model`/`current_tts_model` fields for backward compatibility.

---

## 4. Models

### `GET /api/models`

List all locally scanned models.

**Response:**

```json
[
  {
    "id": "asr/whisper-tiny",
    "name": "whisper-tiny",
    "version": "1.0",
    "quant": "fp32",
    "path": "models/asr/whisper-tiny",
    "sample_rate": 16000,
    "model_type": "asr",
    "size_mb": 151.0,
    "files": 5,
    "main_files": ["model.onnx", "tokenizer.json"],
    "description": "OpenAI Whisper Tiny",
    "source": "local"
  }
]
```

### `POST /api/models/scan`

Trigger a background model scan (local filesystem + Ollama). Returns the current model list immediately; results update asynchronously. If a scan is already in progress the existing list is returned and no new scan starts.

### `GET /api/models/scan-progress`

Check whether a scan is running and get its progress.

**Response:**

```json
{
  "scanning": true,
  "progress": {
    "phase": "scanning",
    "current_dir": "models/asr",
    "total_dirs": 42,
    "processed_dirs": 15,
    "models_found": 3
  },
  "model_count": 3
}
```

When no scan is active, `scanning` is `false` and `progress` is `null`.

### `DELETE /api/models/{id}`

Delete a model by ID. Refuses to delete Ollama models (use `ollama rm` instead) and models currently in use for inference.

**Response** (success):

```json
{ "message": "模型已删除", "id": "asr/whisper-tiny" }
```

**Error:**

```json
{ "error": "模型正在被推理任务使用，请先停止相关任务" }
```

Automatically removes the model from `current_models` and legacy config fields if it was the active model.

### `GET /api/models/{id}/meta`

Get user-editable metadata for a model (notes, tags, last-used timestamp).

**Response:**

```json
{
  "notes": "Good for quick transcription",
  "tags": ["production", "fast"],
  "last_used": 1712345678
}
```

### `POST /api/models/{id}/meta`

Update model metadata. Partial updates: only provided fields are changed.

**Request body:**

```json
{
  "notes": "Updated note",
  "tags": ["production"]
}
```

| Field | Type     | Required | Description           |
|-------|----------|----------|-----------------------|
| notes | string   | no       | User notes            |
| tags  | string[] | no       | Array of tag strings  |

**Response:** Updated `ModelMeta` object.

### `GET /api/models/{id}/files`

List files on disk for a local model.

**Response:**

```json
{
  "id": "asr/whisper-tiny",
  "name": "whisper-tiny",
  "path": "models/asr/whisper-tiny",
  "files": [
    {
      "name": "model.safetensors",
      "path": "/absolute/path/to/model.safetensors",
      "size": 150994944,
      "size_text": "144.0 MB",
      "is_dir": false,
      "modified": 1712345678
    }
  ]
}
```

For Ollama models, `files` is always `[]`.

---

## 5. System

### `GET /api/system/disk`

Disk space info for the volume containing the configured `models_dir`.

**Response:**

```json
{
  "total_bytes": 1000204886016,
  "free_bytes": 500123456000,
  "used_bytes": 500081430016,
  "total_text": "931.5 GB",
  "free_text": "465.8 GB",
  "used_text": "465.7 GB",
  "used_percent": 50.0
}
```

Returns all-zero values with `"未知"` text if disk info cannot be read.

### `GET /api/system/gpu`

GPU information from `rocm-smi` or `nvidia-smi`. Returns `null` if no GPU is detected.

**Response** (with GPU):

```json
{
  "name": "NVIDIA GeForce RTX 4090",
  "total_vram_mb": 24564,
  "used_vram_mb": 1024,
  "free_vram_mb": 23540,
  "usage_percent": 4.17
}
```

**Response** (no GPU):

```json
null
```

Supports AMD ROCm (`rocm-smi`) and NVIDIA (`nvidia-smi`). AMD is probed first.

---

## 6. Voices (Reference Audio)

### `GET /api/voices`

List all registered reference audio voices.

**Response:**

```json
[
  {
    "id": "voice_01abc",
    "name": "Alice",
    "path": "assets/datasets/voices/voice_01abc.wav",
    "transcript": "This is a sample transcript for the voice.",
    "sample_rate": 22050,
    "duration_seconds": 5.4
  }
]
```

### `POST /api/voices`

JSON registration endpoint (legacy). Add a voice entry by providing the full `VoiceInfo` object.

**Request body:**

```json
{
  "id": "voice_manual",
  "name": "Manual Voice",
  "path": "assets/datasets/voices/manual.wav",
  "transcript": "Reference transcript text.",
  "sample_rate": 22050,
  "duration_seconds": 3.2
}
```

**Response:** The same `VoiceInfo` object.

Note: prefer `POST /api/voices/upload` for new voices -- this endpoint does no validation or file writing.

### `POST /api/voices/upload`

Upload a reference audio file via multipart form. Performs validation, probes audio metadata, writes the file, and registers the voice.

**Multipart fields:**

| Field      | Type | Required | Notes                                        |
|------------|------|----------|----------------------------------------------|
| audio      | file | yes      | Audio file (wav, mp3, flac, ogg, m4a, aac)   |
| name       | text | yes      | Display name for the voice                   |
| transcript | text | no       | Reference transcript for TTS cloning         |

**Constraints:**
- Maximum file size: 20 MB
- Supported extensions: `.wav`, `.mp3`, `.flac`, `.ogg`, `.m4a`, `.aac`

**Response** (200):

```json
{
  "id": "voice_02def",
  "name": "My Voice",
  "path": "assets/datasets/voices/voice_02def.wav",
  "transcript": "Hello world.",
  "sample_rate": 44100,
  "duration_seconds": 2.5
}
```

**Errors:**

| Status | Body                                              |
|--------|---------------------------------------------------|
| 400    | `{ "error": "需要音频文件" }`                      |
| 400    | `{ "error": "不支持的音频格式: .xyz" }`             |
| 400    | `{ "error": "需要音色名称" }`                      |
| 413    | `{ "error": "文件过大，最大 20MB" }`                |
| 500    | `{ "error": "创建音色目录失败: ..." }`              |
| 500    | `{ "error": "保存音频失败: ..." }`                  |

### `GET /api/voices/{id}/audio`

Serve the raw audio bytes for a voice by ID. Returns the file with the correct MIME type.

- 404: Voice not found
- 500: File read failure

### `DELETE /api/voices/{id}`

Delete a voice entry and its audio file. Idempotent -- returns `{ "success": true }` even if the ID does not exist.

**Response:**

```json
{ "success": true }
```

---

## 7. Inference

### `POST /api/inference/asr`

Transcribe an audio file already on disk using the configured ASR model.

**Request body:**

```json
{
  "audio_path": "/path/to/audio.wav",
  "model_id": "asr/whisper-tiny"
}
```

| Field      | Type   | Required | Description                                      |
|------------|--------|----------|--------------------------------------------------|
| audio_path | string | yes      | Absolute or project-relative path to audio file  |
| model_id   | string | no       | ASR model ID; falls back to config if omitted    |

**Response:**

```json
{
  "success": true,
  "text": "这是识别出的文本内容。",
  "error": null,
  "model": "asr/whisper-tiny",
  "elapsed_ms": 1234
}
```

On failure, `success` is `false` and `error` contains the message. The model's `last_used` timestamp is updated on success.

### `POST /api/inference/asr/upload`

Transcribe an uploaded audio file. Accepts multipart form data.

**Multipart fields:**

| Field    | Type | Required | Description         |
|----------|------|----------|---------------------|
| audio    | file | yes      | Audio file to transcribe |
| model_id | text | no       | ASR model ID        |

The uploaded file is saved to a temp location, transcribed, and the temp file is cleaned up afterward.

**Response:**

```json
{
  "success": true,
  "text": "识别结果文本。",
  "error": null,
  "model": "asr/whisper-tiny",
  "elapsed_ms": 2345
}
```

### `POST /api/inference/tts`

Synthesize speech from text using the configured TTS model.

**Request body:**

```json
{
  "text": "你好，欢迎使用女娲语音合成系统。",
  "model_id": "tts/cosyvoice3",
  "ref_audio": "assets/datasets/voices/voice_01abc.wav",
  "ref_text": "This is a sample transcript for the voice."
}
```

| Field     | Type   | Required | Description                                                |
|-----------|--------|----------|------------------------------------------------------------|
| text      | string | yes      | Text to synthesize                                         |
| model_id  | string | no       | TTS model ID; falls back to config                         |
| ref_audio | string | yes      | Path to reference audio for voice cloning                  |
| ref_text  | string | yes      | Transcript matching the reference audio                    |

Output files land in `output/tts_<uuid>.wav`. Empty `ref_audio`/`ref_text` fall back to built-in defaults.

**Response:**

```json
{
  "success": true,
  "output_path": "tts_550e8400-e29b-41d4-a716-446655440000.wav",
  "error": null
}
```

Access the generated audio at `GET /api/audio/{output_path}`.

### `POST /api/inference/tts/script`

Multi-segment TTS synthesis (script mode). Each segment can have different emotions and parameters for expressive speech generation.

**Request body:**

```json
{
  "segments": [
    { "text": "你好！", "emotion": "happy" },
    { "text": "今天天气真好。", "emotion": "neutral" }
  ],
  "model_id": "tts/cosyvoice-instruct",
  "ref_audio": "assets/datasets/voices/alice.wav",
  "ref_text": "Reference transcript."
}
```

| Field     | Type   | Required | Description                       |
|-----------|--------|----------|-----------------------------------|
| segments  | array  | yes      | Array of segment objects with text and optional emotion/language fields |
| model_id  | string | no       | TTS model ID                      |
| ref_audio | string | no       | Reference audio path              |
| ref_text  | string | no       | Reference transcript              |

**Response:**

```json
{
  "success": true,
  "output_path": "tts_script_660e8400-e29b-41d4-a716-446655440001.wav",
  "duration_sec": null,
  "error": null
}
```

---

## 8. Audio Serving

### `GET /api/audio/{filename}`

Serve a generated audio file from the `output/` directory.

- Only `.wav` files are allowed (400 otherwise).
- Path traversal is prevented (403).
- Returns 404 if the file does not exist.
- Returns `Content-Type: audio/wav`.

Example: `GET /api/audio/tts_550e8400-e29b-41d4-a716-446655440000.wav`

---

## 9. Downloads

### `GET /api/downloads/presets`

List all preset models available for download, including download status and local installation info.

**Response:**

```json
[
  {
    "id": "whisper-tiny",
    "name": "Whisper Tiny",
    "model_type": "asr",
    "description": "OpenAI 轻量级语音识别模型",
    "size_mb": 151.0,
    "source": "hf-mirror",
    "repo_id": "openai/whisper-tiny",
    "dest_dir": "models/asr/whisper-tiny",
    "note": "适合 CPU 实时推理",
    "is_downloaded": true,
    "installed_model_id": "asr/whisper-tiny"
  }
]
```

Also reads custom presets from `presets.json` in the project root if it exists.

### `POST /api/downloads/presets/refresh`

Refresh the preset list (re-reads `presets.json` from disk).

**Response:**

```json
{ "success": true, "message": "预设列表已刷新" }
```

### `GET /api/downloads/repo-files`

List files in a remote HuggingFace or ModelScope repository.

**Query parameters:**

| Param    | Type   | Required | Default       | Description               |
|----------|--------|----------|---------------|---------------------------|
| repo_id  | string | yes      | --            | Repository ID (e.g. `openai/whisper-tiny`) |
| source   | string | no       | `"hf-mirror"` | Source: `"hf-mirror"` or `"modelscope"`    |

**Response:**

```json
[
  {
    "path": "model.safetensors",
    "size": 150994944,
    "size_text": "144.0 MB",
    "is_lfs": true
  },
  {
    "path": "config.json",
    "size": 1024,
    "size_text": "1.0 KB",
    "is_lfs": false
  }
]
```

### `POST /api/downloads/batch`

Start a batch download of an entire repository (or a subset of files).

**Request body:**

```json
{
  "repo_id": "openai/whisper-tiny",
  "source": "hf-mirror",
  "dest_dir": "models/asr/whisper-tiny",
  "files": ["model.safetensors", "config.json"]
}
```

| Field    | Type     | Required | Description                                            |
|----------|----------|----------|--------------------------------------------------------|
| repo_id  | string   | yes      | Repository ID                                          |
| source   | string   | yes      | `"hf-mirror"` or `"modelscope"`                        |
| dest_dir | string   | yes      | Destination directory (relative to project root)       |
| files    | string[] | no       | Specific files to download; omit to download all files |

Downloads run concurrently (max 3 parallel). On full success, a model scan is triggered automatically.

**Response** (task created):

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "mode": "batch",
  "repo_id": "openai/whisper-tiny",
  "source": "hf-mirror",
  "dest_dir": "models/asr/whisper-tiny",
  "url": "",
  "dest": "models/asr/whisper-tiny",
  "total_files": 5,
  "completed_files": 0,
  "current_file": null,
  "status": "pending",
  "progress": 0.0,
  "speed_mbps": 0.0,
  "error": null,
  "failed_files": []
}
```

Task status transitions: `pending` -> `running` -> `completed` / `failed` / `partial_failed` / `cancelled`.

### `POST /api/downloads`

Start a single-file download.

**Request body:**

```json
{
  "url": "https://example.com/model.bin",
  "dest": "models/custom/model.bin"
}
```

| Field | Type   | Required | Description                    |
|-------|--------|----------|--------------------------------|
| url   | string | yes      | Download URL                   |
| dest  | string | yes      | Destination path (project-relative) |

**Response:** `DownloadTask` object (same shape as batch, with `mode: "single"`).

### `GET /api/downloads`

List all download tasks (active and completed).

**Response:**

```json
[
  {
    "id": "550e8400-...",
    "mode": "batch",
    "status": "running",
    "progress": 45.2,
    "speed_mbps": 12.5,
    ...
  }
]
```

### `GET /api/downloads/{id}`

Get status of a specific download task. Returns `null` if the task ID does not exist.

**Response:** `DownloadTask` object or `null`.

### `POST /api/downloads/{id}/cancel`

Cancel an active download task (single or batch).

**Response:**

```json
{ "success": true }
```

### `POST /api/downloads/{id}/retry`

Retry a failed or partially-failed batch download. Only re-downloads files that failed.

**Constraints:**
- Task must have status `failed` or `partial_failed`
- Task must be in `batch` mode (single mode not supported)

**Response:** New `DownloadTask` object.

**Error:**

```json
{ "error": "只能重试失败或部分失败的任务" }
```

### `DELETE /api/downloads/{id}`

Cancel (if active) and remove a download task from the task list.

**Response:**

```json
{ "success": true }
```

---

## 10. Agents

The agent scheduler orchestrates multi-step pipelines combining ASR, TTS, and LLM capabilities.

### `GET /api/agents`

List all available agent capabilities and pipeline definitions.

**Response:**

```json
{
  "agents": [
    {
      "id": "tts",
      "name": "语音合成",
      "model_id": "tts/glm-tts-full",
      "input_kind": "text",
      "output_kind": "audio",
      "description": "GLM-TTS zero-shot 声音克隆"
    },
    {
      "id": "asr",
      "name": "语音识别",
      "model_id": "asr/paraformer-large",
      "input_kind": "audio",
      "output_kind": "text",
      "description": "FunASR Paraformer-Large 中文语音识别"
    },
    {
      "id": "llm",
      "name": "智能对话",
      "model_id": "llm/gemma4:e4b",
      "input_kind": "text",
      "output_kind": "text",
      "description": "Ollama LLM 对话"
    }
  ],
  "pipelines": [
    {
      "id": "asr->llm",
      "name": "语音→对话",
      "steps": [
        { "label": "语音识别", "agent_id": "asr" },
        { "label": "LLM 回复", "agent_id": "llm" }
      ],
      "description": "音频输入 → 转文字 → LLM 生成回复"
    }
  ]
}
```

### `POST /api/agents/run`

Execute a pipeline synchronously.

**Request body:**

```json
{
  "pipeline": "asr->llm",
  "input": {
    "audio_path": "/path/to/audio.wav"
  }
}
```

| Field    | Type   | Required | Description                                 |
|----------|--------|----------|---------------------------------------------|
| pipeline | string | yes      | Pipeline ID from `GET /api/agents`          |
| input    | object | yes      | Pipeline-specific input parameters          |

**Response:**

```json
{
  "success": true,
  "task_id": "770e8400-e29b-41d4-a716-446655440002"
}
```

### `POST /api/agents/run-stream`

Execute a pipeline with streaming support. LLM tokens are emitted as SSE events on the task's event stream. Same request body as `POST /api/agents/run`.

**Response:**

```json
{
  "success": true,
  "task_id": "880e8400-e29b-41d4-a716-446655440003"
}
```

Connect to `GET /api/agents/tasks/{task_id}/events` to receive the stream.

### `GET /api/agents/tasks/{id}`

Query the status and result of an agent task.

**Response** (in progress):

```json
{
  "id": "770e8400-...",
  "pipeline_id": "asr->llm",
  "status": "running",
  "current_step": "LLM 回复",
  "result": null,
  "error": null,
  "created_at": "2026-07-04T10:30:00Z"
}
```

**Response** (completed):

```json
{
  "id": "770e8400-...",
  "pipeline_id": "asr->llm",
  "status": "completed",
  "current_step": null,
  "result": "这是流水线的最终输出结果。",
  "error": null,
  "created_at": "2026-07-04T10:30:00Z"
}
```

**Response** (not found):

```json
{ "error": "任务不存在" }
```

### `GET /api/agents/tasks/{id}/events`

SSE stream of task progress events. Returns `Content-Type: text/event-stream`.

**Event data:**

```json
{"task_id":"770e8400-...","status":"running","step":"语音识别","progress":0.5,"message":"正在识别..."}
{"task_id":"770e8400-...","status":"running","step":"LLM 回复","delta":"你好"}
{"task_id":"770e8400-...","status":"running","step":"LLM 回复","delta":"，有什么"}
{"task_id":"770e8400-...","status":"running","step":"LLM 回复","delta":"可以帮助你的？"}
{"task_id":"770e8400-...","status":"completed","progress":1.0,"message":"流水线执行完成"}
```

Events contain one or more of: `step`, `progress`, `message`, `delta`. The stream closes when the task reaches `completed` or `failed` status.

---

## 11. SSE Progress

### `GET /api/sse/progress`

General-purpose SSE heartbeat endpoint. Emits a heartbeat event every second.

**Event data:**

```json
{"type":"heartbeat","seq":0,"timestamp":"2026-07-04T10:30:00+00:00"}
```

Uses a 15-second keep-alive interval. Suitable for monitoring connection health.

---

## Common Patterns

### Error Handling

Most endpoints return HTTP 200 even on errors, with a JSON body containing an `"error"` string field. Exceptions:

- Voice upload endpoints return proper HTTP status codes (400, 413, 500)
- Audio serving returns 400, 403, 404, 500
- Agent tasks return 200 with `{ "error": "..." }` for not-found

### Model Selection Fallback

Inference endpoints (ASR, TTS) and chat use this priority for selecting the model:

1. Explicit `model_id` in the request body
2. Type-specific config (`current_asr_model`, `current_tts_model`, `current_llm_model`)
3. Legacy `current_model_id` config
4. First available model of the matching type from the scanned model list

### Concurrency Safety

- The application state is protected by a `tokio::sync::RwLock`
- Model deletion is blocked while inference is active on that model
- Batch downloads are limited to 3 concurrent file downloads
- Agent pipelines use per-model semaphores for concurrency control

### Config Persistence

Configuration changes via `POST /api/config` and `POST /api/config/set-model` are persisted to disk. On write failure, the in-memory state is rolled back.
