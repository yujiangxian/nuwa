# Requirements Document

## Introduction

「智能体回合 Reducer」(agent-turn-reducer) 是女娲 Nuwa「多智能体工作流编排引擎」的**第九个子规格**，构建于前八个子规格之上（图模型、节点类型、执行引擎、智能体注册表、工具系统、工具解析、消息协议、对话装配）。

本子规格的职责是定义一个**纯的、确定的 reducer 状态机**，用于推进一段多智能体对话的**单步状态转换**：把「模型输出」(Model_Response) 与「工具结果」(Tool_Outcome) 作为**纯数据注入**（本层**不真正调用任何语言模型或工具**），据此把助手消息与工具结果消息追加进「对话记录」(Transcript)，并在「等待模型」(awaiting_model)、「等待工具」(awaiting_tools)、「完成」(completed) 三个状态之间确定地转移。实现位于 `app/web/src/lib/turn/`。

**核心约束（关键设计原则）**：本子规格必须是**纯数据 + 纯函数**的库，**不含任何 I/O、不依赖 React、不发起任何网络访问、不调用任何语言模型或工具**，亦不含可变全局状态、时间或随机依赖。Turn_State 是**不可变值**：一切转换都返回**新的状态**而绝不就地修改既有状态。所有错误都建模为带稳定错误码 (TurnErrorCode) 的 TurnError 值，其取值集合与前序八层的错误码取值集合互不相交。本层以散文/类型引用前序类型（`Message`、`Transcript`、`Role` 等），并复用消息层的追加与校验，不重定义。

本子规格的范围限定为以下相互关联、作为整体交付的目标：

1. **回合状态模型** (Turn_State)：含当前 Transcript、Turn_Status 与一个待决工具调用标识列表 (Pending_Call_Ids)。
2. **模型输出数据模型** (Model_Response)：含一个 Message_Id、一段可选的助手文本 (Assistant_Text)、与一个工具调用列表 (Tool_Call_List，每项含 Call_Id、Tool_Name、Arguments_Json)，表示语言模型在一步返回的内容。
3. **工具结果数据模型** (Tool_Outcome)：含一个 Call_Id 与一段结果文本 (Result_Json)，表示一次工具调用的结果。
4. **初始状态** (`initialTurnState`)：从一个 Transcript 构造一个 Turn_Status 为 awaiting_model、Pending_Call_Ids 为空的初始 Turn_State。
5. **施加模型输出** (`applyModelResponse`)：仅在 awaiting_model 状态下合法；把 Model_Response 转换为一条 Role 为 assistant 的 Message 追加进 Transcript；若含工具调用则转移到 awaiting_tools 并记录 Pending_Call_Ids，否则转移到 completed。
6. **施加工具结果** (`applyToolResults`)：仅在 awaiting_tools 状态下合法；把每个 Tool_Outcome 转换为 Role 为 tool 的工具结果消息追加进 Transcript；从 Pending_Call_Ids 移除已结算的 Call_Id；当 Pending_Call_Ids 清空时转移回 awaiting_model。
7. **错误处理**：在错误状态下施加转换、对未在待决集合中的 Call_Id 提供结果、或使用与 Transcript 冲突的 Message_Id，均以带稳定错误码的 TurnError 值表达，不抛异常。

本子规格仅产出本回合 reducer 层的需求与纯函数契约，**不做任何实现**。

## Glossary

- **Agent_Turn_Reducer**: 本子规格定义的整体模块（Turn_State 纯数据模型 + 确定 reducer 转换函数库），位于 `app/web/src/lib/turn/`。
- **Turn_State**: 回合状态，由当前 Transcript、Turn_Status 与 Pending_Call_Ids 组成的不可变值。
- **Turn_Status**: 回合状态机的状态，取值为 `awaiting_model`、`awaiting_tools`、`completed` 之一。
- **Pending_Call_Ids**: Turn_State 中尚未收到结果的工具调用 Call_Id 的有序列表，不含重复。
- **Model_Response**: 表示语言模型一步输出的不可变数据，含 Message_Id、可选 Assistant_Text 与 Tool_Call_List。
- **Assistant_Text**: Model_Response 中助手的文本内容，可不存在 (空)。
- **Tool_Call_List**: Model_Response 中工具调用的有序列表，每项含 Call_Id、Tool_Name 与 Arguments_Json。
- **Tool_Outcome**: 表示一次工具调用结果的不可变数据，含 Call_Id 与 Result_Json。
- **Call_Id**: 标识一次工具调用的非空字符串，用于把 Tool_Outcome 关联到 Tool_Call_List 中的调用。
- **Message / Transcript / Role**: 前序层 (agent-message-protocol) 定义的类型，本子规格仅以散文引用。
- **Transcript_Result**: 前序层 (agent-message-protocol) 的追加操作结果，本子规格在内部复用。
- **TurnError**: 单条错误值，含 TurnErrorCode、定位信息（涉及的 Call_Id / Message_Id / 状态名等）与人类可读描述。
- **TurnErrorCode**: TurnError 的稳定枚举标识，其取值集合与前序八层的错误码取值集合互不相交。
- **Turn_Result**: 转换函数 (`applyModelResponse`/`applyToolResults`) 的返回，或为成功（携带新 Turn_State），或为失败（携带一个 TurnError）。
- **Determinism**: 纯函数对相同输入恒产出相同输出的确定性性质。
- **Idempotence**: 一个操作施加一次与施加多次结果相同的幂等性质。

## Requirements

### Requirement 1: 模块范围与纯库约束

**User Story:** 作为编排引擎开发者，我想要一个不含 I/O、网络与 React 依赖、且不调用模型或工具的纯回合 reducer，以便其行为完全确定且可用属性测试验证。

#### Acceptance Criteria

1. THE Agent_Turn_Reducer SHALL 仅由纯函数与不可变类型构成，不包含 I/O、网络访问、React 依赖、可变全局状态、时间或随机依赖。
2. THE Agent_Turn_Reducer SHALL 仅以散文与类型引用前序子规格中已定义的类型（如 `Message`、`Transcript`、`Role`），而不重新定义它们。
3. FOR ALL Agent_Turn_Reducer 对外暴露的函数，THE Agent_Turn_Reducer SHALL 对相同输入返回相同输出（确定性）。
4. THE Agent_Turn_Reducer SHALL 不就地修改任何输入的 Turn_State、Model_Response、Tool_Outcome 或 Transcript，所有结果均以新值返回（不可变性）。
5. THE Agent_Turn_Reducer SHALL 不调用任何语言模型或工具、不产生任何副作用；模型输出与工具结果均以纯数据注入。

### Requirement 2: 回合状态与数据模型

**User Story:** 作为编排引擎开发者，我想要明确的回合状态与注入数据模型，以便统一表达对话推进的输入与输出。

#### Acceptance Criteria

1. THE Agent_Turn_Reducer SHALL 将 Turn_State 定义为由一个 Transcript、一个 Turn_Status 与一个 Pending_Call_Ids 列表组成的不可变结构。
2. THE Agent_Turn_Reducer SHALL 将 Turn_Status 定义为取值于 `awaiting_model`、`awaiting_tools`、`completed` 的枚举。
3. THE Agent_Turn_Reducer SHALL 将 Model_Response 定义为由 Message_Id、可选 Assistant_Text 与 Tool_Call_List 组成的不可变结构，其每个 Tool_Call 含 Call_Id、Tool_Name 与 Arguments_Json。
4. THE Agent_Turn_Reducer SHALL 将 Tool_Outcome 定义为由 Call_Id 与 Result_Json 组成的不可变结构。
5. THE Agent_Turn_Reducer SHALL 使 Turn_State、Model_Response 与 Tool_Outcome 的判等基于其全部字段的语义内容。

### Requirement 3: 初始状态 (initialTurnState)

**User Story:** 作为编排引擎开发者，我想要从一段对话记录构造初始回合状态，以便开始推进对话。

#### Acceptance Criteria

1. THE Agent_Turn_Reducer SHALL 提供纯函数 `initialTurnState(transcript)`，返回一个 Turn_State。
2. WHEN `initialTurnState(transcript)` 被调用，THE Agent_Turn_Reducer SHALL 使所返回 Turn_State 的 Transcript 等于 `transcript`、Turn_Status 为 `awaiting_model`、Pending_Call_Ids 为空。
3. FOR ALL `transcript`，THE Agent_Turn_Reducer SHALL 对相同输入返回相等的初始 Turn_State（确定性）。

### Requirement 4: 施加模型输出 (applyModelResponse)

**User Story:** 作为编排引擎开发者，我想要把模型一步输出施加到回合状态，以便把助手消息纳入对话并决定下一步。

#### Acceptance Criteria

1. THE Agent_Turn_Reducer SHALL 提供纯函数 `applyModelResponse(state, response)`，返回一个 Turn_Result。
2. IF `applyModelResponse` 在 Turn_Status 不为 `awaiting_model` 的 state 上被调用，THEN THE Agent_Turn_Reducer SHALL 返回一个失败 Turn_Result，其 TurnError 的 TurnErrorCode 为 `TURN_INVALID_STATE`，并定位当前 Turn_Status。
3. IF `applyModelResponse` 被调用且 `response` 的 Message_Id 已存在于 state 的 Transcript，THEN THE Agent_Turn_Reducer SHALL 返回一个失败 Turn_Result，其 TurnError 的 TurnErrorCode 为 `TURN_DUPLICATE_MESSAGE_ID`，并定位该 Message_Id。
4. WHEN `applyModelResponse` 在 awaiting_model 状态下成功且 `response` 的 Tool_Call_List 非空，THE Agent_Turn_Reducer SHALL 把一条 Role 为 `assistant` 的 Message（含可选文本片段与各工具调用片段）追加到 Transcript 末尾，使新状态的 Turn_Status 为 `awaiting_tools`，且 Pending_Call_Ids 等于 Tool_Call_List 中各 Call_Id（保持顺序、去重）。
5. WHEN `applyModelResponse` 在 awaiting_model 状态下成功且 `response` 的 Tool_Call_List 为空，THE Agent_Turn_Reducer SHALL 把一条 Role 为 `assistant` 的 Message 追加到 Transcript 末尾，使新状态的 Turn_Status 为 `completed` 且 Pending_Call_Ids 为空。
6. WHEN `applyModelResponse` 成功，THE Agent_Turn_Reducer SHALL 使新状态的 Transcript 较输入恰好多出一条消息，且输入 state 保持不变。
7. FOR ALL `state` 与 `response`，THE Agent_Turn_Reducer SHALL 对相同输入返回相同的 Turn_Result（确定性）。

### Requirement 5: 施加工具结果 (applyToolResults)

**User Story:** 作为编排引擎开发者，我想要把工具结果施加到回合状态，以便把工具输出纳入对话并继续推进。

#### Acceptance Criteria

1. THE Agent_Turn_Reducer SHALL 提供纯函数 `applyToolResults(state, outcomes)`，返回一个 Turn_Result。
2. IF `applyToolResults` 在 Turn_Status 不为 `awaiting_tools` 的 state 上被调用，THEN THE Agent_Turn_Reducer SHALL 返回一个失败 Turn_Result，其 TurnError 的 TurnErrorCode 为 `TURN_INVALID_STATE`，并定位当前 Turn_Status。
3. IF `outcomes` 含一个 Call_Id 不在 state 的 Pending_Call_Ids 中的 Tool_Outcome，THEN THE Agent_Turn_Reducer SHALL 返回一个失败 Turn_Result，其 TurnError 的 TurnErrorCode 为 `TURN_UNKNOWN_CALL_ID`，并定位该 Call_Id。
4. WHEN `applyToolResults` 成功，THE Agent_Turn_Reducer SHALL 把一条 Role 为 `tool` 的 Message（含每个 Tool_Outcome 对应的工具结果片段，保持 `outcomes` 顺序）追加到 Transcript 末尾，并从 Pending_Call_Ids 移除 `outcomes` 中出现的全部 Call_Id。
5. WHEN `applyToolResults` 成功且移除后 Pending_Call_Ids 变为空，THE Agent_Turn_Reducer SHALL 使新状态的 Turn_Status 为 `awaiting_model`。
6. WHEN `applyToolResults` 成功且移除后 Pending_Call_Ids 仍非空，THE Agent_Turn_Reducer SHALL 使新状态的 Turn_Status 保持为 `awaiting_tools`。
7. WHEN `applyToolResults` 成功，THE Agent_Turn_Reducer SHALL 使输入 state 保持不变，且新状态的 Pending_Call_Ids 为输入 Pending_Call_Ids 去除 `outcomes` 中 Call_Id 后的子序列（保持相对顺序）。
8. FOR ALL `state` 与 `outcomes`，THE Agent_Turn_Reducer SHALL 对相同输入返回相同的 Turn_Result（确定性）。

### Requirement 6: 错误码枚举与跨层互斥

**User Story:** 作为编排引擎开发者，我想要所有错误携带稳定且与前序各层互不冲突的错误码，以便跨层聚合并程序化区分错误来源。

#### Acceptance Criteria

1. THE Agent_Turn_Reducer SHALL 使每条 TurnError 携带一个取值于 TurnErrorCode 枚举的稳定错误码，且该枚举至少包含 `TURN_INVALID_STATE`、`TURN_DUPLICATE_MESSAGE_ID`、`TURN_UNKNOWN_CALL_ID`。
2. THE Agent_Turn_Reducer SHALL 使 TurnErrorCode 的取值集合与前序子规格的 `ErrorCode`（workflow-graph-model）取值集合不相交。
3. THE Agent_Turn_Reducer SHALL 使 TurnErrorCode 的取值集合与前序子规格的 `Config_Error_Code`（workflow-node-types）取值集合不相交。
4. THE Agent_Turn_Reducer SHALL 使 TurnErrorCode 的取值集合与前序子规格的 `Executor_Error_Code`（workflow-execution-engine）取值集合不相交。
5. THE Agent_Turn_Reducer SHALL 使 TurnErrorCode 的取值集合与前序子规格的 `AgentErrorCode`（agent-definition-registry）取值集合不相交。
6. THE Agent_Turn_Reducer SHALL 使 TurnErrorCode 的取值集合与前序子规格的 `ToolErrorCode`（agent-tool-system）取值集合不相交。
7. THE Agent_Turn_Reducer SHALL 使 TurnErrorCode 的取值集合与前序子规格的 `ResolutionErrorCode`（agent-tool-resolution）取值集合不相交。
8. THE Agent_Turn_Reducer SHALL 使 TurnErrorCode 的取值集合与前序子规格的 `MessageErrorCode`（agent-message-protocol）取值集合不相交。
9. THE Agent_Turn_Reducer SHALL 使 TurnErrorCode 的取值集合与前序子规格的 `AssemblyErrorCode`（agent-conversation-assembly）取值集合不相交。
10. THE Agent_Turn_Reducer SHALL 使每条 TurnError 携带一条人类可读的描述字符串，并在与某具体 Call_Id、Message_Id 或状态名相关时于其定位信息中记录该标识。

### Requirement 7: 回合推进的结构不变量

**User Story:** 作为编排引擎开发者，我想要回合推进满足明确的结构不变量，以便上层安全地依赖状态机的行为。

#### Acceptance Criteria

1. FOR ALL `state` 与成功的转换，THE Agent_Turn_Reducer SHALL 使新状态的 Transcript 包含输入 Transcript 的全部消息作为其前缀（对话记录只增不改）。
2. FOR ALL 成功的 `applyModelResponse` 或 `applyToolResults`，THE Agent_Turn_Reducer SHALL 使新状态的 Pending_Call_Ids 不含重复 Call_Id。
3. FOR ALL `state` 其 Turn_Status 为 `completed`，THE Agent_Turn_Reducer SHALL 使 `applyModelResponse(state, ·)` 与 `applyToolResults(state, ·)` 均返回失败 Turn_Result（终态不可再转换）。
4. FOR ALL 成功转换所得的新 Turn_State，THE Agent_Turn_Reducer SHALL 使其 Turn_Status 为 `awaiting_tools` 当且仅当其 Pending_Call_Ids 非空（状态与待决集合一致）。
5. FOR ALL 由 `initialTurnState` 与一串成功转换推进所得的 Turn_State，THE Agent_Turn_Reducer SHALL 使其 Transcript 在前序子规格 `validateTranscript` 下保持良构性不被本层破坏（本层仅追加合法消息，不引入重复 Message_Id）。
