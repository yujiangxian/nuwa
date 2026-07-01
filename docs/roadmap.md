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
| 角色系统 | ✅ | 3 个角色 + CRUD |
| 代码质量 | ✅ | 970 测试 + TS strict + CI |

## Phase 1: 文档更新 + 代码收尾 (完成)

- [x] README 状态表更新
- [x] `docs/tested_models.md` GLM-TTS 状态更新
- [x] `docs/roadmap.md` 替换
- [ ] `docs/architecture.md` 新建
- [ ] `presetStore` / `sessionStore` 接入

## Phase 2: IM 接入 — 微信/企业微信机器人 (2-3 周)

- [ ] 消息路由层 (`handlers/im.rs` + `services/message_router.rs`)
- [ ] 企业微信自建应用 webhook 接入
- [ ] 语音消息：用户语音 → ASR → LLM → TTS → 语音回复
- [ ] 多用户会话管理 (与 ChatPage 复用 ChatSession 逻辑)

## Phase 3: 实时语音对话 (2-3 周)

- [ ] ChatPage 麦克风语音输入 → ASR 自动填入
- [ ] LLM 回复后自动 TTS 合成 + 播放
- [ ] 语音打断 (AudioWorklet + Silero VAD)

## Phase 4: Agent 层 & 工具调用 (3-4 周)

- [ ] MCP Server 化 (ASR / TTS / LLM / Manager)
- [ ] Rust Agent 调度器
- [ ] WorkflowPage 可视化工作流编辑器

## Phase 5: 体验打磨 (持续)

- [ ] React.memo 性能优化
- [ ] 流式 TTS (WebSocket 推送音频分片)
- [ ] 移动端响应式完善
- [ ] 英文 UI 国际化
- [ ] PWA 打包

## Phase 6: GPU 加速 & 模型扩展 (长期)

- [ ] 修复 AMD ROCm GPU 调用 (HIP 兼容)
- [ ] Qwen3-Omni 端到端语音对话
- [ ] GLM-TTS INT8 量化

## 不做

| 项 | 原因 |
|---|---|
| 超算训练 | 暂时搁置，本地推理够用 |
| 图像/视频理解 | Ollama ROCm 后端不支持 Gemma 4 vision |
| Tauri 桌面打包 | Web UI 优先 |
| RAG 知识库 | 等 Agent 层稳定 |
