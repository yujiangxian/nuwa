# 女娲 Nuwa — Roadmap 2026

> 开源社区项目 — 本地多模型 AI 助手平台。核心差异化：全本地运行 + 声音克隆 + IM 聊天机器人。

## 当前版本状态 (v0.2)

| 模块 | 状态 | 技术 |
|------|------|------|
| LLM 对话 | ✅ | Ollama Gemma 4 E4B + 流式 SSE |
| ASR 识别 | ✅ | Paraformer-Large (默认) |
| TTS 合成 | ✅ | GLM-TTS + 多段情绪 + 季莹莹音色 |
| 模型管理 | ✅ | HuggingFace/ModelScope 下载 + 扫描 |
| 音色库 | ✅ | 上传/试听/删除 |
| 角色系统 | ✅ | 已并入 Agent（人设 + 执行方式） |
| 代码质量 | ✅ | 970 测试 + TS strict + CI |

## Phase 1: 文档更新 + 代码收尾 (完成)

- [x] README 状态表更新
- [x] `docs/tested_models.md` GLM-TTS 状态更新
- [x] `docs/roadmap.md` 替换
- [x] `docs/architecture.md` 新建
- [x] 清理超算文档与敏感信息
- [ ] `presetStore` / `sessionStore` 接入
- [ ] `docs/project.md` 删除（超算相关内容已清理）

## Phase 2: Agent 调度层 — 统一任务编排

**目标**: Chat 调用可配置 Agent；Agent 页定义本地/编排/外部智能体。

### 2.0 产品入口
- [x] 规划文档：`docs/features/agents.md`（V1/V2/V3）
- [x] 首页「Agent」与智能对话平级；删除「工作流编排」页
- [x] Agent CRUD（IndexedDB）+ Chat 选用 Agent
- [x] V2 工作流步骤编排并入 Agent（`lib/agentWorkflow`）
- [x] V3 外部 OpenAI 兼容 Agent（`lib/externalAgent`）
- [x] 角色并入 Agent（删除角色页；迁移 + 会话绑定 `agentId`）
- [x] V4 AI 网关多协议 + V5 SuperGrok 订阅（OAuth / 图像 / 视频）
- [x] V6 本机 Claude Code / Cursor coding Agent MVP（`docs/features/local-coding-agents.md`）

### 2.1 Rust Agent 调度器 ✅
- [x] `services/agent_scheduler.rs` — Agent 注册表 + 流水线定义 + Semaphore 并发控制
- [x] `handlers/agents.rs` — API 端点 + SSE 进度推送
- [x] 流水线: `voice_reply` / `text_chat` / `text_chat_stream` / `transcribe` / `synthesize`
- [x] Chat 页已通过 `text_chat_stream` 对接真实 Agent API（并由所选 Agent 的 system/voice 驱动）
- [ ] 语义化错误恢复：某步骤失败不丢失中间结果
- [ ] 任务取消 API

### 2.3 工作流（已并入 Agent 路线图）
- 独立 WorkflowPage **已移除**；引擎代码保留在 `lib/workflow/` 供 V2 Agent 编排使用。

## Phase 3: IM 接入 — 微信/企业微信机器人 (2-3 周)

**目标**: 用户通过微信给机器人发语音，机器人返回 TTS 合成后的语音回复。

### 3.1 消息路由层
新增 `handlers/im.rs` + `services/im_router.rs`:
- 统一消息格式：`{ platform, user_id, content_type, content }`
- 每个 IM 用户一个 `ChatSession`，与 `ChatPage` 复用会话逻辑
- 回复策略：LLM text → TTS audio → 返回语音消息

### 3.2 企业微信接入
- 企业微信自建应用: webhook → Rust 后端 `/api/im/wework`
- 语音下载 → ASR → LLM → TTS → 语音上传
- 发送消息 API 接入企业微信回调

### 3.3 个人微信接入 (可选)
- wechaty / comwechat 等开源框架桥接
- 注意封号风险评估

## Phase 4: 实时语音对话 (2-3 周)

**目标**: Web 端实现"说话→自动回复→自动播放"全自动对话循环。

### 4.1 ChatPage 麦克风输入
- Web Audio API 录音 → Blob → ASR → 自动填入输入框
- 已有基础设施：`TranscribePage` 的录音/ASR pipeline 可复用

### 4.2 自动 TTS 播放
- LLM 回复后自动调 TTS 合成 + 播放
- 已有基础设施：`ChatPage` 的 `speakMessage` 逻辑
- 自动播放开关 (`settings.autoPlay` 已有)

### 4.3 语音打断
- 边播边听：TTS 播放中检测用户语音
- 技术：AudioWorklet + VAD (Voice Activity Detection)
- 可能需要的模型：Silero VAD

## Phase 5: 体验打磨 (持续)

- [ ] `React.memo` 应用到所有列表子组件
- [ ] 流式 TTS：不等合成完成就开始播放 (WebSocket 推送音频分片)
- [ ] 移动端响应式完善 (当前已部分支持)
- [ ] 英文 UI 国际化 (`useI18n` hook 已有基础)
- [ ] PWA 打包：离线可用

## Phase 6: GPU 加速 & 模型扩展 (长期)

- [ ] 修复 AMD ROCm GPU 调用 (HIP 兼容问题)
- [ ] Qwen3-Omni 端到端语音对话 (一行模型替代 ASR+LLM+TTS 三级联)
- [ ] GLM-TTS INT8 量化 (当前 8.5GB → 目标 ~4GB)

## 优先级矩阵

| Phase | 优先级 | 工作量 | 核心差异点 |
|-------|--------|--------|-----------|
| 1. 文档+收尾 | P0 | 1 周 | 让项目可推广 |
| 2. Agent 调度层 | P0 | 2-3 周 | 任务编排，能力组合 |
| 3. IM 接入 | P1 | 2-3 周 | 核心差异化能力 |
| 4. 实时语音 | P2 | 2-3 周 | Web 端体验闭环 |
| 5. 体验打磨 | P3 | 持续 | 开源社区质量 |
| 6. GPU 扩展 | P4 | 长期 | 性能翻倍 |

## 不做

| 项 | 原因 |
|---|---|
| 超算训练 | 本地推理已满足需求，超算资源已释放 |
| MCP 协议包装 | 当前是单体应用，能力在 Rust 后端内直接调度，不需外部协议适配 |
| 图像/视频理解 | Ollama ROCm 后端不支持 Gemma 4 vision |
| Tauri 桌面打包 | Web UI 优先 |
| RAG 知识库 | 等 Agent 调度层稳定后再加 |
