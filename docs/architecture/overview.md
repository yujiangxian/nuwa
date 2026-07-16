# 女娲 (Nuwa) 平台架构总览

> 边缘端多模态 AI 助手 —— 本地运行、零数据外传

---

## 1. 产品定位

**目标**：在本地 Windows PC（AMD ROCm 或 NVIDIA CUDA）上运行一个类似"豆包 APP"的智能交互终端，支持：
- 语音对话（说 → 听 → 回答）
- 文本对话
- 声音克隆与合成
- 多模型统一管理

**核心约束**：
- 所有推理本地运行，零数据外传
- 支持 AMD ROCm（如 RX 9070 XT）与 NVIDIA CUDA（如 RTX 5070）；国产 DCU 为远期兼容目标
- 模型文件大（数十 GB），需精细管理显存和磁盘
- GPU 后端由 `NUWA_GPU_BACKEND` + SMI 自动检测选择（见 `docs/nvidia_cuda_setup.md` / `docs/rx9070xt_ai_setup.md`）

---

## 2. 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                        前端 (React 19)                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │  Home    │  │  Chat    │  │ Voice    │  │ Models   │   │
│  │  首页    │  │  智能对话 │  │ 声音工坊 │  │ 模型管理 │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
│                                                             │
│  状态管理: Zustand    HTTP: Axios    UI: Tailwind v3       │
└──────────────────────────┬──────────────────────────────────┘
                           │ Vite Proxy /api → localhost:8080
┌──────────────────────────┴──────────────────────────────────┐
│                      后端 (Rust Axum)                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │  Chat    │  │ Inference│  │  Models  │  │ Download │   │
│  │  Handler │  │  Service │  │  Service │  │  Service │   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘   │
│       │             │             │             │          │
│       ▼             ▼             ▼             ▼          │
│  ┌─────────────────────────────────────────────────────┐  │
│  │              AppState (共享状态)                       │  │
│  │  config  models  voices  download_tasks               │  │
│  └─────────────────────────────────────────────────────┘  │
└──────────────────────────┬──────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
  ┌──────────┐     ┌──────────────┐    ┌──────────┐
  │  Ollama  │     │ Python 子进程 │    │ models/  │
  │localhost │────▶│ ASR / TTS    │    │ 目录     │
  │ :11434   │     │              │    │          │
  └──────────┘     └──────────────┘    └──────────┘
```

---

## 3. 模块边界与职责

| 模块 | 职责 | 边界原则 |
|------|------|---------|
| **前端 Router** | 页面路由、全局状态、主题切换 | 不直接调用 Ollama，全部走后端 API |
| **Chat** | 对话界面、消息渲染、语音播放 | 不处理 ASR/TTS 细节，调用 `/api/chat` 和 `/api/inference/tts` |
| **VoiceStudio** | 录音、ASR 转写、TTS 合成参数调节 | 录音用 Web Audio API，转写/合成走后端 API |
| **ModelsPage** | 模型展示、切换、下载、扫描 | 统一视图，不区分本地/Ollama，按类型过滤 |
| **后端 Chat** | 转发到 Ollama `/api/chat` | 仅做协议转换，不缓存对话历史 |
| **后端 Inference** | 启动 Python 子进程执行 ASR/TTS | 超时 300s，子进程 stdout/stderr 收集 |
| **后端 Models** | 扫描 `models/` + 查询 Ollama API | 统一输出 `ModelInfo[]`，前端无感知来源差异 |
| **后端 Download** | 并行下载 HuggingFace/ModelScope 文件 | 支持断点续传、并发控制、进度追踪 |

---

## 4. 核心数据模型

### 4.1 模型统一表示

所有模型（本地权重 + Ollama + 未来其他来源）统一用 `ModelInfo` 表示：

```rust
struct ModelInfo {
    id: String,           // 全局唯一: "asr/paraformer-large", "llm/gemma4:e4b"
    name: String,         // 友好名称
    model_type: String,   // "asr" | "tts" | "llm" | "other"
    source: String,       // "local" | "ollama" | "api"
    path: String,         // 本地路径或 ollama://name
    size_mb: f64,
    quant: String,        // 量化格式
    // ...
}
```

### 4.2 配置模型（关键修正）

**之前的错误**：用 `current_model_id` 一个字段同时表示 ASR/TTS/LLM，导致语义混乱。

**正确设计**：三类模型各自独立配置，UI 上各自切换，互不影响。

```rust
struct AppConfig {
    // LLM 对话模型（Ollama 托管）
    current_llm_model: Option<String>,   // e.g. "gemma4:e4b"

    // 语音模型（本地权重）
    current_asr_model: Option<String>,   // e.g. "asr/paraformer-large"
    current_tts_model: Option<String>,   // e.g. "tts/cosyvoice3"

    // 音色配置
    current_voice_id: Option<String>,
    ref_audio_path: Option<String>,
    ref_text: Option<String>,

    // UI
    theme: String,
    auto_play: bool,
    language: String,

    // 路径
    models_dir: String,
    output_dir: String,
}
```

### 4.3 端到端语音对话数据流

```
用户点击 Mic ──▶ MediaRecorder 录音 ──▶ Blob (webm)
                                    │
                                    ▼
                     POST /api/inference/asr/upload
                     (multipart, audio blob)
                                    │
                                    ▼
                     Rust 保存临时文件 ──▶ Python ASR 推理
                                    │
                                    ▼
                     识别文本填入输入框
                                    │
                                    ▼
                     用户确认/编辑后发送
                                    │
                                    ▼
                     POST /api/chat ──▶ Ollama LLM
                                    │
                                    ▼
                     收到 assistant 回复
                                    │
                                    ▼
                     POST /api/inference/tts
                     (text + ref_audio + ref_text)
                                    │
                                    ▼
                     Rust ──▶ Python TTS 推理 ──▶ output/*.wav
                                    │
                                    ▼
                     GET /api/audio/{filename}
                                    │
                                    ▼
                     HTMLAudioElement 播放
```

---

## 5. 当前已暴露的架构缺陷

| # | 缺陷 | 影响 | 修复状态 |
|---|------|------|---------|
| 1 | `current_model_id` 语义混杂 | ASR/TTS/LLM 切换互相干扰 | ✅ 已修复（分离为 `current_llm_model`）|
| 2 | ASR API 只接受服务器本地路径 | 前端录音后无法直接上传 | ✅ 已修复（新增 `/api/inference/asr/upload`）|
| 3 | TTS 首次加载 16s+ | 用户体验差 | ⚠️ 需长驻进程或模型预热 |
| 4 | ChatPage 无语音输入 | 必须打字 | ⚠️ 需接入 ASR 上传链路 |
| 5 | 无统一参考音频管理 | TTS 每次传空字符串 | ⚠️ 需 Voice 配置持久化 |
| 6 | Ollama 模型名称不友好 | 显示 `gemma4:e4b` | ⚠️ 需名称映射表 |
| 7 | 无 ASR/TTS 分别配置 | 只能选一个"当前模型" | ⚠️ 需拆分 `current_asr_model` / `current_tts_model` |

---

## 6. 扩展预留

| 方向 | 说明 | 预期模型 |
|------|------|---------|
| 多模态 LLM | 一张图+一句话理解 | Qwen3-Omni-30B-A3B |
| 端到端语音 LLM | 语音进语音出，跳过 ASR+TTS 级联 | Qwen3-Omni / GLM-4-Voice |
| 实时语音对话 | 流式 ASR + 流式 TTS | 需 WebSocket 或 SSE |
| 角色记忆 | 长期对话记忆，RAG 知识库 | 本地向量数据库 |
