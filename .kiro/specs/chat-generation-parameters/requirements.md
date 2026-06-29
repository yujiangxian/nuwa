# Requirements Document

## Introduction

「对话生成参数调节」(chat-generation-parameters) 特性为女娲 Nuwa 对话应用引入可调节的模型生成参数。用户可在对话页/设置中调节一组影响大模型采样行为的生成参数（核心为采样温度 Temperature、核采样 Top_P、最大生成长度 Num_Predict，并含核采样个数 Top_K、重复惩罚 Repeat_Penalty）。调整后的参数经 Nuwa_Web 现有前端状态存储（Chat_Store，Zustand + localStorage）持久化保存；每次发起对话请求时，这些参数随请求体下发给后端 Voxcpm_Server，由 Voxcpm_Server 作为 Ollama 的 `options` 字段透传给 `http://localhost:11434/api/chat`，并同时作用于既有非流式接口 `POST /api/chat`（Chat_Endpoint）与流式接口 `POST /api/chat/stream`（Stream_Endpoint）。

本特性为**纯增量增强**，遵循以下不破坏约束：

- 不破坏 Chat_Endpoint 与 Stream_Endpoint 既有请求/响应契约：所有新增的生成参数字段均为可选；当对话请求未携带任何生成参数时（Default_State），Voxcpm_Server 构造的 Ollama 请求体与本特性引入前完全一致（不含 `options` 字段）。
- 不改变 Model_Selection 回退顺序（`current_llm_model` → `current_model_id` → 请求体 `model`）。
- 不回归 chat-session-persistence（会话历史持久化）、streaming-chat-output（流式对话输出）、voice-interaction-loop（语音交互闭环）等既有特性。

本特性复用既有结构：后端复用 `ChatRequest`（`backend/server/src/handlers/chat.rs` 的 `{ messages, model?, system? }`）并以可选字段扩展，复用 `resolve_model` 与 `build_ollama_body`；前端复用 Chat_Store 的持久化机制与 `ChatPage` 的发送逻辑（含流式 `consumeChatStream` 与非流式降级）。

本特性覆盖以下相互关联的目标，作为一个整体交付：

1. 参数调节与持久化：用户在 Param_Panel 调节 Generation_Params，经 Chat_Store + localStorage 持久化与恢复。
2. 取值范围校验/钳制：每个 Generation_Param 有明确取值范围，由 Param_Validator 钳制到合法范围。
3. 恢复默认：用户可一键将所有 Generation_Params 恢复到 Default_State。
4. 前端随请求下发：每次对话请求（流式与非流式降级）携带当前已设置的 Generation_Params。
5. 后端透传为 Ollama options：Voxcpm_Server 在 Chat_Endpoint 与 Stream_Endpoint 上接受可选生成参数并组装为 Ollama_Options 透传给 Ollama。
6. 缺省无回归：Default_State 下请求不含任何生成参数，Voxcpm_Server 不向 Ollama 下发 `options`，行为与现状完全一致。
7. 无回归约束：Chat_Endpoint/Stream_Endpoint 契约、Model_Selection、会话持久化、流式输出、语音交互等既有功能不受影响。

## Glossary

- **Nuwa_Web**: 前端 React 19 + Vite 应用，源码位于 `app/web/src`。
- **Voxcpm_Server**: 后端 Rust + Axum 服务（crate `voxcpm-server`），监听 8080，源码位于 `backend/server/src`。
- **Chat_Page**: Nuwa_Web 的「对话」页面，组件 `app/web/src/components/ChatPage.tsx`。
- **Chat_Store**: Nuwa_Web 的全局状态存储（Zustand），位于 `app/web/src/store/uiStore.ts`，提供 `messages`、`appendMessage`、`settings` 等，并经 localStorage 持久化部分状态。
- **Ollama**: 本地大模型推理服务，HTTP 端点为 `http://localhost:11434`，对话端点为 `http://localhost:11434/api/chat`。
- **Chat_Endpoint**: 既有非流式对话接口 `POST /api/chat`，请求体 `{ messages, model?, system? }`，响应 `{ role, content, model, done }`，错误响应 `{ error }`。
- **Stream_Endpoint**: 既有流式对话接口 `POST /api/chat/stream`，接受与 Chat_Endpoint 相同结构的请求体，向 Nuwa_Web 逐块下发增量内容（NDJSON）。
- **Generation_Params**: 一组影响大模型生成行为的可调节参数集合，成员为 Temperature、Top_P、Num_Predict、Top_K、Repeat_Penalty。
- **Temperature**: 采样温度，取值范围闭区间 `[0.0, 2.0]`，映射为 Ollama 选项键 `temperature`。
- **Top_P**: 核采样阈值，取值范围闭区间 `[0.0, 1.0]`，映射为 Ollama 选项键 `top_p`。
- **Num_Predict**: 单次回复最大生成长度（token 数），取值为整数 `-1` 或闭区间 `[1, 8192]` 内的整数；`-1` 表示不限制生成长度（Unlimited_Length）；映射为 Ollama 选项键 `num_predict`。
- **Top_K**: 核采样候选个数，取值为闭区间 `[0, 100]` 内的整数，映射为 Ollama 选项键 `top_k`。
- **Repeat_Penalty**: 重复惩罚系数，取值范围闭区间 `[0.0, 2.0]`，映射为 Ollama 选项键 `repeat_penalty`。
- **Unlimited_Length**: Num_Predict 取值为 `-1` 时表示的「不限制生成长度」语义。
- **Param_State**: 单个 Generation_Param 的设置态，取值为 Active（用户已设置一个合法数值）或 Inactive（采用模型内建默认、不随请求下发）。
- **Active_Param**: 处于 Active 状态的 Generation_Param，会随对话请求下发。
- **Default_State**: Generation_Params 的初始状态，其中所有成员均为 Inactive；该状态下对话请求不含任何生成参数字段。
- **Param_Panel**: Chat_Page/设置中用于调节 Generation_Params 的界面控件区。
- **Param_Validator**: Nuwa_Web 中对 Generation_Params 取值进行范围校验/钳制的纯逻辑。
- **Server_Param_Validator**: Voxcpm_Server 中对收到的生成参数进行范围校验/钳制的逻辑，使用与 Param_Validator 等价的取值范围。
- **Ollama_Options**: Voxcpm_Server 发往 Ollama 请求体中的 `options` 对象，承载由 Active_Param 映射而来的生成选项。
- **Restore_Defaults**: 用户触发的「恢复默认」操作，将所有 Generation_Params 重置为 Default_State。
- **Model_Selection**: Voxcpm_Server 选择对话模型的回退顺序：`current_llm_model` → `current_model_id` → 请求体 `model`（默认 `gemma4:e4b`）。
- **System_Prompt**: 当前角色的 `systemPrompt`，随对话请求作为 `system` 字段传给后端。
- **Param_Persistence**: 经 Chat_Store + localStorage 对 Generation_Params 的本地持久化与恢复能力。
- **Session_Persistence**: 已交付的「会话历史持久化」能力。
- **Streaming_Output**: 已交付的「流式对话输出」能力（Stream_Endpoint + 前端流式渲染）。
- **Voice_Loop**: 已交付的「语音交互闭环」能力，含麦克风语音输入（ASR）与 assistant 回复 TTS 朗读（autoPlay）。

## Requirements

### Requirement 1: 参数调节与持久化

**User Story:** 作为女娲用户，我想调节对话模型的生成参数并让其被保存，以便在多次会话与重启后保持我偏好的生成行为。

#### Acceptance Criteria

1. THE Param_Panel SHALL 为 Generation_Params 中的每个成员（Temperature、Top_P、Num_Predict、Top_K、Repeat_Penalty）提供调节控件。
2. WHEN 用户经 Param_Panel 将某个 Generation_Param 设置为一个合法数值，THE Chat_Store SHALL 将该 Generation_Param 置为 Active 并记录其数值。
3. WHEN 某个 Generation_Param 的设置态或数值发生变更，THE Chat_Store SHALL 通过 localStorage 持久化更新后的 Generation_Params。
4. WHEN Nuwa_Web 重新加载，THE Chat_Store SHALL 从 localStorage 恢复上次持久化的 Generation_Params（含每个成员的设置态与数值）。
5. IF localStorage 中不存在已持久化的 Generation_Params，THEN THE Chat_Store SHALL 以 Default_State 初始化 Generation_Params。
6. WHEN Generation_Params 经持久化后再被恢复，THE Chat_Store SHALL 使恢复后的每个 Active_Param 的数值与持久化前相等（持久化 round-trip）。

### Requirement 2: 取值范围校验与钳制

**User Story:** 作为女娲用户，我想让我输入的生成参数被约束到合理范围，以便避免无效取值导致请求异常或不可预期的生成结果。

#### Acceptance Criteria

1. WHEN 用户为 Temperature 提供一个数值，THE Param_Validator SHALL 将其钳制到闭区间 `[0.0, 2.0]`。
2. WHEN 用户为 Top_P 提供一个数值，THE Param_Validator SHALL 将其钳制到闭区间 `[0.0, 1.0]`。
3. WHEN 用户为 Top_K 提供一个数值，THE Param_Validator SHALL 将其取整并钳制到闭区间 `[0, 100]`。
4. WHEN 用户为 Repeat_Penalty 提供一个数值，THE Param_Validator SHALL 将其钳制到闭区间 `[0.0, 2.0]`。
5. WHEN 用户为 Num_Predict 提供数值 `-1`，THE Param_Validator SHALL 将其作为 Unlimited_Length 保留为 `-1`。
6. WHEN 用户为 Num_Predict 提供 `-1` 以外的数值，THE Param_Validator SHALL 将其取整并钳制到闭区间 `[1, 8192]`。
7. THE Param_Validator SHALL 对已合法的取值产生幂等结果（再次校验同一已钳制取值时结果不变）。

### Requirement 3: 恢复默认

**User Story:** 作为女娲用户，我想一键把生成参数恢复到默认，以便快速回到与现状一致的模型默认行为。

#### Acceptance Criteria

1. THE Param_Panel SHALL 提供 Restore_Defaults 操作入口。
2. WHEN 用户触发 Restore_Defaults，THE Chat_Store SHALL 将所有 Generation_Params 重置为 Default_State。
3. WHEN Restore_Defaults 完成，THE Chat_Store SHALL 通过 localStorage 持久化已重置为 Default_State 的 Generation_Params。

### Requirement 4: 前端随对话请求下发参数

**User Story:** 作为女娲用户，我想让我调节的生成参数对我的每次对话生效，以便每条回复都按照我的偏好生成。

#### Acceptance Criteria

1. WHEN Chat_Page 经 Stream_Endpoint 发起一次对话请求，THE Chat_Page SHALL 在请求体中包含当前全部 Active_Param 及其数值。
2. WHEN Chat_Page 经 Chat_Endpoint（非流式降级）发起一次对话请求，THE Chat_Page SHALL 在请求体中包含当前全部 Active_Param 及其数值。
3. WHILE Generation_Params 处于 Default_State，THE Chat_Page SHALL 不在对话请求体中包含任何 Generation_Param 字段。
4. WHEN Chat_Page 在请求体中包含某个 Active_Param，THE Chat_Page SHALL 使用对应 Ollama 选项键名（`temperature`、`top_p`、`num_predict`、`top_k`、`repeat_penalty`）并下发其经 Param_Validator 钳制后的取值。
5. THE Chat_Page SHALL 在包含 Generation_Params 的同时保持既有请求字段（`messages`、`system`）不变。

### Requirement 5: 后端透传为 Ollama options

**User Story:** 作为女娲维护者，我想让后端把前端下发的生成参数透传给 Ollama，以便生成参数对模型推理实际生效，且两个对话接口行为一致。

#### Acceptance Criteria

1. THE Voxcpm_Server SHALL 在 Chat_Endpoint 与 Stream_Endpoint 的请求体中接受可选的生成参数字段（`temperature`、`top_p`、`num_predict`、`top_k`、`repeat_penalty`）。
2. WHEN 一个对话请求包含一个或多个生成参数，THE Server_Param_Validator SHALL 对每个收到的生成参数应用与 Param_Validator 等价的取值范围钳制。
3. WHEN 一个对话请求包含一个或多个生成参数，THE Voxcpm_Server SHALL 将这些（经钳制的）参数组装为 Ollama_Options 并置入发往 `http://localhost:11434/api/chat` 的请求体 `options` 字段。
4. WHEN Voxcpm_Server 组装 Ollama_Options，THE Voxcpm_Server SHALL 使 Ollama_Options 恰好包含请求中提供的生成参数，且不注入请求未提供的生成参数。
5. THE Voxcpm_Server SHALL 对 Chat_Endpoint 与 Stream_Endpoint 应用相同的生成参数接收、钳制与透传逻辑。

### Requirement 6: 缺省无回归

**User Story:** 作为女娲维护者，我想确保未设置生成参数时行为与现状完全一致，以便本特性以纯增量方式安全交付。

#### Acceptance Criteria

1. IF 一个对话请求不包含任何生成参数字段，THEN THE Voxcpm_Server SHALL 构造不含 `options` 字段的 Ollama 请求体。
2. WHEN 一个对话请求不包含任何生成参数字段，THE Voxcpm_Server SHALL 使发往 Ollama 的请求体与本特性引入前的请求体逐字段等价（仅含 `model`、`messages`、`stream`）。
3. WHILE Generation_Params 处于 Default_State，THE Nuwa_Web SHALL 使对话生成行为与本特性引入前一致。

### Requirement 7: 无回归约束

**User Story:** 作为女娲维护者，我想确保引入生成参数调节后既有功能保持可用，以便不破坏已交付特性。

#### Acceptance Criteria

1. THE Voxcpm_Server SHALL 在本特性变更后保持 Chat_Endpoint（`POST /api/chat`）的请求与响应契约可正常使用。
2. THE Voxcpm_Server SHALL 在本特性变更后保持 Stream_Endpoint（`POST /api/chat/stream`）的请求与响应契约可正常使用。
3. THE Voxcpm_Server SHALL 在本特性变更后保持 Model_Selection 的回退顺序行为不变。
4. THE Nuwa_Web SHALL 在本特性变更后保持 Session_Persistence 的会话新建、切换、删除、重命名与历史恢复功能可正常使用。
5. THE Nuwa_Web SHALL 在本特性变更后保持 Streaming_Output 的流式渲染、停止生成与降级行为可正常使用。
6. THE Nuwa_Web SHALL 在本特性变更后保持 Voice_Loop 的麦克风语音输入与 TTS 朗读功能可正常使用。
