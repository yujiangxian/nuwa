# Requirements Document

## Introduction

「智能体对话装配」(agent-conversation-assembly) 是女娲 Nuwa「多智能体工作流编排引擎」的**第八个子规格**。前序七个子规格分别定义了图模型、节点配置、执行引擎、智能体注册表、工具系统、跨层解析与消息协议。

本子规格的职责是定义一个**纯的库**，用于把一个「智能体定义」(AgentDefinition) 与一段「对话记录」(Transcript) **装配**为发送给语言模型的「有效消息序列」(Assembled_Message_List)——即在历史消息前置一条由智能体系统提示派生的系统消息，并按消息条数上限对历史进行确定的截断（保留系统消息与最近的消息）。实现位于 `app/web/src/lib/assembly/`。

**核心约束（关键设计原则）**：本子规格必须是**纯数据 + 纯函数**的库，**不含任何 I/O、不依赖 React、不发起任何网络访问、不调用任何语言模型**，亦不含可变全局状态、时间或随机依赖。所有错误都建模为带稳定错误码 (AssemblyErrorCode) 的 AssemblyError 值，其取值集合与前序七层的错误码取值集合互不相交。本层仅以散文/类型引用前序类型（`AgentDefinition`、`Message`、`Transcript`、`Role` 等），不重定义。

本子规格的范围限定为以下相互关联、作为整体交付的目标：

1. **系统消息派生** (`systemMessageOf`)：从一个 AgentDefinition 的 System_Prompt 纯粹地派生一条 Role 为 `system` 的 Message，其 Message_Id 由一个确定的前缀与该智能体的 Agent_Id 组合而成。
2. **装配选项** (Assembly_Options)：一个可选的最大消息条数上限 (Max_Messages)，为大于等于 1 的整数；不提供时表示不截断。
3. **消息装配** (`assembleMessages`)：把派生的系统消息置于历史消息之前，得到 Assembled_Message_List；当提供 Max_Messages 且总条数超限时，保留系统消息并保留最近的（末尾的）历史消息，丢弃较早的历史消息，使结果长度不超过 Max_Messages。
4. **历史截断** (`truncateHistory`)：对一个消息列表按 Max_Messages 确定地截断，保留末尾最近的消息。
5. **装配校验** (`validateAssembly`)：System_Prompt 长度在界内（复用智能体层约束的散文引用）、Max_Messages 为大于等于 1 的整数（若提供）；产出带稳定错误码的 AssemblyError 值。
6. **查询确定性与不可变性**：全部函数对相同输入返回相同输出，且不就地修改任何输入。

本子规格仅产出本装配层的需求与纯函数契约，**不做任何实现**。

## Glossary

- **Agent_Conversation_Assembly**: 本子规格定义的整体模块（系统消息派生/装配/截断/校验等纯函数库），位于 `app/web/src/lib/assembly/`。
- **AgentDefinition**: 前序层 (agent-definition-registry) 定义的智能体规格，含 Agent_Id 与 System_Prompt。本子规格仅以散文引用。
- **System_Prompt**: AgentDefinition 中提供给语言模型的系统提示字符串。
- **Agent_Id**: AgentDefinition 的唯一标识。
- **Message**: 前序层 (agent-message-protocol) 定义的不可变消息，含 Message_Id、Role 与 Part_List。本子规格仅以散文引用。
- **Transcript**: 前序层 (agent-message-protocol) 定义的有序消息序列。本子规格仅以散文引用。
- **Role**: 前序层定义的消息角色，取值为 `system`、`user`、`assistant`、`tool` 之一。
- **System_Message**: 由 `systemMessageOf` 从 AgentDefinition 派生的、Role 为 `system` 的 Message。
- **System_Message_Id_Prefix**: 派生 System_Message 的 Message_Id 时使用的确定字符串前缀。
- **Assembly_Options**: 装配选项，含一个可选的 Max_Messages。
- **Max_Messages**: 装配结果允许的最大消息条数，为大于等于 1 的整数；当 Assembly_Options 不含它时表示不截断。
- **Assembled_Message_List**: `assembleMessages` 的结果，一个有序的 Message 列表，其首元素为 System_Message，其后为（可能被截断的）历史消息。
- **AssemblyError**: 单条错误值，含 AssemblyErrorCode、定位信息与人类可读描述。
- **AssemblyErrorCode**: AssemblyError 的稳定枚举标识，其取值集合与前序七层的错误码取值集合互不相交。
- **Assembly_Validation_Result**: `validateAssembly` 的结果，含布尔 `valid` 与一组 AssemblyError（valid 为真时该组为空）。
- **Listing_Order**: 确定的排序/保序规则：历史消息保持其在 Transcript 中的相对顺序。
- **Determinism**: 纯函数对相同输入恒产出相同输出的确定性性质。
- **Idempotence**: 一个操作施加一次与施加多次结果相同的幂等性质。

## Requirements

### Requirement 1: 模块范围与纯库约束

**User Story:** 作为编排引擎开发者，我想要一个不含 I/O、网络与 React 依赖、且不调用模型的纯装配库，以便其行为完全确定且可用属性测试验证。

#### Acceptance Criteria

1. THE Agent_Conversation_Assembly SHALL 仅由纯函数与不可变类型构成，不包含 I/O、网络访问、React 依赖、可变全局状态、时间或随机依赖。
2. THE Agent_Conversation_Assembly SHALL 仅以散文与类型引用前序子规格中已定义的类型（如 `AgentDefinition`、`Message`、`Transcript`、`Role`），而不重新定义它们。
3. FOR ALL Agent_Conversation_Assembly 对外暴露的函数，THE Agent_Conversation_Assembly SHALL 对相同输入返回相同输出（确定性）。
4. THE Agent_Conversation_Assembly SHALL 不就地修改任何输入的 AgentDefinition、Message、Transcript 或 Assembly_Options，所有结果均以新值返回（不可变性）。
5. THE Agent_Conversation_Assembly SHALL 不调用任何语言模型、不产生任何副作用；其全部函数均为纯数据变换或校验。

### Requirement 2: 系统消息派生 (systemMessageOf)

**User Story:** 作为编排引擎开发者，我想要从一个智能体确定地派生一条系统消息，以便把智能体的系统提示作为对话的首条消息。

#### Acceptance Criteria

1. THE Agent_Conversation_Assembly SHALL 提供纯函数 `systemMessageOf(agent)`，返回一条 Role 为 `system` 的 Message。
2. WHEN `systemMessageOf(agent)` 被调用，THE Agent_Conversation_Assembly SHALL 使所返回 Message 的 Part_List 恰含一个文本片段，其文本等于 `agent` 的 System_Prompt。
3. WHEN `systemMessageOf(agent)` 被调用，THE Agent_Conversation_Assembly SHALL 使所返回 Message 的 Message_Id 等于 System_Message_Id_Prefix 与 `agent` 的 Agent_Id 的确定组合。
4. FOR ALL `agent`，THE Agent_Conversation_Assembly SHALL 对相同输入返回相等的 System_Message（派生确定性）。

### Requirement 3: 装配选项 (Assembly_Options)

**User Story:** 作为编排引擎开发者，我想要明确的装配选项，以便控制是否以及如何截断历史。

#### Acceptance Criteria

1. THE Agent_Conversation_Assembly SHALL 将 Assembly_Options 定义为含一个可选 Max_Messages 字段的不可变结构。
2. THE Agent_Conversation_Assembly SHALL 将 Max_Messages 的合法取值定义为大于等于 1 的整数。
3. WHEN Assembly_Options 不含 Max_Messages，THE Agent_Conversation_Assembly SHALL 视其为不截断（保留全部消息）。

### Requirement 4: 消息装配 (assembleMessages)

**User Story:** 作为编排引擎开发者，我想要把系统消息与历史装配为发送给模型的有效消息序列，以便统一构造模型输入。

#### Acceptance Criteria

1. THE Agent_Conversation_Assembly SHALL 提供纯函数 `assembleMessages(agent, transcript, options)`，返回一个 Assembled_Message_List。
2. WHEN `assembleMessages` 被调用，THE Agent_Conversation_Assembly SHALL 使所返回列表的首元素为 `systemMessageOf(agent)` 所派生的 System_Message。
3. WHEN Assembly_Options 不含 Max_Messages 或总消息条数不超过 Max_Messages，THE Agent_Conversation_Assembly SHALL 使所返回列表为 System_Message 后接 `transcript` 的全部消息，且历史消息保持其在 `transcript` 中的相对顺序。
4. IF Assembly_Options 含 Max_Messages 且 System_Message 与 `transcript` 全部消息的总条数超过 Max_Messages，THEN THE Agent_Conversation_Assembly SHALL 保留 System_Message 并仅保留最近的（末尾的）若干历史消息，使所返回列表长度恰等于 Max_Messages，且被保留的历史消息保持其相对顺序。
5. FOR ALL `agent`、`transcript` 与 `options`，THE Agent_Conversation_Assembly SHALL 使所返回列表长度在提供 Max_Messages 时不超过 Max_Messages，在未提供时等于 1 加 `transcript` 的消息条数。
6. FOR ALL `agent`、`transcript` 与 `options`，THE Agent_Conversation_Assembly SHALL 对相同输入返回逐元素相同的 Assembled_Message_List（装配确定性）。

### Requirement 5: 历史截断 (truncateHistory)

**User Story:** 作为编排引擎开发者，我想要一个确定的历史截断函数，以便在不同上下文复用最近优先的截断策略。

#### Acceptance Criteria

1. THE Agent_Conversation_Assembly SHALL 提供纯函数 `truncateHistory(messages, maxMessages)`，返回一个消息列表。
2. WHEN `messages` 的长度不超过 `maxMessages`，THE Agent_Conversation_Assembly SHALL 返回与 `messages` 逐元素相同的列表（不截断）。
3. IF `messages` 的长度超过 `maxMessages`，THEN THE Agent_Conversation_Assembly SHALL 返回 `messages` 末尾的 `maxMessages` 条消息，且保持其相对顺序（保留最近）。
4. FOR ALL `messages` 与 `maxMessages` 大于等于 1，THE Agent_Conversation_Assembly SHALL 使 `truncateHistory(messages, maxMessages)` 的长度等于 `messages` 长度与 `maxMessages` 的较小者。
5. FOR ALL `messages` 与 `maxMessages`，THE Agent_Conversation_Assembly SHALL 使 `truncateHistory` 返回的每条消息均为 `messages` 中的消息且为其一个后缀（截断结果是原列表的后缀）。

### Requirement 6: 装配校验 (validateAssembly)

**User Story:** 作为编排引擎开发者，我想要 `validateAssembly` 报告装配输入的违规，以便在装配前发现配置错误。

#### Acceptance Criteria

1. THE Agent_Conversation_Assembly SHALL 提供纯函数 `validateAssembly(agent, options)`，返回一个 Assembly_Validation_Result。
2. IF `agent` 的 System_Prompt 字符长度超过智能体层约定的 System_Prompt 最大长度，THEN THE Agent_Conversation_Assembly SHALL 产出一条 AssemblyErrorCode 为 `ASSEMBLY_SYSTEM_PROMPT_TOO_LONG` 的 AssemblyError，并定位字段名 `systemPrompt`。
3. IF Assembly_Options 含一个不是大于等于 1 的整数的 Max_Messages，THEN THE Agent_Conversation_Assembly SHALL 产出一条 AssemblyErrorCode 为 `ASSEMBLY_MAX_MESSAGES_INVALID` 的 AssemblyError，并定位字段名 `maxMessages`。
4. WHEN `agent` 与 `options` 不违反任何校验规则，THE Agent_Conversation_Assembly SHALL 返回 `valid` 为真且 AssemblyError 组为空的 Assembly_Validation_Result。
5. WHEN `agent` 与 `options` 违反一条或多条校验规则，THE Agent_Conversation_Assembly SHALL 在单次校验中报告全部被违反规则对应的 AssemblyError，而非在首条错误处停止，并以确定且稳定的顺序排列这些 AssemblyError。
6. FOR ALL `agent` 与 `options`，THE Agent_Conversation_Assembly SHALL 对相同输入返回相同的 Assembly_Validation_Result（校验确定性）。

### Requirement 7: 错误码枚举与跨层互斥

**User Story:** 作为编排引擎开发者，我想要所有错误携带稳定且与前序各层互不冲突的错误码，以便跨层聚合并程序化区分错误来源。

#### Acceptance Criteria

1. THE Agent_Conversation_Assembly SHALL 使每条 AssemblyError 携带一个取值于 AssemblyErrorCode 枚举的稳定错误码，且该枚举至少包含 `ASSEMBLY_SYSTEM_PROMPT_TOO_LONG`、`ASSEMBLY_MAX_MESSAGES_INVALID`。
2. THE Agent_Conversation_Assembly SHALL 使 AssemblyErrorCode 的取值集合与前序子规格的 `ErrorCode`（workflow-graph-model）取值集合不相交。
3. THE Agent_Conversation_Assembly SHALL 使 AssemblyErrorCode 的取值集合与前序子规格的 `Config_Error_Code`（workflow-node-types）取值集合不相交。
4. THE Agent_Conversation_Assembly SHALL 使 AssemblyErrorCode 的取值集合与前序子规格的 `Executor_Error_Code`（workflow-execution-engine）取值集合不相交。
5. THE Agent_Conversation_Assembly SHALL 使 AssemblyErrorCode 的取值集合与前序子规格的 `AgentErrorCode`（agent-definition-registry）取值集合不相交。
6. THE Agent_Conversation_Assembly SHALL 使 AssemblyErrorCode 的取值集合与前序子规格的 `ToolErrorCode`（agent-tool-system）取值集合不相交。
7. THE Agent_Conversation_Assembly SHALL 使 AssemblyErrorCode 的取值集合与前序子规格的 `ResolutionErrorCode`（agent-tool-resolution）取值集合不相交。
8. THE Agent_Conversation_Assembly SHALL 使 AssemblyErrorCode 的取值集合与前序子规格的 `MessageErrorCode`（agent-message-protocol）取值集合不相交。
9. THE Agent_Conversation_Assembly SHALL 使每条 AssemblyError 携带一条人类可读的描述字符串，并在与某具体字段名相关时于其定位信息中记录该字段名。

### Requirement 8: 装配的结构不变量

**User Story:** 作为编排引擎开发者，我想要装配结果满足明确的结构不变量，以便上层安全地依赖其形状。

#### Acceptance Criteria

1. FOR ALL `agent`、`transcript` 与 `options`，THE Agent_Conversation_Assembly SHALL 使 `assembleMessages` 所返回列表非空，且其首元素的 Role 为 `system`。
2. FOR ALL `agent`、`transcript` 与 `options`，THE Agent_Conversation_Assembly SHALL 使 `assembleMessages` 所返回列表中，除首元素外的每条消息均为 `transcript` 中的消息（装配不引入历史以外的消息）。
3. FOR ALL `agent`、`transcript` 与 Max_Messages 大于等于 1，THE Agent_Conversation_Assembly SHALL 使 `assembleMessages` 所返回列表中，除首元素外的历史消息恰为 `transcript` 消息序列的一个后缀（保留最近的历史）。
4. FOR ALL `agent` 与 `transcript`，WHEN Max_Messages 等于 1，THE Agent_Conversation_Assembly SHALL 使 `assembleMessages` 所返回列表恰为单个 System_Message（上限为 1 时仅保留系统消息）。
