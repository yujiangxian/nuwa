# 设计与实施方案：SuperGrok 订阅接入（文本 / 图像 / 视频）

> 状态：**实施中**（P1–P4 已落地；本地可用「导入 Grok Build」快速连通）
> 目标：Nuwa 直接复用已购 SuperGrok 套餐（$30/月）的对话、图像生成、视频生成能力，
> 不另开 xAI API 计费。本文档是完整交接规格，按文中步骤即可实施。

---

## 1. 背景与结论

SuperGrok 是消费订阅（grok.com / Grok App / 官方 Grok Build CLI），**不含 API credits**，
无法直接当 API Key 用。但：

- xAI 官方认证服务 `accounts.x.ai`（OAuth2 / OIDC，PKCE + device-code + refresh token）
  签发的 bearer **可直接调用 `https://api.x.ai/v1` 推理面**，服务端按订阅做模型 allowlist。
- 官方先例：Grok Build CLI 即用 SuperGrok / X Premium+ 账号 OAuth 登录（`grok login`，
  支持 `--device-auth` 无头模式），不需要 API Key。
- 第三方先例：Hermes Agent（`xai-oauth` provider）、grokcli（纯 Python stdlib 开源）、
  Oayoix/grok-cli 等，一次 OAuth 登录覆盖 chat / image / video / tts / stt 全模态。

**结论**：Nuwa 走「后端 OAuth 代理」路线即可全量复用套餐能力。

## 2. 能力核实（2026-07）

| 能力 | 模型（OAuth allowlist） | 形态 |
|------|------------------------|------|
| Chat | `grok-build-0.1`（默认）、`grok-4.3`、`grok-4.20-0309-reasoning` / `-non-reasoning` / `-multi-agent` | SSE 流式（Responses API 面） |
| 图像生成/编辑 | `grok-imagine-image`（~5–10s）、`grok-imagine-image-quality`（~10–20s） | 同步，`/v1/images/generations`、`/v1/images/edits` |
| 视频生成 | `grok-imagine-video`（文生视频）、`grok-imagine-video-1.5-preview`（图生视频） | 异步：`/v1/videos/generations` 提交 → `/v1/videos/{request_id}` 轮询 → 视频 URL |
| TTS / STT | xAI `/v1/tts` 等 | **不接**（本地 GLM-TTS / Paraformer 已覆盖，是产品差异化） |

套餐配额（以 x.ai/pricing 为准）：对话约 100 条 / 2 小时；图像基本不限量；视频约 100 条/天。
单用户本地平台完全够用。

视频参数：时长 1–15s；宽高比 `1:1 / 16:9 / 9:16 / 4:3 / 3:4 / 3:2 / 2:3`；分辨率 `480p / 720p / 1080p`。

## 3. 决策记录（不要自行更改）

| 决策 | 理由 |
|------|------|
| 走订阅 OAuth 而非 API Key | 用户已付 SuperGrok；API 另行计费。API Key 路线保留为备用（现网关 `openai-compatible` + `https://api.x.ai/v1` 即可，不在本方案范围） |
| OAuth 与媒体调用走 Rust 后端代理，不走浏览器直连 | refresh token 不能进 localStorage（比 API Key 敏感）；api.x.ai 浏览器 CORS 不确定；视频轮询 + 媒体落盘天然属于后端 |
| 认证用 device-code flow | 桌面 / 无头都可用；实现参照 grokcli 开源实现（issuer = `accounts.x.ai`，PKCE，refresh 自动续期）；OIDC client 参数实现期从 grokcli / 官方 CLI 源码提取，不在本文档硬编码 |
| 提供「从官方 CLI 导入」兜底 | 用户若已装官方 Grok Build CLI 并 `grok login`，后端可一次性导入 `~/.grok/auth.json`（同 grokcli `--from-official` 行为） |
| 首期显式触发（`/image`、`/video` 斜杠命令），不做 function-calling 自动出图 | 最快可用、可控、好测；自动 tool-use 留到后续版本 |
| 功能默认关闭，设置页主动「连接账号」后启用 | ToS 合规姿态：官方明确允许的是官方 CLI/App 的订阅登录；自建应用复用 OAuth bearer 直调 API 属灰色地带（业界普遍、xAI 以服务端 allowlist 管控；个人本地使用最坏情况 token 失效重登）。由用户知情选择 |
| TTS/STT 不接 xAI | 本地语音链路是 Nuwa 差异化能力 |
| 生成媒体下载到本地目录持久化 | 远端 URL 会过期；复用现有静态文件 serve 机制；导出会话时媒体自包含 |

## 4. 架构

```
Chat UI（/image /video 斜杠 + 消息内媒体渲染）
   │
lib/gateway 新协议 'xai-oauth'（ADAPTERS 注册，streamChat → 后端 SSE）
   │
Rust 后端
   ├─ services/xai_oauth.rs   device-code 启动/轮询/refresh/token 存储（config 目录 JSON，0600）
   ├─ services/xai_client.rs  chat SSE 代理、images、videos（提交+轮询）、媒体下载落盘
   └─ handlers/xai.rs         路由（见下）
   │
accounts.x.ai（认证） + api.x.ai/v1（推理/生成）
```

### 4.1 后端路由

| 路由 | 作用 |
|------|------|
| `POST /api/xai/auth/start` | 启动 device-code：返回 verification URL + user code |
| `GET  /api/xai/auth/status` | 轮询登录完成状态 |
| `POST /api/xai/auth/logout` | 清除本地 token |
| `GET  /api/xai/status` | 已连接？账号/套餐/可用模型（供前端探测与下拉） |
| `POST /api/xai/chat/stream` | OAuth bearer 代理文本流式（SSE，与现有 chat_stream 同风格） |
| `POST /api/xai/images` | 生成/编辑图像 → 下载到本地 → 返回本地 URL |
| `POST /api/xai/videos` | 提交视频任务 → 返回任务 id |
| `GET  /api/xai/videos/{id}` | 轮询：进行中 / 完成（本地 URL）/ 失败 |

Token 只存后端本地文件；前端永远拿不到 refresh token。媒体落
`storage/media/xai/`（复用音频文件的静态 serve 机制）。

### 4.2 前端改动

| 位置 | 改动 |
|------|------|
| `store/types.ts` | `ExternalProtocol` 增 `'xai-oauth'`；`ChatMessage` 增 `media?: { kind: 'image' \| 'video'; url: string; prompt?: string }` |
| `lib/gateway/` | 新 `xaiOauth.ts` 适配器（streamChat → `/api/xai/chat/stream`；probe → `/api/xai/status`），注册进 `ADAPTERS`、`PROTOCOL_OPTIONS`、`parseProtocol` |
| `lib/gateway/presets.ts` | 增「xAI SuperGrok（订阅 OAuth）」预设：无 API Key 字段，endpoint 固定后端代理 |
| `components/agents/ExternalAgentFields.tsx` | 协议为 `xai-oauth` 时隐藏 Base URL/API Key，显示账号连接状态 + 「连接/断开」按钮 |
| `components/SettingsModal.tsx` | 「SuperGrok 账号」卡片：device-code 引导（展示 code + 打开浏览器）、状态、登出 |
| `components/chat/ChatPage.tsx` | 斜杠命令 `/image <prompt>`、`/video <prompt>`（复用现有 slash 基建）；发出后插入 pending 媒体消息 |
| `components/chat/MessageList.tsx` | 渲染 `media`：图像 `<img>`、视频 `<video controls>`；pending 态骨架 + 失败态重试 |
| `hooks/useApi.ts` | xai auth/status/images/videos 的 TanStack Query hooks |

### 4.3 会话与持久化

- 媒体消息仍是 `ChatMessage`（`content` 存 prompt 文本，`media.url` 存本地地址），
  chatDb 无 schema 变更（新增可选字段向后兼容）。
- 会话导出：媒体 URL 为本地相对路径，导入端缺文件时降级为文本提示。

## 5. 实施步骤

1. **P1 OAuth 基座**：`xai_oauth.rs` + auth 路由 + SettingsModal 连接卡片。
   验收：设置页完成 device-code 登录，`/api/xai/status` 返回账号与模型。
2. **P2 文本对话**：`xai_client.rs` chat 代理 + 网关 `xai-oauth` 适配器 + Agent 预设。
   验收：建一个 xAI OAuth 外部 Agent，Chat 选用后流式回复。
3. **P3 图像**：`/api/xai/images` + `/image` 斜杠 + 消息内渲染与落盘。
   验收：`/image 一只赛博朋克猫` 出图并本地持久化，刷新后仍可见。
4. **P4 视频**：`/api/xai/videos` 提交/轮询 + `/video` 斜杠 + pending 进度 + `<video>` 渲染。
   验收：`/video 海浪拍岸 8 秒` 出片可播放。
5. **P5 测试与文档**：
   - vitest：网关协议解析/注册、slash 解析、media 渲染、pending→done 状态流
   - cargo test：oauth 状态机（未登录/进行中/已登录/过期刷新）、路由鉴权
   - 文档：`docs/features/agents.md` 增 V5 一节、roadmap、module-landscape、本文档勾选

## 6. 风险与边界

- **ToS 灰区**（见决策记录）：默认关闭、用户主动连接；不对外分发含此功能的托管服务。
- 配额受套餐限制（对话 ~100/2h、视频 ~100/天），无 SLA；后端把 429/限额错误透传成友好 toast。
- xAI 可能调整 OAuth allowlist / 端点：全部 xAI 调用隔离在 `services/xai_client.rs` 单模块。
- 模型清单不硬编码：前端下拉从 `/api/xai/status`（后端拉 `/v1/models`）动态获取。

## 7. 明确不做（首期）

- 不做 function-calling 自动出图/出视频（对话内自动 tool-use 留待后续）
- 不做视频编辑 / 扩展 / reference-to-video（仅文生视频 + 图生视频）
- 不做多 xAI 账号管理
- 不发布到 X / 其他外部渠道
- 不接 xAI TTS / STT

## 8. 验收清单

- [x] 设置页可连接 / 断开 SuperGrok 账号（导入 Grok Build + device-code）
- [x] xAI OAuth 外部 Agent 文本流式对话可用（网关协议 `xai-oauth`）
- [x] `/image` 出图，消息内渲染并本地持久化
- [x] `/video` 出片可播放，pending 进度可用
- [x] refresh token 仅存后端 `data/xai_oauth.json`，前端不可见
- [ ] `tsc` / `vitest` / `eslint` + `cargo test` 全绿（实施后本地验证）

## 参考

- 官方：`docs.x.ai/build/overview`（Grok Build / 登录方式）、`docs.x.ai/developers/model-capabilities/imagine`（Imagine API）、`x.ai/pricing`（套餐能力）
- 先例实现：Hermes Agent `xai-oauth` provider 文档、GitHub `ele-yufo/grokcli`（纯 stdlib，OAuth 流程参考实现）、`Oayoix/grok-cli`
