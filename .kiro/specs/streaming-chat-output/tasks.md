# Implementation Plan: streaming-chat-output（流式对话输出）

## Overview

把女娲对话页的 AI 回复改为打字机式增量渲染。按「后端纯函数 → 后端流式 handler → 路由注册 → 前端纯解析 → 前端 consumeChatStream → ChatPage 流式集成」的依赖顺序推进，保证任意阶段前后端均可编译。后端用 Rust + Axum（`reqwest` `stream:true` + `bytes_stream` + `Body::from_stream` 下发 `application/x-ndjson`，错误以流内 error chunk 传达）；前端用 TypeScript（`fetch` + `ReadableStream` + `TextDecoder` + `AbortSignal`）。6 条 Correctness Property 各对应一个属性测试任务（前端 fast-check / 后端 proptest，最少 100 次迭代）。

实现指导：将设计转换为一系列可由代码生成 LLM 逐步实现的提示，每一步都建立在前一步之上，并以「接线整合」收尾，不留悬空/孤立代码。仅包含编写、修改、测试代码的任务。

## Tasks

- [x] 1. 后端：抽取 `resolve_model` 纯函数（行为不变）
  - [x] 1.1 在 `backend/server/src/handlers/chat.rs` 抽出 `pub fn resolve_model(current_llm_model: Option<String>, current_model_id: Option<String>, request_model: &str) -> String`，实现回退顺序 `current_llm_model → current_model_id → request_model`
    - 改造既有 `chat` handler 改为调用 `resolve_model`，保持 `POST /api/chat` 请求/响应契约与现有 Model_Selection 行为逐字一致
    - 不改变响应结构 `{ role, content, model, done }` 与错误结构 `{ error }`
    - _Requirements: 1.2, 7.2, 1.8, 7.1_

  - [x]* 1.2 编写 `resolve_model` 属性测试（proptest，`chat.rs` 的 `#[cfg(test)] mod tests`，≥100 迭代）
    - **Property 4: Model_Selection 回退顺序**
    - **Validates: Requirements 1.2, 7.2**
    - 对任意 `(current_llm_model, current_model_id, request_model)`（前两者各可 Some/None）断言返回值符合回退顺序

- [x] 2. 后端：新增 Stream_Endpoint（`POST /api/chat/stream`）
  - [x] 2.1 创建 `backend/server/src/handlers/chat_stream.rs` 的纯逻辑层，并在 `handlers/mod.rs` 加 `pub mod chat_stream;`
    - 定义 `StreamChunk { delta: Option<String>, done: bool, error: Option<String> }`（Serialize，`skip_serializing_if` 使三字段互斥、序列化为单行 NDJSON）
    - 实现 `pub fn split_lines(buffer: &str) -> (Vec<&str>, &str)`：按 `\n` 分帧为完整行与剩余未完成片段，不分配新串
    - 实现 `pub fn parse_ollama_line(line: &str) -> OllamaLine`（`{ delta: String, done: bool }`）：容错解析单行 NDJSON，非 JSON/缺字段时 `delta=""`、`done=false`
    - 实现 `pub fn build_ollama_messages(system: Option<&str>, messages: &[ChatMessage]) -> Vec<serde_json::Value>`：存在 System_Prompt 时以一条 `role:"system"` 为首条，后接原 messages（顺序不变）
    - 复用 `chat.rs` 的 `ChatRequest`/`ChatMessage`（按需将其字段/类型设为 `pub(crate)` 或重导出，保持 `chat` 行为不变）
    - 仅含纯函数即可通过编译（handler 在 2.5 加入）
    - _Requirements: 1.3, 1.4, 1.5_

  - [x]* 2.2 编写 `split_lines` 属性测试（proptest，`chat_stream.rs` tests，≥100 迭代）
    - **Property 1: NDJSON 分帧 round-trip 与切分无关性（confluence）**
    - **Validates: Requirements 1.4, 1.5, 2.2**
    - 对任意文本及任意切分序列，分片逐次喂入（保留 leftover）所得完整行序列与最终 leftover 等于一次性分帧结果；`lines.join("\n") + rest` 可重构原文

  - [x]* 2.3 编写 `StreamChunk` 序列化与 `parse_ollama_line` 解析属性测试（proptest，`chat_stream.rs` tests，≥100 迭代）
    - **Property 2: Stream_Chunk 协议序列化/解析 round-trip**
    - **Validates: Requirements 1.4, 6.1**
    - 对任意恰含 delta/done/error 之一的合法块序列化为一行 JSON 再解析得到语义等价块；非法 JSON 行解析为空块（被消费逻辑忽略）；覆盖 `done` 默认值、转义、字段缺失

  - [x]* 2.4 编写 `build_ollama_messages` 属性测试（proptest，`chat_stream.rs` tests，≥100 迭代）
    - **Property 5: System_Prompt 前置构造不变式**
    - **Validates: Requirements 1.3**
    - 对任意可选 System_Prompt 与任意 messages，断言：有 system 时首条为 `role:"system"`、其余顺序不变；并校验外层请求体 `stream==true` 且 `model` 为已解析模型

  - [x] 2.5 实现 `pub async fn chat_stream(State, Json<ChatRequest>) -> Response` 流式 handler
    - 用 `resolve_model` 选模型，用 `build_ollama_messages` 构造请求体 `{ model, messages, stream: true }`
    - `reqwest::Client::post(OLLAMA_URL).json(...).send()`：`send()` 失败（无法连接 Ollama）→ 返回仅含一个 error chunk 的流（含「Ollama 未启动或模型未加载」友好提示）；状态码非成功 → 读取错误文本返回仅含一个 error chunk 的流并结束
    - 成功 → `resp.bytes_stream()`，用 `async_stream`/手写状态机维护 `leftover` 缓冲，按 UTF-8 累积、`split_lines` 分帧、`parse_ollama_line` 提取 delta/done，逐块 yield `StreamChunk`；遇 `done:true` 追加 done chunk 结束；流自然结束则补发一个 done chunk
    - 以 `axum::body::Body::from_stream(s)`（item 为 `Result<Bytes, std::io::Error>`）构造响应，设置 `Content-Type: application/x-ndjson`
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 1.6, 1.7_

  - [x] 2.6 在 `backend/server/src/routes/mod.rs` 注册 `.route("/api/chat/stream", post(handlers::chat_stream::chat_stream))`
    - 保持既有 `POST /api/chat` 一行原样不动
    - _Requirements: 1.1, 1.8, 7.1_

  - [x]* 2.7 编写后端集成示例测试（独立集成测试文件 `backend/server/tests/chat_stream.rs`）
    - 合法请求 → 返回 200 且 `Content-Type: application/x-ndjson`（1.1）
    - Ollama 不可达 → 流内单个 error chunk 含友好文案（1.6）
    - Ollama 非成功状态码 → error chunk 并结束流（1.7）
    - 契约回归：既有 `/api/chat` 测试保持通过（1.8 / 7.1）
    - _Requirements: 1.1, 1.6, 1.7, 1.8, 7.1_

- [x] 3. 检查点（后端）— 确保后端构建与测试通过
  - 运行 `cargo build` 与 `cargo test`（含属性测试 ≥100 迭代）。Ensure all tests pass, ask the user if questions arise.

- [x] 4. 前端：流消费纯逻辑 `lib/streamChat.ts`
  - [x] 4.1 创建 `app/web/src/lib/streamChat.ts` 的纯函数层
    - 定义 `export interface StreamChunk { delta?: string; done?: boolean; error?: string }`（三字段互斥）
    - 实现 `export function parseStreamLines(buffer: string): { lines: string[]; rest: string }`：按 `\n` 分帧返回完整行与剩余片段
    - 实现 `export function parseChunk(line: string): StreamChunk`：解析单行；非法 JSON 返回 `{}`
    - 实现 `export function accumulateDelta(prev: string, chunk: StreamChunk): string`：把块的 `delta` 追加到已累积文本
    - _Requirements: 1.4, 2.2, 2.5_

  - [x]* 4.2 编写 `parseStreamLines` 属性测试（fast-check，`app/web/src/lib/streamChat.test.ts`，≥100 迭代）
    - **Property 1: NDJSON 分帧 round-trip 与切分无关性（confluence）**
    - **Validates: Requirements 1.4, 1.5, 2.2**
    - 注释标签：`// Feature: streaming-chat-output, Property 1: ...`

  - [x]* 4.3 编写 `parseChunk` round-trip 属性测试（fast-check，`streamChat.test.ts`，≥100 迭代）
    - **Property 2: Stream_Chunk 协议序列化/解析 round-trip**
    - **Validates: Requirements 1.4, 6.1**

  - [x]* 4.4 编写 `accumulateDelta` 折叠顺序保持属性测试（fast-check，`streamChat.test.ts`，≥100 迭代）
    - **Property 3: 增量累积顺序保持（含停止时点保留）**
    - **Validates: Requirements 2.2, 2.5, 3.3**
    - 断言处理前 k 个增量块后累积内容等于这 k 个 `delta` 按到达顺序拼接

  - [x] 4.5 实现 `export async function consumeChatStream(body: ReadableStream<Uint8Array>, onChunk: (chunk: StreamChunk) => void): Promise<void>`
    - 基于 `ReadableStream` reader + `TextDecoder`，按 `parseStreamLines` 维护 leftover、逐行 `parseChunk` 后回调 `onChunk`
    - 支持通过外部 `AbortSignal` 中断（捕获 `AbortError` 视为正常停止，不抛错）；连接失败且尚未产生任何块时抛出可被降级捕获的错误
    - _Requirements: 2.6, 3.2, 6.1_

- [x] 5. 前端：`ChatPage` 流式集成
  - [x] 5.1 改造 `app/web/src/components/ChatPage.tsx` 的 `handleSend` 为流式消费主流程
    - 新增本地态：`isTyping`、`streamingContent`、`isStreaming`、`accRef`、`abortController`（不改 `uiStore`）
    - 发送即 `appendMessage(userMsg)` 持久化用户消息；进入 Generating_State 并在列表末尾展示 assistant Placeholder_Message；生成中禁用再次发送
    - `fetch('/api/chat/stream', { method:'POST', body, signal })` → `consumeChatStream(res.body, onChunk)`；`onChunk` 用 `accumulateDelta` 累积并 `setStreamingContent`
    - 定型（finalize）：`accRef.current` 非空时 `appendMessage(finalMsg)` 一次并退出生成态、清空流式态；为空则不落库（移除占位）
    - 复用 Session_Persistence 的自动标题与 `updatedAt` 行为；流式中不逐 token 持久化
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 4.1, 4.2, 4.4, 4.5_

  - [x] 5.2 实现 `handleStop`（Stop_Action）
    - 生成中提供 Stop 入口；点击经 `abortController.abort()` 中断 fetch 并停止消费后续块
    - 保留已接收增量作为 Final_Message 内容并定型、退出生成态；若停止时尚无任何增量则移除 Placeholder_Message 而不产生空 Final_Message
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 5.3 实现 TTS 集成与错误/降级处理
    - autoPlay 开启且正常完成 → 对 Final_Message 完整文本触发一次 `speakMessage`；停止且 Final_Message 非空且 autoPlay 开启 → 一次 TTS；生成中不触发；autoPlay 关不触发
    - 收到 error chunk → 展示错误并退出生成态（无增量则移除占位）；无增量时连接失败按 Fallback_Strategy 改调 `POST /api/chat`，成功则作为 Final_Message 渲染并按持久化路径落库；降级再失败则提示并退出；Ollama 友好文案透传
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [x]* 5.4 编写定型持久化次数属性测试（fast-check，`streamChat.test.ts`，≥100 迭代）
    - **Property 6: 定型持久化次数不变式**
    - **Validates: Requirements 3.5, 4.4, 6.6**
    - 以任意 delta 序列驱动 `consumeChatStream` + 定型逻辑，spy 统计 `appendMessage` 等价持久化调用次数 == 累积非空?1:0，与块数量无关

  - [x]* 5.5 编写 `ChatPage` 组件测试（Vitest + Testing Library，`app/web/src/components/ChatPage.test.tsx`，受控 mock `ReadableStream`）
    - 渲染/状态：发送出现占位且禁用输入（2.1/2.3）；增量到达文本增长（2.2）；done 定型并退出（2.4）
    - 停止：有 Stop 入口（3.1）；abort 停止消费、保留内容、退出（3.2–3.4）；无内容移除占位不落库（3.5）
    - 持久化：用户消息落库（4.1）；完成/停止非空落库一次（4.2/4.3）；自动标题/`updatedAt`（4.5）
    - TTS：autoPlay 开+完成触发一次完整文本（5.1）；进行中不触发（5.2）；autoPlay 关不触发（5.3）；停止非空+autoPlay 开触发一次（5.4）
    - 错误/降级：error chunk 展示并退出（6.1）；无增量连接失败降级 `/api/chat` 成功渲染+持久化（6.2/6.3）；降级再失败提示退出（6.4）；Ollama 文案透传（6.5）；错误且无增量移除占位（6.6）
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 4.5, 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [x]* 5.6 运行无回归测试套件
    - 复用既有 uiStore/会话（7.5）、ASR/录音（7.3）、TTS（7.4）、模型管理与下载（7.6）测试，确保全绿
    - _Requirements: 7.3, 7.4, 7.5, 7.6_

- [x] 6. 检查点（前端）— 确保前端类型检查、测试与构建通过
  - 运行 `tsc --noEmit`、`vitest --run`（含属性测试 ≥100 迭代）、`vite build`。Ensure all tests pass, ask the user if questions arise.

- [x] 7. 最终检查点 — 前后端整体验证
  - 后端 `cargo build` + `cargo test`，前端 `tsc --noEmit` + `vitest --run` + `vite build` 全部通过。Ensure all tests pass, ask the user if questions arise.

## Notes

- 标记 `*` 的子任务为可选（属性测试 / 单元 / 集成 / 组件 / 回归测试），可为更快 MVP 跳过；顶层任务与检查点不带 `*`。
- 每个任务标注对应 Requirements 子条款以保证可追溯。
- 6 条属性测试任务一一对应设计的 Property 1–6，并标注 Validates 与 ≥100 迭代要求；前端用 fast-check，后端用 proptest。
- 依赖顺序保证任意时刻前后端均可编译：纯函数先行，handler 与路由后置，前端解析层先于 `ChatPage` 集成。
- 长时进程（`vite`/`vitest --watch`）请勿在自动化中启动；测试统一用 `--run` / `cargo test` 单次执行。
- 本特性为纯增量增强：不改 `POST /api/chat` 契约、Model_Selection 回退、Session_Persistence / Voice_Loop / 模型管理。

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "4.1"] },
    { "id": 1, "tasks": ["1.2", "2.2", "4.2", "4.5"] },
    { "id": 2, "tasks": ["2.3", "4.3", "5.1"] },
    { "id": 3, "tasks": ["2.4", "4.4", "5.2"] },
    { "id": 4, "tasks": ["2.5", "5.3"] },
    { "id": 5, "tasks": ["2.6", "5.4", "5.5"] },
    { "id": 6, "tasks": ["2.7", "5.6"] }
  ]
}
```
