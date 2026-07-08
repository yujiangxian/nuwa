# Nuwa 项目文件结构

```
nuwa/
│
├── 📄 README.md              项目说明
├── 📄 CHANGELOG.md            版本变更历史 (v0.1.0 → v0.4.0)
├── 📄 CONTRIBUTING.md         贡献指南
├── 📄 Makefile                构建入口 (dev/api/test/install)
├── 📄 config.json             服务端运行配置 (LLM/ASR/TTS 模型选择等)
│
├── 📁 .claude/                Claude Code 配置
│   ├── launch.json             预览服务器定义 (Vite 5173)
│   ├── settings.local.json     本地权限配置
│   └── self-review-checklist.md 自我审查清单
│
├── 📁 docs/                   项目文档
│   ├── module-landscape.md     19个功能模块全景图 (状态+缺口)
│   ├── data-lifecycle.md       数据生命周期规范
│   ├── api.md                  31个API端点文档
│   └── file-structure.md       本文件
│
├── 📁 app/web/                前端 (React 19 + Vite + TypeScript)
│   ├── package.json
│   ├── vite.config.ts           Vite 配置 (proxy /api→8080)
│   └── src/
│       ├── App.tsx              路由入口、页面切换、懒加载
│       ├── main.tsx             ReactDOM 挂载点
│       │
│       ├── 📁 api/
│       │   └── client.ts        Axios 客户端 (超时/重试/X-Request-Id)
│       │
│       ├── 📁 store/            状态管理 (Zustand)
│       │   ├── index.ts         旧 ConfigStore + 模块导出
│       │   ├── uiStore.ts       核心 store (session/message/character/preset/search/ui)
│       │   ├── settingsStore.ts 设置持久化 (localStorage)
│       │   ├── characterStore.ts 角色 IndexedDB 持久化
│       │   ├── toastStore.ts    Toast 通知
│       │   └── types.ts         共享类型 (ChatMessage/ChatSession/Character 等)
│       │
│       ├── 📁 hooks/            React Hooks
│       │   ├── useApi.ts         react-query hooks (useConfig/useModels/useVoices/useSynthesize 等)
│       │   ├── useAudioQueue.ts  FIFO 音频队列 (enqueue/playNow/clear/setSpeed)
│       │   ├── useRecorder.ts   MediaRecorder 麦克风录音
│       │   ├── useThemeEffect.ts 主题副作用
│       │   ├── useLangEffect.ts  语言副作用
│       │   ├── useKeybindings.ts 全局快捷键引擎
│       │   └── useI18n.ts       国际化
│       │
│       ├── 📁 lib/              纯函数/工具库 (无副作用)
│       │   ├── chatDb.ts         IndexedDB 封装 (DB_VERSION=2, 迁移框架)
│       │   ├── chatSession.ts    会话工具 (pickLatestSession/formatRelativeTime)
│       │   ├── chatSearch.ts     全文搜索
│       │   ├── chatTitle.ts      自动标题生成
│       │   ├── commandPalette.ts  Ctrl+K 命令面板
│       │   ├── contextBudget.ts  上下文预算计算
│       │   ├── contextTrim.ts    上下文裁剪算法
│       │   ├── contextWindow.ts  上下文窗口解析
│       │   ├── conversationExport.ts 会话导入导出
│       │   ├── errorDetail.ts    错误信息提取
│       │   ├── generationParams.ts 生成参数 (temperature/topP 等)
│       │   ├── i18n.ts           多语言翻译表
│       │   ├── markdown.ts       Markdown 安全渲染 (sanitize/parse/highlight)
│       │   ├── messageActions.ts 消息操作可用性矩阵
│       │   ├── modelFilter.ts    模型筛选
│       │   ├── modelSort.ts      模型排序
│       │   ├── modelTypes.ts     模型类型定义
│       │   ├── promptPreset.ts   提示词预设 (变量/插入/校验)
│       │   ├── promptPresetDb.ts 预设 IndexedDB 持久化
│       │   ├── sentenceSplit.ts  句子边界检测 (流式 TTS)
│       │   ├── sessionOrganize.ts 会话分组/置顶
│       │   ├── slashCommand.ts   斜杠命令 (/clear /retry /presets)
│       │   ├── streamChat.ts     流式聊天协议 (accumulateDelta/shouldPersistFinal)
│       │   ├── tokenEstimate.ts  Token 估算
│       │   ├── voice.ts          音色解析
│       │   └── workflow/         工作流引擎 (图定义/执行/序列化)
│       │
│       ├── 📁 components/       页面组件
│       │   ├── HomePage.tsx          首页 (9个模块入口)
│       │   ├── ChatPage.tsx          ★ 智能对话 (1500+ 行核心组件)
│       │   ├── PlaygroundPage.tsx    ★ 模型调参测试台
│       │   ├── VoiceStudioPage.tsx   声音工坊
│       │   ├── TranscribePage.tsx    录音转写
│       │   ├── ModelsPage.tsx        模型管理
│       │   ├── CharactersPage.tsx    角色管理
│       │   ├── PromptPresetsPage.tsx 提示词管理
│       │   ├── WorkflowPage.tsx      工作流编排
│       │   ├── SettingsModal.tsx     设置弹窗
│       │   ├── CommandPalette.tsx    Ctrl+K 命令面板
│       │   ├── SlashCommandMenu.tsx  斜杠命令菜单
│       │   ├── MarkdownMessage.tsx   Markdown 渲染 (remark/rehype)
│       │   ├── CodeBlock.tsx         代码块 (语法高亮/复制)
│       │   ├── ParamPanel.tsx        参数面板
│       │   ├── UsageIndicator.tsx    用量指示器
│       │   ├── ToastContainer.tsx    Toast 容器
│       │   ├── ErrorBoundary.tsx     错误边界
│       │   └── models/              模型管理子组件
│       │       ├── ModelCard.tsx
│       │       ├── ActiveModelBanner.tsx
│       │       ├── DiskBar.tsx
│       │       ├── GpuBar.tsx
│       │       ├── DownloadTaskCard.tsx
│       │       ├── FileSelectionModal.tsx
│       │       └── DeleteConfirmModal.tsx
│       │
│       └── 📁 styles/
│           └── globals.css          全局样式 (暗/亮主题变量、动画、组件类)
│
├── 📁 backend/server/         后端 (Rust Axum 0.8)
│   ├── Cargo.toml
│   └── src/
│       ├── main.rs                 ★ 启动入口 (模型扫描、音色对账、清理、中间件)
│       ├── lib.rs                  库根 (模块导出)
│       ├── config_persist.rs       配置持久化 (原子写入、NUWA_CONFIG 环境变量)
│       ├── constants.rs            常量 (Ollama URL、默认音色、TTS 保留期)
│       ├── state.rs                应用状态 (AppConfig/ModelInfo/VoiceInfo/ScanProgress)
│       ├── error.rs                AppError 统一错误类型
│       ├── util.rs                 工具 (project_root/python_exe/safe_resolve/format_size)
│       ├── routes/mod.rs           路由注册 (65 条路由)
│       ├── middleware/mod.rs       CORS + 安全头部中间件
│       │
│       ├── 📁 handlers/           请求处理器
│       │   ├── mod.rs              /health 健康检查
│       │   ├── config.rs           GET|POST /api/config, POST /api/config/set-model
│       │   ├── chat.rs             POST /api/chat (非流式对话、模型回退逻辑)
│       │   ├── chat_stream.rs      POST /api/chat/stream (流式 SSE)
│       │   ├── agents.rs           Agent 流水线 (run/run-stream/tasks/events)
│       │   ├── models.rs           模型 CRUD (list/scan/delete/meta/files)
│       │   ├── download.rs         模型下载 (分块/断点续传/取消/重试/仓库浏览)
│       │   ├── inference.rs        ★ ASR/TTS 推理 (synthesize/transcribe/upload/script)
│       │   ├── audio.rs            音频文件服务 (流式传输/Cache-Control)
│       │   ├── voices.rs           音色库 CRUD (上传/删除/试听)
│       │   ├── system.rs           系统信息 (disk/gpu/cleanup)
│       │   └── sse.rs              SSE 进度推送
│       │
│       └── 📁 services/           业务服务层
│           ├── inference.rs        推理子进程封装 (ASR/TTS/script, 超时, WAV 时长)
│           ├── agent_scheduler.rs  ★ Agent 调度器 (流水线执行、SSE 事件、Ollama 流式)
│           ├── model_scanner.rs    模型扫描 (本地+Ollama, context_length 识别)
│           ├── voice_library.rs    音色库持久化 (存储/对账)
│           └── repo_fetcher.rs     模型仓库获取 (HuggingFace API)
│
├── 📁 backend/server/tests/   后端集成测试
│   ├── integration.rs
│   └── chat_stream.rs
│
├── 📁 scripts/                Python 推理脚本
│   ├── inference_asr_paraformer.py
│   ├── inference_asr_whisper.py
│   ├── inference_asr_glm.py
│   ├── inference_asr_qwen3.py
│   ├── inference_tts_cosyvoice.py
│   ├── inference_tts_glm.py
│   ├── inference_tts_glm_script.py  (多段情绪 TTS)
│   ├── inference_tts_qwen3.py
│   └── inference_tts_openvoice.py
│
├── 📁 assets/datasets/voices/ 参考音频 (jyy/stefanie/narrator/anime 等)
│
├── 📁 .kiro/specs/           21 份功能规格 (design/requirements/tasks)
│
└── 📁 .github/workflows/     CI/CD (frontend + backend)
```

## 数据流关系

```
用户输入 → ChatPage.tsx
  → POST /api/agents/run-stream { pipeline: "text_chat_stream", messages, system }
  → agent_scheduler.rs: text_chat_stream pipeline
    → Ollama /api/chat (stream: true)
    → SSE TaskEvent { delta/thinking/status } → EventSource
  → ChatPage.tsx onmessage → streamingThinking/streamingContent
    → extractNewSentences() → 逐句 POST /api/inference/tts
    → TtsResponse { output_path, duration_sec }
    → useAudioQueue.enqueue() → HTMLAudioElement 播放
    → updateMessageAudio() → IndexedDB 持久化
  → finally: appendMessage() → 消息定型落库

设置变更 → SettingsModal.tsx
  → localStorage (theme/autoPlay/language/backendUrl)
  → POST /api/config/set-model (模型切换)
  → IndexedDB (角色/预设)
```

## 关键文件大小

| 文件 | 行数 | 职责 |
|------|------|------|
| ChatPage.tsx | ~1560 | 智能对话核心 |
| uiStore.ts | ~920 | 全局状态管理 |
| agent_scheduler.rs | ~720 | Agent/LLM 调度 |
| inference.rs (handler) | ~600 | ASR/TTS 请求处理 |
| PlaygroundPage.tsx | ~450 | 模型调参测试 |
| ModelsPage.tsx | ~450 | 模型管理 |
| VoiceStudioPage.tsx | ~400 | 声音工坊 |
