# Implementation Plan: chat-generation-parameters（对话生成参数调节）

## Overview

为女娲 Nuwa 对话应用引入可调节的模型生成参数（Temperature、Top_P、Num_Predict、Top_K、Repeat_Penalty），经前端持久化、随请求下发、后端透传为 Ollama `options`，并严格保证 Default_State 下逐字段无回归。按「后端纯函数 → 后端 handler 接线 → 前端纯函数 → 前端 store 扩展 → ChatPage 合并请求片段 → Param_Panel UI」的依赖顺序推进，保证任意阶段前后端均可编译、不留孤立代码、以接线整合收尾。

- **后端 Rust + Axum**（`backend/server`）：以可选字段扩展 `ChatRequest`；抽取纯函数 `clamp_params`（Server_Param_Validator）、`params_to_options`、`build_ollama_body`（缺省无回归核心）；`chat` 与 `chat_stream` 两个 handler 复用同一序列；属性测试用 `proptest`（`ProptestConfig::with_cases(>=100)`）。
- **前端 TypeScript + React 19**（`app/web`）：新增纯函数层 `lib/generationParams.ts`（`PARAM_SPECS`/`DEFAULT_CHAT_GEN_PARAMS`/`clampParam`/`buildRequestFragment`/`load|saveChatGenParams`）；扩展 `uiStore`；`ChatPage` 在两条请求路径合并请求片段；新增 `ParamPanel` UI；属性测试用 `fast-check`（`numRuns >= 100`）。

实现指导：将设计转换为一系列可由代码生成 LLM 逐步实现的提示，每一步都建立在前一步之上，并以「接线整合」收尾，不留悬空/孤立代码。仅包含编写、修改、测试代码的任务。5 条 Correctness Property 各对应属性测试任务（前端 fast-check / 后端 proptest，最少 100 次迭代），并标记为可选 `*` 子任务。

## Tasks

- [x] 1. 后端：扩展 ChatRequest 与生成参数纯函数（`handlers/chat.rs`）
  - [x] 1.1 以可选字段扩展 `ChatRequest`，新增 `ClampedParams` 与 `clamp_params` / `params_to_options`
    - 在 `backend/server/src/handlers/chat.rs` 的既有 `ChatRequest` 上新增 `temperature: Option<f64>`、`top_p: Option<f64>`、`num_predict: Option<i64>`、`top_k: Option<i64>`、`repeat_penalty: Option<f64>`，均标注 `#[serde(default)]`（非法/缺失类型反序列化为 `None`），保持既有 `messages`/`model`/`system` 字段与契约不变
    - 定义 `pub struct ClampedParams { temperature: Option<f64>, top_p: Option<f64>, num_predict: Option<i64>, top_k: Option<i64>, repeat_penalty: Option<f64> }`（`PartialEq`）
    - 实现 `pub fn clamp_params(req: &ChatRequest) -> ClampedParams`：对每个 `Some` 字段按 Param_Spec 钳制——`temperature∈[0.0,2.0]`、`top_p∈[0.0,1.0]`、`repeat_penalty∈[0.0,2.0]`；`top_k` 取整后 `∈[0,100]`；`num_predict` 为 `-1` 原样保留（Unlimited_Length），其余取整后 `∈[1,8192]`；`None` 保持 `None`；对已合法值幂等
    - 实现 `pub fn params_to_options(p: &ClampedParams) -> Option<serde_json::Map<String, serde_json::Value>>`：仅纳入 `Some` 字段，键名固定 `temperature`/`top_p`/`num_predict`/`top_k`/`repeat_penalty`；全 `None` 返回 `None`
    - 仅新增类型与纯函数即可通过编译（handler 接线在任务 2 进行）
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 5.1, 5.2, 5.4_

  - [x]* 1.2 编写 `clamp_params` 属性测试（proptest，`chat.rs` 的 `#[cfg(test)] mod tests`，≥100 迭代）
    - **Property 1: Param_Validator 钳制正确性与幂等（后端侧）**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7**
    - 对任意原始数值构造 `ChatRequest`，断言每个 `Some` 字段落在 Param_Spec 范围内、整型为整数、`num_predict=-1` 恒保留、对已钳制值幂等；`None` 字段保持 `None`
    - 注释标签：`// Feature: chat-generation-parameters, Property 1: ...`

  - [x] 1.3 抽取 `build_ollama_body` 纯函数（缺省无回归核心）
    - 在 `chat.rs` 实现 `pub fn build_ollama_body(model: &str, system: Option<&str>, messages: &[ChatMessage], stream: bool, options: Option<serde_json::Map<String, serde_json::Value>>) -> serde_json::Value`
    - `system` 为 `Some` 时首条置入 `{role:"system", content:system}`（与现状一致），后接原 messages 顺序不变
    - `options` 为 `None` 时产出 JSON **不含 `options` 键**（仅 `model`/`messages`/`stream`，与本特性引入前逐字段等价）；`Some(map)` 时置入 `options` 且其键恰为调用方提供的集合
    - 仅新增纯函数，暂不改 handler（接线在任务 2），保证编译通过
    - _Requirements: 5.3, 5.4, 6.1, 6.2_

  - [x]* 1.4 编写 `build_ollama_body` 属性测试（proptest，`chat.rs` tests，≥100 迭代）
    - **Property 5: Ollama 请求体组装（options 精确性与缺省逐字段等价）**
    - **Validates: Requirements 5.3, 5.4, 5.5, 6.1, 6.2**
    - 对任意 `Some`/`None` 参数组合，断言：存在至少一个提供参数时含 `options` 键且键集合恰为提供集合（值为钳制后取值），无任何提供参数时**不含** `options` 键且与「仅 model/messages/stream」逐字段相等；system 前置规则不变；`stream` 取值正确

  - [x]* 1.5 编写前后端钳制等价的共享测试向量与后端断言（proptest，`chat.rs` tests，≥100 迭代）
    - **Property 4: 前后端钳制等价（Server_Param_Validator 侧）**
    - **Validates: Requirements 5.2**
    - 维护一组 `(参数 key, 原始输入, 期望钳制值)` 共享测试向量（覆盖下界/上界/越界/小数/`-1`），断言 `clamp_params` 对每个向量产出 == 期望值；并以随机输入复核范围正确性（与前端 4.7 使用同一份向量语义）

- [x] 2. 后端：handler 接线复用纯函数（`chat.rs` / `chat_stream.rs`）
  - [x] 2.1 改造非流式 `chat` handler 复用 `clamp_params`/`params_to_options`/`build_ollama_body`
    - 在 `chat.rs` 的 `chat` handler 中，保持 `resolve_model` 回退顺序不变，依次调用 `clamp_params(&req)` → `params_to_options` → `build_ollama_body(&model, req.system.as_deref(), &req.messages, false, options)`，替换原内联 `serde_json::json!({...})`
    - 保持 `POST /api/chat` 请求/响应契约 `{ role, content, model, done }` 与错误 `{ error }` 不变
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.2, 7.1, 7.3_

  - [x] 2.2 改造流式 `chat_stream` handler 复用同一序列（`stream:true`）
    - 在 `backend/server/src/handlers/chat_stream.rs` 复用 `chat.rs` 的 `clamp_params`/`params_to_options`/`build_ollama_body`（按需将其设为 `pub(crate)` 或重导出），把内联请求体构造替换为 `build_ollama_body(&model, system, &messages, true, options)`，消除两处重复
    - 保持 Stream_Endpoint 的 `application/x-ndjson` 块协议（`delta`/`done`/`error`）与降级链路不变
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.2, 7.2, 7.3_

  - [x]* 2.3 编写后端反序列化契约与端点一致性/缺省无回归示例测试（`chat.rs` tests 与/或 `backend/server/tests/`）
    - 反序列化：含/不含生成字段、含部分字段、含非法类型的 JSON 均能反序列化（非法类型落为 `None`）（5.1）
    - 端点一致性：相同输入下 `chat` 与 `chat_stream` 经 `build_ollama_body` 产出相同 `options`（仅 `stream` 不同）（5.5）
    - 缺省无回归：无参数请求产出的 Ollama 请求体仅含 `model`/`messages`/`stream`、不含 `options`（6.1/6.2）
    - _Requirements: 5.1, 5.5, 6.1, 6.2, 7.1, 7.2, 7.3_

- [x] 3. 检查点（后端）— 确保后端构建与测试通过
  - 运行 `cargo build` 与 `cargo test`（含属性测试 ≥100 迭代）。Ensure all tests pass, ask the user if questions arise.

- [x] 4. 前端：生成参数纯函数层（`lib/generationParams.ts`）
  - [x] 4.1 实现 `PARAM_SPECS`、`DEFAULT_CHAT_GEN_PARAMS` 与 `clampParam`
    - 创建 `app/web/src/lib/generationParams.ts`，定义类型 `ChatParamKey`/`ChatParamState`/`ChatGenParams`/`ParamSpec`
    - 定义 `PARAM_SPECS`（与后端 `clamp_params` 范围/取整/特殊值严格一致）：`temperature[0,2]`、`topP[0,1]`、`numPredict[1,8192]+allowUnlimited(-1)`、`topK[0,100]整型`、`repeatPenalty[0,2]`，并标注各自 `ollamaKey`
    - 定义 `DEFAULT_CHAT_GEN_PARAMS`（所有成员 `active:false`，value 取规格 default）
    - 实现 `clampParam(key, raw)`：整型先 `Math.round` 再 clamp；`allowUnlimited` 且输入为 `-1` 原样返回；对已合法值幂等
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [x]* 4.2 编写 `clampParam` 属性测试（fast-check，`app/web/src/lib/generationParams.test.ts`，≥100 迭代）
    - **Property 1: Param_Validator 钳制正确性与幂等（前端侧）**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7**
    - 对任意 key 与原始数值断言落在范围内、整型为整数、`numPredict=-1` 恒保留、幂等 `clampParam(k, clampParam(k, v)) === clampParam(k, v)`
    - 注释标签：`// Feature: chat-generation-parameters, Property 1: ...`

  - [x] 4.3 实现 `buildRequestFragment`
    - 在 `generationParams.ts` 实现 `buildRequestFragment(params)`：仅含 Active 成员，键为对应 `ollamaKey`，值为对该成员 value 应用 `clampParam` 的结果；Default_State 返回 `{}`；绝不包含 `messages`/`system` 键
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 6.3_

  - [x]* 4.4 编写 `buildRequestFragment` 属性测试（fast-check，`generationParams.test.ts`，≥100 迭代）
    - **Property 3: 请求片段保真（Active 子集、键名、钳制值、缺省为空、既有字段不变）**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 6.3**
    - 对任意 `ChatGenParams` 断言：键集合恰为 Active 成员的 `ollamaKey` 集合、不含 Inactive、各值等于 `clampParam` 结果、Default→`{}`、绝不含 `messages`/`system`

  - [x] 4.5 实现 `loadChatGenParams` / `saveChatGenParams`（localStorage 键 `nuwa_chat_gen_params`）
    - 在 `generationParams.ts` 实现 `saveChatGenParams`（try/catch 静默忽略写入失败，与 `saveSettings` 一致）与 `loadChatGenParams`（try/catch 兜底，缺失/损坏返回 `DEFAULT_CHAT_GEN_PARAMS`，并对缺失键逐参数与默认合并）
    - _Requirements: 1.3, 1.4, 1.5, 1.6_

  - [x]* 4.6 编写持久化 round-trip 属性测试（fast-check，`generationParams.test.ts`，mock localStorage，≥100 迭代）
    - **Property 2: Generation_Params 持久化 round-trip**
    - **Validates: Requirements 1.2, 1.3, 1.4, 1.5, 1.6**
    - 对任意合法 `ChatGenParams` 断言 `save`→`load` 得到相等对象（含设置态与数值）；空/损坏分支返回 `DEFAULT_CHAT_GEN_PARAMS`

  - [x]* 4.7 编写前后端钳制等价的前端断言（fast-check，`generationParams.test.ts`，≥100 迭代）
    - **Property 4: 前后端钳制等价（Param_Validator 侧）**
    - **Validates: Requirements 5.2**
    - 使用与后端 1.5 同一份共享测试向量，断言 `clampParam` 对每个向量产出 == 期望值（间接保证两侧相等）；并以随机输入复核范围正确性

- [x] 5. 前端：Chat_Store 扩展、ChatPage 合并与 Param_Panel UI
  - [x] 5.1 扩展 `uiStore` 的 Generation_Params 状态与动作
    - 在 `app/web/src/store/uiStore.ts` 新增 `chatGenParams: ChatGenParams`（初值 `loadChatGenParams()`），与既有合成模式 `params/setParam` 并存、互不影响
    - 实现 `setChatParam(key, rawValue)`：`clampParam` 钳制 → 置 `active:true`+记录 value → `saveChatGenParams` 持久化 → `set`
    - 实现 `clearChatParam(key)`：重置该参数为 Inactive 并持久化
    - 实现 `restoreChatParamDefaults()`：重置为 `DEFAULT_CHAT_GEN_PARAMS` 并持久化
    - _Requirements: 1.2, 1.3, 3.2, 3.3_

  - [x]* 5.2 编写 Chat_Store 单元测试（Vitest，`uiStore` 相关）
    - `setChatParam` 置 Active 并记录钳制值且持久化（1.2/1.3）；`clearChatParam` 置 Inactive；`restoreChatParamDefaults` 重置为 Default_State 并持久化（3.2/3.3）
    - _Requirements: 1.2, 1.3, 3.2, 3.3_

  - [x] 5.3 在 `ChatPage` 两条请求路径合并请求片段
    - 改造 `app/web/src/components/ChatPage.tsx` 的 `runAssistantStream`：调用 `buildRequestFragment(useUIStore.getState().chatGenParams)`，在流式 `POST /api/chat/stream` 与降级 `POST /api/chat` 两条路径上把片段展开合并进请求体（`{ messages, system, ...fragment }`）
    - Default_State 下 `fragment` 为 `{}`，请求体与现状逐字段相同；始终保留 `messages`/`system`；不改变流式渲染/停止/降级与 TTS 行为
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 6.3, 7.5, 7.6_

  - [x] 5.4 新增 Param_Panel 组件并挂载到 Chat_Page
    - 创建 `app/web/src/components/ParamPanel.tsx`：为 Generation_Params 每个成员渲染一行控件（启用开关 + 滑块[范围取自 `PARAM_SPECS`] + 数值输入）；数值变更走 `setChatParam`（即时钳制并持久化、回显合法值），关闭开关走 `clearChatParam`；Num_Predict 额外提供「不限制」(写入 `-1`)；底部「恢复默认」按钮 → `restoreChatParamDefaults`
    - 在 `ChatPage.tsx` 挂载 `ParamPanel`，控件展示数值始终来自 store 的 `chatGenParams[key]`
    - _Requirements: 1.1, 1.2, 3.1, 3.2_

  - [x]* 5.5 编写 Param_Panel 与 ChatPage 组件/集成测试（Vitest + Testing Library，mock fetch/apiClient）
    - Param_Panel：渲染 5 个参数控件（1.1）；存在「恢复默认」入口且触发 `restoreChatParamDefaults`（3.1/3.2/3.3）；输入越界值经控件回显为钳制值（2.x）
    - ChatPage：Default_State 下请求体不含生成字段且与现状一致（4.3/6.3）；含 Active 参数时流式与降级两路径请求体均含 ollama 键+钳制值且保留 `messages`/`system`（4.1/4.2/4.4/4.5）
    - 无回归：复用既有 Session_Persistence / Streaming_Output / Voice_Loop 测试保持全绿（7.4/7.5/7.6）
    - _Requirements: 1.1, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 4.4, 4.5, 6.3, 7.4, 7.5, 7.6_

- [x] 6. 检查点（前端）— 确保前端类型检查、测试与构建通过
  - 运行 `tsc --noEmit`、`vitest --run`（含属性测试 ≥100 迭代）、`vite build`。Ensure all tests pass, ask the user if questions arise.

- [x] 7. 最终检查点 — 前后端整体验证
  - 后端 `cargo build` + `cargo test`，前端 `tsc --noEmit` + `vitest --run` + `vite build` 全部通过。Ensure all tests pass, ask the user if questions arise.

## Notes

- 标记 `*` 的子任务为可选（属性测试 / 单元 / 组件 / 集成 / 回归测试），可为更快 MVP 跳过；顶层任务与检查点不带 `*`。
- 每个任务标注对应 Requirements 子条款以保证可追溯。
- 5 条属性测试任务一一对应设计的 Property 1–5，并标注 Validates 与 ≥100 迭代要求；前端用 fast-check（`numRuns >= 100`），后端用 proptest（`ProptestConfig::with_cases(>=100)`）。Property 1 与 Property 4 在前后端各有一份断言（共享测试向量保证跨语言等价）。
- 依赖顺序保证任意时刻前后端均可编译：后端纯函数（1.1/1.3）先于 handler 接线（2.1/2.2）；前端纯函数（4.x）先于 store/ChatPage/Param_Panel；`build_ollama_body` 守护「缺省无回归」核心约束。
- 本特性为纯增量增强：不破坏 Chat_Endpoint/Stream_Endpoint 契约、不改 Model_Selection 回退、不回归会话持久化/流式输出/语音交互；新增字段均可选，Default_State 下行为与现状逐字段等价。
- 长时进程（`vite`/`vitest --watch`）请勿在自动化中启动；测试统一用 `--run` / `cargo test` 单次执行。

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "4.1"] },
    { "id": 1, "tasks": ["1.3", "4.3", "4.2"] },
    { "id": 2, "tasks": ["2.1", "4.5", "4.4"] },
    { "id": 3, "tasks": ["1.2", "5.1", "4.6"] },
    { "id": 4, "tasks": ["1.4", "2.2", "5.3", "4.7"] },
    { "id": 5, "tasks": ["1.5", "5.4", "5.2"] },
    { "id": 6, "tasks": ["2.3", "5.5"] }
  ]
}
```
