# Changelog

本项目的所有显著变更将记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

---

## [0.4.0] — 2026-07-06

### 安全加固
- CORS origin 解析 panic → warning 降级，单个错误配置不导致服务崩溃
- 全局请求体限制 50MB (`tower_http::limit::RequestBodyLimitLayer`)
- ASR/TTS 用户输入路径遍历防护 (`safe_resolve`)
- 标准安全头部注入 (X-Content-Type-Options, X-Frame-Options, X-XSS-Protection)
- TTS 文本长度限制 5000 字符
- model_type 枚举校验（拒绝非 llm/asr/tts 的值）

### 配置与基础设施
- 配置文件路径从 exe 目录移至项目根 (`config.json`)，支持 `NUWA_CONFIG` 环境变量
- 移除遗留字段 `voxcpm_tts_path` / `voxcpm_server_path` / `current_model_id`
- 配置写入原子化 (`.json.tmp` → rename)
- 未知配置键打印 warn 日志
- 启动时校验已配置模型存在性，兼容带/不带 `llm/` 前缀

### 文件管理
- TTS 输出文件自动清理：启动时清除 >7 天的 WAV
- `POST /api/system/cleanup` 手动清理端点（24h 阈值）
- `/api/system/disk` 新增加 models/output/voices 分目录大小
- SettingsModal "清除数据" 按钮联动后端清理 API

### 数据库
- IndexedDB nuwa-chat DB_VERSION=1→2，onupgradeneeded 按 oldVersion 分步迁移
- ChatMessage 新增 `_seq` 字段，updateMessageAudio 复用而非数组下标

### 前端 API 客户端
- 每个请求附加 `X-Request-Id` 头用于追踪
- GET/HEAD/OPTIONS 请求 5xx 自动重试 1 次（指数退避 1s）
- settingsStore 读取时逐字段类型校验

### 子进程可靠性
- 所有 Python 推理子进程统一 600 秒超时
- 子进程 stderr 全文记录到 tracing（不再只截断 500 字节）
- StringTruncate 从字节切片改为字符边界安全截断
- ModelGuard RAII 守卫：handler panic 时自动清理 active_inference_models

### 项目结构
- crate 重命名: voxcpm-server → nuwa-server
- Makefile 完全重写（旧版描述的是不存在的 Tauri 桌面端项目）
- README 项目树更新至当前结构
- 新增 `docs/data-lifecycle.md` 数据生命周期文档
- 删除 6 个空的遗留目录 (external/, results/, ops/docker/, ops/slurm/, ops/configs/, scripts/ci/)
- CHANGELOG 补全 v0.1.0 → v0.4.0 版本历史

### 音频服务
- WAV 文件流式传输 (8KB chunks, ReaderStream)，不再全量读入内存
- 响应头 Cache-Control: max-age=86400 (浏览器 24 小时缓存)
- 响应头 Accept-Ranges: bytes (HTML5 音频可拖进度条)
- TTS 清理阈值统一为 `NUWA_TTS_RETENTION_DAYS` 环境变量 (默认 7 天)

### 导出
- "导出全部数据" 现在包含 characters + presets + settings + sessions

---

## [0.3.0] — 2026-06

### 新增
- 流式 Agent 流水线 (`POST /api/agents/run-stream` + SSE)
- 流式逐句 TTS (ChatPage 打字机 + 同步语音合成)
- PlaygroundPage（多轮对话、模型对比、参数面板）
- 角色导入导出 + 情绪/温度绑定 + 复制
- 提示词标签/搜索/导入导出
- 声音工坊波形可视化 + 合成历史
- 录音转写 SRT/TXT 导出 + 文件预览
- 工作流编排 Agent 流水线对接
- 全局命令面板 (Ctrl+K) + 键盘快捷键
- 系统提示词可见可编辑
- Token 使用量进度条 + 上下文裁剪提示
- 消息反馈 (👍👎)
- 音频播放语速控制 (0.5x/1x/1.5x/2x)
- 草稿持久化 (localStorage per sessionId)

### 变更
- 默认角色从小助手 → 季莹莹
- agent_scheduler 支持流式 `text_chat_stream` 流水线
- ChatPage TTS 播放按钮状态机重写（合成中/播放/停止 三态）

### 修复
- TTS 会话间消息泄露（ssn switch 时自动 stop）
- ttsPendingMsgId 释放时机 + 双重点击防护
- 上下文裁剪通知展示

---

## [0.2.0] — 2026-05-05

### 新增
- GLM-TTS zero-shot 音色克隆
- 多段情绪 TTS 脚本合成
- CI/CD workflows (frontend + backend)
- 后端集成测试 + E2E smoke 测试
- API 文档 (`docs/api.md`) 31 个端点

### 变更
- 默认 TTS 模型: CosyVoice2 → GLM-TTS (Full)
- 默认 ASR 模型: Paraformer-Large
- 默认 LLM 模型: Gemma 4 E4B

---

## [0.1.0] — 2026-05-01

### 新增
- Nuwa 项目初始化
- React 19 + Vite 前端框架
- Rust Axum 0.8 后端框架
- 9 个功能模块首页（Home/Chat/Voice/Playground/...）
- 模型扫描（本地 + Ollama）
- CosyVoice2/Qwen3-TTS/Whisper/Paraformer 推理管线
- 音色库 CRUD + 启动对账
- 下载管理（分块 + 断点续传）
- 会话/角色/预设 IndexedDB 持久化
- 深色/浅色/系统主题
- 中/英/日三语界面框架
