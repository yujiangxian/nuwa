# Requirements Document

## Introduction

「上下文窗口与 Token 预算管理」(context-window-management) 特性为女娲 Nuwa 对话应用引入对模型上下文窗口（context window）的可见与可控管理。随着对话轮次增加，发送给大模型的内容（System_Prompt + 历史消息）会逐渐逼近模型上下文长度上限，超限会导致请求被截断或失败。本特性在纯前端范围内提供一套确定性的 Token 估算与预算计算能力，并据此在对话页给出可视化占用指示、临近/超限告警，以及在即将超限时对外发请求自动裁剪历史消息（始终保留 System_Prompt、永不丢弃最新一条 user 消息），同时向用户指明已裁剪。

本特性为**纯增量增强**，仅作用于 Nuwa_Web 前端，遵循以下约束：

- 纯逻辑放在 `src/lib`，与同名 `*.test.ts` 共置，确定性、可被 fast-check 属性测试覆盖（Token 估算、预算计算、裁剪均为纯函数）。
- 全局状态（如告警/裁剪展示态）放在 `src/store/uiStore.ts`（Chat_Store）。
- 视图组件放在 `src/components`。
- 不改变 Chat_Endpoint / Stream_Endpoint 既有请求/响应契约：裁剪只改变随请求下发的 `messages` 内容（更少的历史消息），不新增后端字段。
- 不回归 chat-session-persistence（会话历史持久化）、streaming-chat-output（流式对话输出）、chat-generation-parameters（生成参数调节，提供 Num_Predict）、voice-interaction-loop（语音交互闭环）等既有特性。

由于当前 Installed_Model 元数据未携带上下文长度字段，本特性引入 Context_Resolver，从 Active_Model 解析其 Context_Length；当无法获知时回退到 Default_Context_Length 并标记为「估算值」。

本特性覆盖以下相互关联的目标，作为一个整体交付：

1. Token 估算：纯函数 Token_Estimator 对字符串与消息列表给出确定性、单调的 Token_Estimate（启发式按字符估算）。
2. 上下文长度解析与缺省兜底：从 Active_Model 解析 Context_Length；未知时回退 Default_Context_Length 并标记 Is_Estimated。
3. 预算计算：依据 Context_Length、System_Prompt、对话消息与 Reserved_Response_Tokens 计算 Used_Tokens、Remaining_Tokens 与 Usage_Ratio（钳制到 [0,1]）。
4. 占用等级判定：依据 Usage_Ratio 与超限条件判定 Usage_State（normal / warning / over）。
5. 可视化占用指示：Chat_Page 展示 Usage_Indicator，反映当前占用、上下文窗口与 Usage_State，且在 Is_Estimated 时标明为估算。
6. 自动上下文裁剪：纯确定性 Context_Trimmer 在将超预算时丢弃最旧的非系统消息，始终保留 System_Prompt、永不丢弃最新 user 消息，返回应发送消息与裁剪条数。
7. 告警与裁剪提示：临近/超限时向用户告警；当本次外发请求发生裁剪时指明已裁剪及条数。
8. 无回归约束：会话持久化、流式输出、生成参数、语音交互等既有功能不受影响。

## Glossary

- **Nuwa_Web**: 前端 React 19 + TypeScript + Vite 应用，源码位于 `app/web/src`。
- **Chat_Page**: Nuwa_Web 的「对话」页面，组件 `app/web/src/components/ChatPage.tsx`。
- **Chat_Store**: Nuwa_Web 的全局状态存储（Zustand），位于 `app/web/src/store/uiStore.ts`，提供 `messages`、`appendMessage`、`settings` 等。
- **Chat_Message**: 一条对话消息记录，字段为 `{ id, role, content, ... }`，其中 `role` 取值 `'user' | 'assistant'`。
- **System_Prompt**: 当前 Character 的 `systemPrompt` 文本，作为对话请求的 `system` 字段，逻辑上为对话上下文的首条系统消息。
- **Active_Model**: 当前选中的对话（llm）模型，由 model-management 的 Active_Model_Map 解析得到。
- **Context_Length**: 模型上下文窗口的最大 token 容量（正整数），表示单次请求可容纳的 token 上限。
- **Default_Context_Length**: 当 Active_Model 的 Context_Length 无法获知时采用的缺省值，取 `4096`（tokens）。
- **Context_Resolver**: Nuwa_Web 解析 Active_Model 的 Context_Length 的纯逻辑；无法获知时回退 Default_Context_Length 并置 Is_Estimated 为真。位于 `src/lib/contextWindow.ts`。
- **Is_Estimated**: 布尔标志，为真表示当前所用 Context_Length 来自 Default_Context_Length（估算）而非模型已知值。
- **Token_Estimator**: 对字符串或 Chat_Message 列表估算 token 数的纯函数，启发式按字符估算，确定性且单调。位于 `src/lib/tokenEstimate.ts`。
- **Token_Estimate**: Token_Estimator 的输出，一个非负整数。
- **Reserved_Response_Tokens**: 为模型回复预留的 token 数；来源于 chat-generation-parameters 的 Num_Predict（Ollama `num_predict`）：当 Num_Predict 为 Active 且为正整数时取其值，否则（Inactive 或取 `-1` 的 Unlimited_Length）取 Default_Reserved_Tokens。
- **Default_Reserved_Tokens**: Reserved_Response_Tokens 不可由 Num_Predict 确定时采用的缺省预留值，取 `512`（tokens）。
- **Context_Budget**: 由 Context_Length、System_Prompt、对话消息与 Reserved_Response_Tokens 计算出的预算结果，含 Used_Tokens、Remaining_Tokens、Usage_Ratio、Usage_State 与 Is_Estimated。位于 `src/lib/contextBudget.ts`。
- **Used_Tokens**: 已占用 token 数，等于 System_Prompt 的 Token_Estimate 与全部对话消息的 Token_Estimate 之和。
- **Remaining_Tokens**: 剩余可用 token 数，等于 `Context_Length - Used_Tokens - Reserved_Response_Tokens`（可为负，负值表示已超出可用预算）。
- **Usage_Ratio**: 占用比例，等于 `(Used_Tokens + Reserved_Response_Tokens) / Context_Length`，钳制到闭区间 `[0, 1]`。
- **Warning_Threshold**: 判定 warning 的占用比例阈值，取 `0.8`。
- **Usage_State**: 占用等级，取值 `normal`、`warning`、`over` 三者之一。
- **Context_Trimmer**: 在将超预算时裁剪历史消息的纯确定性函数，返回应发送的消息列表与被裁剪条数。位于 `src/lib/contextTrim.ts`。
- **Trim_Result**: Context_Trimmer 的输出，字段为 `{ messages, trimmedCount }`，`messages` 为应发送的 Chat_Message 列表，`trimmedCount` 为被裁剪掉的消息条数（非负整数）。
- **Latest_User_Message**: 对话消息中按出现顺序最后一条 `role === 'user'` 的 Chat_Message。
- **Usage_Indicator**: Chat_Page 中展示上下文占用情况的视图组件，位于 `src/components`。
- **Trim_Notice**: 当本次外发请求发生裁剪（trimmedCount > 0）时向用户呈现的「已裁剪 N 条历史消息」提示。
- **Session_Persistence**: 已交付的「会话历史持久化」能力。
- **Streaming_Output**: 已交付的「流式对话输出」能力。
- **Generation_Params**: 已交付的「对话生成参数调节」能力，提供 Num_Predict。
- **Voice_Loop**: 已交付的「语音交互闭环」能力。

## Requirements

### Requirement 1: Token 估算

**User Story:** 作为女娲用户，我想让系统对消息内容估算 token 数，以便据此判断对话是否逼近模型上下文上限。

#### Acceptance Criteria

1. WHEN Token_Estimator 接收一个字符串，THE Token_Estimator SHALL 返回一个非负整数 Token_Estimate。
2. WHEN Token_Estimator 接收空字符串，THE Token_Estimator SHALL 返回 `0`。
3. WHEN Token_Estimator 对同一输入被多次调用，THE Token_Estimator SHALL 返回相同的 Token_Estimate（确定性）。
4. WHEN Token_Estimator 接收两个字符串 A 与 B 的拼接结果，THE Token_Estimator SHALL 使 `estimate(A + B)` 大于或等于 `estimate(A)`（追加内容不减少估算值，单调性）。
5. WHEN Token_Estimator 接收一个 Chat_Message 列表，THE Token_Estimator SHALL 返回各消息 `content` 的 Token_Estimate 与每条消息固定结构开销之和。
6. WHEN Token_Estimator 接收空的 Chat_Message 列表，THE Token_Estimator SHALL 返回 `0`。

### Requirement 2: 上下文长度解析与缺省兜底

**User Story:** 作为女娲用户，我想在模型未提供上下文长度时仍能得到一个合理的预算依据，以便占用指示与裁剪在任何模型下都可用。

#### Acceptance Criteria

1. WHEN Context_Resolver 能从 Active_Model 获知其 Context_Length，THE Context_Resolver SHALL 返回该 Context_Length 并将 Is_Estimated 置为 `false`。
2. IF Active_Model 不存在或其 Context_Length 无法获知，THEN THE Context_Resolver SHALL 返回 Default_Context_Length（`4096`）并将 Is_Estimated 置为 `true`。
3. IF Active_Model 提供的 Context_Length 不是正整数，THEN THE Context_Resolver SHALL 返回 Default_Context_Length（`4096`）并将 Is_Estimated 置为 `true`。
4. THE Context_Resolver SHALL 返回一个大于 `0` 的 Context_Length。

### Requirement 3: 预算计算

**User Story:** 作为女娲用户，我想知道当前对话已占用多少、还剩多少上下文预算，以便决定是否需要精简对话。

#### Acceptance Criteria

1. WHEN Context_Budget 被计算，THE Chat_Store SHALL 使 Used_Tokens 等于 System_Prompt 的 Token_Estimate 与全部对话消息的 Token_Estimate 之和。
2. WHEN Context_Budget 被计算，THE Chat_Store SHALL 依据 Generation_Params 的 Num_Predict 确定 Reserved_Response_Tokens：Num_Predict 为 Active 且为正整数时取其值，否则取 Default_Reserved_Tokens（`512`）。
3. WHEN Context_Budget 被计算，THE Chat_Store SHALL 使 Remaining_Tokens 等于 `Context_Length - Used_Tokens - Reserved_Response_Tokens`。
4. WHEN Context_Budget 被计算，THE Chat_Store SHALL 使 Usage_Ratio 等于 `(Used_Tokens + Reserved_Response_Tokens) / Context_Length` 钳制到闭区间 `[0, 1]` 后的结果。
5. WHEN 给定相同的 Context_Length、System_Prompt、对话消息与 Reserved_Response_Tokens，THE Context_Budget 计算 SHALL 产生相同的结果（确定性）。

### Requirement 4: 占用等级判定

**User Story:** 作为女娲用户，我想用直观的状态区分正常、临近上限与已超限，以便快速判断对话的健康程度。

#### Acceptance Criteria

1. IF `Used_Tokens + Reserved_Response_Tokens` 大于 Context_Length，THEN THE Context_Budget SHALL 将 Usage_State 置为 `over`。
2. WHILE Usage_State 不为 `over` 且 Usage_Ratio 大于或等于 Warning_Threshold（`0.8`），THE Context_Budget SHALL 将 Usage_State 置为 `warning`。
3. WHILE Usage_State 不为 `over` 且 Usage_Ratio 小于 Warning_Threshold（`0.8`），THE Context_Budget SHALL 将 Usage_State 置为 `normal`。

### Requirement 5: 可视化占用指示

**User Story:** 作为女娲用户，我想在对话页看到当前占用与上下文窗口的对比，以便随时掌握上下文使用情况。

#### Acceptance Criteria

1. THE Usage_Indicator SHALL 在 Chat_Page 展示当前 Used_Tokens 与 Context_Length 的占比。
2. WHEN Usage_State 为 `normal`、`warning` 或 `over`，THE Usage_Indicator SHALL 以与该 Usage_State 对应的视觉样式呈现。
3. WHERE Is_Estimated 为真，THE Usage_Indicator SHALL 标明当前上下文长度为估算值。
4. WHEN Context_Budget 更新，THE Usage_Indicator SHALL 呈现更新后的 Used_Tokens、Remaining_Tokens 与 Usage_State。

### Requirement 6: 自动上下文裁剪

**User Story:** 作为女娲用户，我想在对话即将超出上下文预算时自动精简发送的历史消息，以便请求仍能成功且保留最关键的内容。

#### Acceptance Criteria

1. WHEN Context_Trimmer 处理一组对话消息且其 Used_Tokens 与 Reserved_Response_Tokens 之和未超过 Context_Length，THE Context_Trimmer SHALL 返回与输入等价的消息列表且 `trimmedCount` 为 `0`。
2. WHILE 当前消息组合的 `Used_Tokens + Reserved_Response_Tokens` 超过 Context_Length 且存在可裁剪消息，THE Context_Trimmer SHALL 按出现顺序从最旧的非系统消息开始丢弃。
3. THE Context_Trimmer SHALL 在任何情况下都保留 System_Prompt（System_Prompt 不计入可丢弃消息）。
4. THE Context_Trimmer SHALL 在任何情况下都保留 Latest_User_Message。
5. WHEN Context_Trimmer 返回 Trim_Result，THE Context_Trimmer SHALL 使返回的 `messages` 为输入对话消息的一个保序子序列。
6. WHEN Context_Trimmer 返回 Trim_Result，THE Context_Trimmer SHALL 使 `trimmedCount` 等于输入对话消息条数与返回 `messages` 条数之差。
7. WHEN 给定相同的输入消息、System_Prompt、Context_Length 与 Reserved_Response_Tokens，THE Context_Trimmer SHALL 产生相同的 Trim_Result（确定性）。
8. WHEN Chat_Page 发起一次对话请求，THE Chat_Page SHALL 以 Context_Trimmer 返回的 `messages` 作为随请求下发的历史消息。

### Requirement 7: 告警与裁剪提示

**User Story:** 作为女娲用户，我想在临近或超出上下文上限以及历史被裁剪时收到提示，以便了解对话的限制与系统所做的处理。

#### Acceptance Criteria

1. WHILE Usage_State 为 `warning`，THE Chat_Page SHALL 向用户呈现临近上下文上限的告警。
2. WHILE Usage_State 为 `over`，THE Chat_Page SHALL 向用户呈现已超出上下文上限的告警。
3. WHEN 本次外发请求的 Trim_Result 中 `trimmedCount` 大于 `0`，THE Chat_Page SHALL 呈现 Trim_Notice 指明被裁剪的历史消息条数。
4. WHILE Usage_State 为 `normal` 且本次外发请求未发生裁剪，THE Chat_Page SHALL 不呈现告警或 Trim_Notice。

### Requirement 8: 无回归约束

**User Story:** 作为女娲维护者，我想确保引入上下文窗口管理后既有功能保持可用，以便本特性以纯增量方式安全交付。

#### Acceptance Criteria

1. THE Nuwa_Web SHALL 在本特性变更后保持 Session_Persistence 的会话新建、切换、删除、重命名与历史恢复功能可正常使用。
2. THE Nuwa_Web SHALL 在本特性变更后保持 Streaming_Output 的流式渲染、停止生成与降级行为可正常使用。
3. THE Nuwa_Web SHALL 在本特性变更后保持 Generation_Params 的参数调节、持久化与随请求下发功能可正常使用。
4. THE Nuwa_Web SHALL 在本特性变更后保持 Voice_Loop 的麦克风语音输入与 TTS 朗读功能可正常使用。
5. THE Nuwa_Web SHALL 在本特性变更后保持 Chat_Endpoint 与 Stream_Endpoint 既有请求/响应契约不变（不新增后端字段）。
