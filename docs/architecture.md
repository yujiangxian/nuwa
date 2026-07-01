# Nuwa 系统架构

## 总体架构图

```
┌──────────────────────────────────────────────────────────┐
│  浏览器 (React 19)                                        │
│  ┌─────────┐ ┌──────────┐ ┌──────┐ ┌────────┐ ┌───────┐ │
│  │ ChatPage│ │VoiceStudio│ │Models│ │Transcr.│ │...    │ │
│  └────┬────┘ └────┬─────┘ └──┬───┘ └───┬────┘ └───────┘ │
│       │         │         │        │                    │
│  ┌────┴─────────┴─────────┴────────┴───────────────────┐│
│  │ Zustand Stores (uiStore + 3 sub-stores)             ││
│  │ TanStack Query (useApi.ts)                          ││
│  │ IndexedDB (chatDb / characterDb / presetDb)         ││
│  └────────────────────┬─────────────────────────────────┘│
└────────────────────────┼──────────────────────────────────┘
                         │ HTTP/SSE (Vite proxy :5173 → :8080)
┌────────────────────────┼──────────────────────────────────┐
│   Rust Axum :8080      │                                  │
│  ┌─────────────────────┴────────────────────────────────┐ │
│  │ Routes (mod.rs)                                      │ │
│  │ /api/chat  /api/chat/stream  /api/inference/{tts/asr}│ │
│  │ /api/models  /api/voices  /api/downloads  /api/config│ │
│  └────┬─────────────────────────────────────────────────┘ │
│  ┌────┴──────────────────────────┐                        │
│  │ Handlers (11 files)           │                        │
│  │ chat / chat_stream / inference│                        │
│  │ models / voices / download    │                        │
│  │ config / audio / sse / system │                        │
│  └────┬──────────────────────────┘                        │
│  ┌────┴──────────────────────────┐                        │
│  │ Services (5 files)            │                        │
│  │ model_scanner / downloader    │                        │
│  │ inference / voice_library     │                        │
│  │ repo_fetcher                  │                        │
│  └────┬──────────────────────────┘                        │
│       │                                                   │
│  ┌────┴───────────┐  ┌─────────────────────┐             │
│  │ AppState       │  │ config_persist.rs   │             │
│  │ (Arc<RwLock>)  │  │ (JSON config read/wr)│            │
│  └────────────────┘  └─────────────────────┘             │
└──────────┬────────────────────────────────────────────────┘
           │
    ┌──────┴──────┐     ┌──────────────┐
    │ Ollama API  │     │ Python 子进程 │
    │ :11434      │     │ (ASR/TTS 推理)│
    │ LLM 推理    │     │ scripts/      │
    └─────────────┘     └──────────────┘
```

## 前端架构

```
app/web/src/
├── api/client.ts          # Axios 客户端 (baseURL 空, Vite proxy 转发)
├── store/
│   ├── uiStore.ts         # 主 Store: 会话/消息/搜索/预设/UI 状态
│   ├── characterStore.ts  # 角色 CRUD + IndexedDB
│   ├── settingsStore.ts   # 应用设置 + localStorage
│   ├── presetStore.ts     # 预设 CRUD + IndexedDB (待接入)
│   ├── index.ts           # Config + Model Store
│   ├── toastStore.ts      # Toast 通知
│   └── types.ts           # 共享 TypeScript 类型
├── hooks/
│   ├── useApi.ts          # TanStack Query: 所有 API hooks
│   ├── useAudioPlayer.ts  # Web Audio API 播放
│   ├── useRecorder.ts     # 浏览器录音
│   └── ...
├── components/
│   ├── ChatPage.tsx       # 对话页 (1394 行, 流式 SSE)
│   ├── VoiceStudioPage.tsx # 声音工坊 (736 行)
│   ├── ModelsPage.tsx     # 模型管理 (860 行)
│   ├── TranscribePage.tsx # 录音转写 (275 行)
│   ├── characters/        # 角色管理
│   ├── models/            # 7 个模型子组件
│   └── ...
└── lib/                   # 50+ 纯逻辑模块 (每个有测试)
    ├── chatDb.ts          # 会话 IndexedDB 访问
    ├── markdown.ts        # Markdown 渲染
    ├── generationParams.ts # LLM 生成参数
    ├── workflow/          # 工作流引擎
    └── ...
```

## 后端架构

```
backend/server/src/
├── main.rs              # 启动入口: 模型扫描 + 音色对账 + 路由绑定
├── lib.rs               # 库根 (pub 所有模块)
├── state.rs             # AppState: 配置 + 模型 + 音色 + 下载
├── config_persist.rs    # config.json 读写 + 向后兼容迁移
├── constants.rs         # 共享常量 (Ollama URL / 默认音频)
├── error.rs             # AppError (thiserror) + AppResult<T>
├── routes/mod.rs        # Axum Router
├── middleware/mod.rs    # CORS
├── handlers/            # HTTP 端点 (11 文件)
│   ├── chat.rs          # 非流式对话 + Ollama helpers
│   ├── chat_stream.rs   # SSE 流式对话
│   ├── inference.rs     # ASR/TTS + 多段情绪 TTS
│   ├── models.rs        # 模型 CRUD
│   ├── voices.rs        # 音色库 CRUD
│   ├── download.rs      # 下载管理
│   └── ...
└── services/            # 业务逻辑 (5 文件)
    ├── inference.rs     # Python 子进程编排
    ├── model_scanner.rs # 本地 + Ollama 模型发现
    ├── downloader.rs    # 分片下载引擎
    ├── voice_library.rs # 音色持久化 + 对账
    └── repo_fetcher.rs  # HF/ModelScope 仓库列表
```

## 数据流 — 对话/语音链路

```
用户输入文本
  → ChatPage.tsx 调用 useUIStore.sendMessage()
  → POST /api/chat/stream (SSE)
  → chat_stream.rs → Ollama /api/chat
  → 流式返回 delta → ChatPage 实时渲染 Markdown

用户点击 TTS 播放按钮
  → VoiceStudioPage.speakMessage()
  → POST /api/inference/tts { text, model_id, ref_audio }
  → inference.rs → subprocess: python scripts/inference_tts_glm.py
  → 写 WAV → output/ → /api/audio/{id}
  → ChatPage 播放 audio URL

用户点击录音按钮
  → TranscribePage.useRecorder()
  → POST /api/inference/asr/upload (multipart Blob)
  → inference.rs → subprocess: python scripts/inference_asr_paraformer.py
  → 返回 text → TranscribePage 展示/复制
```

## 测试策略

| 层 | 技术 | 文件数 | 测试数 |
|---|---|---|---|
| 前端 | Vitest + fast-check + fake-indexeddb | 352 | 970 |
| 后端 | cargo test + 3 integration tests | 3 | 53 |
| Python | core/tests/ | 1 | 2 |
