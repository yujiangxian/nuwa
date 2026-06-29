# 女娲 (Nuwa) 技术路线图

---

## Phase 1：基础链路打通（当前阶段）✅

| 功能 | 状态 | 备注 |
|------|------|------|
| LLM 对话（文本） | ✅ | Ollama 转发 |
| ASR 语音识别 | ✅ | Paraformer / Whisper / GLM-ASR / Qwen3-ASR |
| TTS 语音合成 | ✅ | CosyVoice zero-shot |
| 模型扫描与管理 | ✅ | 本地 + Ollama 统一发现 |
| 模型下载 | ✅ | HuggingFace / ModelScope 并行下载 |
| 配置持久化 | ✅ | config.json |
| 音频文件服务 | ✅ | /api/audio/{filename} |

---

## Phase 2：语音交互闭环（近期，1-2 周）

| 功能 | 优先级 | 工作量 |
|------|--------|--------|
| ChatPage 麦克风语音输入 | P0 | 1d |
| TTS 模型常驻服务化 | P0 | 2d |
| 分离 ASR/TTS 独立配置 | P0 | 0.5d |
| 角色/音色配置持久化 | P1 | 0.5d |
| Ollama 模型友好名称映射 | P1 | 0.5d |
| 下载 Qwen3-ASR-1.7B | P1 | 0.5d |
| 下载 Whisper Small | P2 | 0.5d |

---

## Phase 3：体验优化（中期，2-4 周）

| 功能 | 优先级 | 说明 |
|------|--------|------|
| 流式对话输出 | P1 | Ollama stream + SSE |
| 会话历史持久化 | P1 | IndexedDB |
| 音色库管理 | P1 | 上传/保存/切换参考音频 |
| TTS 参数真正生效 | P1 | 接入 GLM-TTS / Qwen3-TTS 参数控制 |
| 消息级语音播放 | P2 | 每条 assistant 消息可独立播放 |
| 自动播放开关 | P2 | 设置中控制 |

---

## Phase 4：多模态升级（远期，1-3 月）

| 功能 | 优先级 | 说明 |
|------|--------|------|
| 接入 Qwen3-Omni | P1 | 端到端语音多模态，替代 ASR+LLM+TTS 级联 |
| 图像理解 | P2 | 上传图片，多模态 LLM 分析 |
| 实时语音对话 | P2 | WebSocket 流式 ASR + 流式 TTS |
| 本地 RAG 知识库 | P3 | 向量数据库 + 文档检索 |
| 角色记忆 | P3 | 长期对话记忆 |

---

## Phase 5：工程化与部署（持续）

| 功能 | 优先级 | 说明 |
|------|--------|------|
| Tauri 桌面打包 | P2 | 从 Web 应用打包为独立 exe |
| 自动更新 | P3 | 模型/应用自动更新 |
| 超算训练流水线 | P2 | SLURM + DCU 训练 GPT-SoVITS |
| 模型量化优化 | P2 | GGUF / ONNX 转换，降低显存占用 |
