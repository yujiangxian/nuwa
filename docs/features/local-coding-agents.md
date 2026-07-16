# 设计：本机 Claude Code / Cursor Agent 接入

> 状态：**已落地（MVP）** — 后端 `/api/coding/*` + 网关协议 `claude-code` / `cursor-sdk` + 设置页检测 + Agents 工作目录/权限 UI  

> 目标：在 Nuwa Agent 层接入本机已安装的 Claude Code 与 Cursor，形态对标 SuperGrok 的「后端代理 + 外部协议」，但能力为 **coding Agent**（工具 / cwd / 多轮），而非纯 chat completion。

---

## 1. 结论摘要

| 提供方 | 协议 ID | 运行时 | 鉴权 | 首期能力 |
|--------|---------|--------|------|----------|
| Claude Code | `claude-code` | 后端 spawn `claude -p`（默认 `--output-format text` 字节流式） | 优先本机 `claude` 已登录；可选 `ANTHROPIC_API_KEY` | 对话流式；cwd / permissionMode 可配 |
| Cursor | `cursor-sdk` | 后端 spawn Cursor headless `agent -p --output-format stream-json` | **必须** `CURSOR_API_KEY`（环境变量或设置页写入 `data/cursor_api_key.txt`） | 同上；需本机安装 Agent CLI |

说明：

- Claude 默认 **text** 模式（稳定、可按字节推 SSE）。设 `NUWA_CLAUDE_OUTPUT=stream-json` 可切回 NDJSON 解析。
- Windows 优先 `node` + `%APPDATA%\npm\node_modules\@anthropic-ai\claude-code\cli.js`，避免 `.cmd` CreateProcess 问题。
- Cursor 走官方 headless CLI（`agent` / `cursor-agent`），不是 IDE 的 `cursor.exe`，也不是 `@cursor/sdk` Node 侧车（协议 ID 仍为 `cursor-sdk` 以兼容已有预设）。

与现有外部网关差异：

- `openai-compatible` / `anthropic` / `xai-oauth` → 纯聊天（+ SuperGrok 媒体）
- `claude-code` / `cursor-sdk` → 带 harness 的编程 Agent（读改文件、Bash、权限门）

默认 `permissionMode=acceptEdits`；更稳妥可用 `plan` / `default`（取值对齐 `claude --permission-mode`）。

---

## 2. 架构

```
Chat UI（选用外部 Agent）
   │
lib/gateway ADAPTERS
   ├─ claude-code  → POST /api/coding/claude/stream
   └─ cursor-sdk   → POST /api/coding/cursor/stream
   │
Rust 后端
   └─ services/coding_cli.rs   查找 CLI、拼 -p / 输出格式、管道为 OpenAI 风格 SSE
   │
本机
   ├─ Claude Code CLI（订阅 OAuth / API Key）
   └─ Cursor Agent CLI（CURSOR_API_KEY）
```

Token / API Key 只存后端；浏览器不直连 Anthropic/Cursor 推理面。

哨兵 endpoint 可带 query（Agents 表单写入）：

`nuwa://claude-code?cwd=F:/proj&permissionMode=acceptEdits`

---

## 3. Agents 页预设

| 预设名 | protocol | endpoint 哨兵 | defaultModel |
|--------|----------|---------------|--------------|
| Claude Code（本机） | `claude-code` | `nuwa://claude-code` | 空（CLI 默认） |
| Cursor Agent（本机） | `cursor-sdk` | `nuwa://cursor-sdk` | 空（用户填写，不静默伪造） |

表单字段：

- `cwd`：工作区路径（默认项目根 / `NUWA_CODING_CWD`）
- `permissionMode`：`acceptEdits` | `default` | `plan` | `dontAsk` | `auto` | `bypassPermissions`

隐藏 Base URL / API Key；Cursor Key 在「设置 → 本机 Coding Agent」。

---

## 4. 后端路由

| 路由 | 作用 |
|------|------|
| `GET /api/coding/claude/status` | Claude CLI 是否可用、版本 |
| `POST /api/coding/claude/stream` | spawn + SSE（`choices[0].delta.content` + `[DONE]`） |
| `GET /api/coding/cursor/status` | Agent CLI + Key 是否配置 |
| `POST /api/coding/cursor/key` | 保存 / 清除 CURSOR_API_KEY |
| `POST /api/coding/cursor/stream` | spawn + SSE |

流式对齐现有 chat SSE；tool 步骤 UI 为二期（`event: tool`）。

---

## 5. 鉴权与 ToS 姿态

- **Claude**：优先复用交互式 `claude` 登录态；headless 可用 `claude setup-token` 或 `ANTHROPIC_API_KEY`。
- **Cursor**：官方要求 `CURSOR_API_KEY`；「本地」指文件与 agent loop 在本机，推理仍经 Cursor。
- 功能默认关闭：用户主动添加 Agent / 配置 Key 后启用。

---

## 6. 与 TTS / 媒体

- coding Agent 会话建议关闭自动 TTS（工具噪声多）；用户可手动合成。
- 不接 `/image` `/video`（仍属 SuperGrok）。

---

## 7. 落地顺序

1. ~~本文件定稿 + Agents 类型扩展 `ExternalProtocol`~~
2. ~~Claude Code 协议 + status/stream + 预设~~
3. ~~Cursor CLI 代理 + 协议 + 设置页 Key~~
4. ~~UI：cwd / permissionMode~~
5. UI：流式 tool 步骤（二期）

---

## 8. 非目标（首期）

- 云端 Cursor Cloud Agents / 自建 worker 池
- 在 Nuwa 内嵌完整 IDE 权限 UI（先用 CLI 默认权限策略）
- 用 Claude/Cursor 替换本地 Ollama 作为默认助手
