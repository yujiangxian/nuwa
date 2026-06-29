# Requirements Document

## Introduction

「智能体消息协议」(agent-message-protocol) 是女娲 Nuwa「多智能体工作流编排引擎」的**第七个子规格**。前序六个子规格（workflow-graph-model、workflow-node-types、workflow-execution-engine、agent-definition-registry、agent-tool-system、agent-tool-resolution）分别定义了图模型、节点配置、执行引擎、智能体注册表、工具系统与跨层解析。

本子规格的职责是定义一个**纯的库**，用于声明与管理「对话消息」(Message) 与「对话记录」(Transcript)——即多智能体协作中智能体之间、以及智能体与工具之间交换的、不可变、带类型的消息序列。实现位于 `app/web/src/lib/messages/`。

**核心约束（关键设计原则）**：本子规格必须是**纯数据 + 纯函数**的库，**不含任何 I/O、不依赖 React、不发起任何网络访问、不调用任何语言模型或工具**，亦不含可变全局状态、时间或随机依赖。Transcript 是**不可变序列**：一切写操作（追加、替换）都返回**新的对话记录**而绝不就地修改既有记录。所有错误都建模为带稳定错误码 (MessageErrorCode) 的 MessageError 值，其取值集合与前序六层的错误码取值集合互不相交。本层不重定义前序类型，仅以散文引用。

本子规格的范围限定为以下相互关联、作为整体交付的目标：

1. **Role 数据模型**：消息发出方角色，取值为 `system`、`user`、`assistant`、`tool` 之一。
2. **ContentPart 数据模型**：消息内容片段的可辨识联合——文本片段 (Text_Part)、工具调用片段 (Tool_Call_Part，含 Call_Id、Tool_Name、序列化的参数 JSON)、工具结果片段 (Tool_Result_Part，含 Call_Id 与序列化的结果 JSON)。
3. **Message 数据模型**：一条不可变消息，含 Message_Id、Role 与一个非空的 ContentPart 有序列表。
4. **Transcript 不可变序列**：一个有序的 Message 列表，提供 `emptyTranscript`、`appendMessage`、`replaceMessage`、`messageCount`、`getMessage` 等纯操作，写操作均返回新记录。
5. **校验** (`validateMessage` / `validateTranscript`)：Message_Id 非空且在 Transcript 内唯一；ContentPart 列表非空；Tool_Call_Part 的 Call_Id 非空且 Tool_Name 非空；Tool_Result_Part 的 Call_Id 非空；Transcript 内每个 Tool_Result_Part 的 Call_Id 必须匹配一个更早出现的 Tool_Call_Part 的 Call_Id；Call_Id 在 Transcript 内不重复（每个工具调用唯一）；产出带稳定错误码的 MessageError 值。
6. **规范化** (`normalizeMessage`)：将 Message 转换为规范形式（保持片段顺序，规范化内部 JSON 表示），幂等且对语义等价唯一。
7. **序列化** (`serializeTranscript` / `deserializeTranscript`)：规范化 JSON 往返恒等、规范形式唯一、对畸形输入产出错误。
8. **查询与派生**：按 Role 过滤、取末条消息、列举全部工具调用 (Tool_Call_Part) 与按 Call_Id 配对工具结果。

本子规格仅产出本消息协议层的需求与纯函数契约，**不做任何实现**。

## Glossary

- **Agent_Message_Protocol**: 本子规格定义的整体模块（Message/Transcript 纯数据模型 + 校验/规范化/序列化/查询等纯函数库），位于 `app/web/src/lib/messages/`。
- **Role**: 一条 Message 的发出方角色，取值为 `system`、`user`、`assistant`、`tool` 四者之一。
- **ContentPart**: 一条 Message 的内容片段，为 Text_Part、Tool_Call_Part 或 Tool_Result_Part 之一的可辨识联合。
- **Text_Part**: 一个携带文本字符串 (Text) 的 ContentPart。
- **Tool_Call_Part**: 一个表示发起工具调用的 ContentPart，携带 Call_Id、Tool_Name 与序列化的参数表示 (Arguments_Json)。
- **Tool_Result_Part**: 一个表示工具调用结果的 ContentPart，携带 Call_Id 与序列化的结果表示 (Result_Json)。
- **Call_Id**: 标识一次工具调用的非空字符串，用于把 Tool_Result_Part 关联到其对应的 Tool_Call_Part。
- **Tool_Name**: Tool_Call_Part 中所调用工具的非空字符串名称。
- **Arguments_Json**: Tool_Call_Part 中工具参数的字符串化 JSON 表示。
- **Result_Json**: Tool_Result_Part 中工具结果的字符串化 JSON 表示。
- **Text**: Text_Part 中的文本字符串内容（可为空字符串）。
- **Message**: 一条不可变消息，由 Message_Id、Role 与一个非空的 ContentPart 有序列表 (Part_List) 组成。
- **Message_Id**: 一条 Message 的标识，为非空字符串，在一个 Transcript 内唯一。
- **Part_List**: 一条 Message 的 ContentPart 有序列表，非空。
- **Transcript**: 一个有序的、不可变的 Message 序列，表示一段对话记录。
- **Transcript_Result**: Transcript 写操作 (`appendMessage`/`replaceMessage`) 的返回，或为成功（携带新 Transcript），或为失败（携带一个 MessageError）。
- **MessageError**: 单条错误值，含 MessageErrorCode、定位信息（涉及的 Message_Id / Call_Id / 字段名 / 片段序号等）与人类可读描述。
- **MessageErrorCode**: MessageError 的稳定枚举标识，其取值集合与前序六层的错误码取值集合互不相交。
- **Message_Validation_Result**: `validateMessage` 的结果，含布尔 `valid` 与一组 MessageError（valid 为真时该组为空）。
- **Transcript_Validation_Result**: `validateTranscript` 的结果，含布尔 `valid` 与一组 MessageError（valid 为真时该组为空）。
- **Canonical_Message**: Message 的规范形式，其内部 JSON 表示已规范化，使语义等价的 Message 具有唯一表示。
- **Canonical_Transcript**: Transcript 的规范形式，其全部 Message 均为 Canonical_Message，消息顺序保持不变。
- **Transcript_Json**: Transcript 的规范化 JSON 表示，键顺序确定，使语义相等的对话记录序列化输出唯一。
- **Tool_Call_Pairing**: Transcript 内 Tool_Result_Part 与其同 Call_Id 的更早 Tool_Call_Part 之间的配对关系。
- **Determinism**: 纯函数对相同输入恒产出相同输出的确定性性质。
- **Idempotence**: 一个操作施加一次与施加多次结果相同的幂等性质。
- **Round_Trip**: 一个操作与其逆操作复合后回到等价起点的往返性质。

## Requirements

### Requirement 1: 模块范围与纯库约束

**User Story:** 作为编排引擎开发者，我想要一个不含 I/O、网络与 React 依赖、且不调用模型或工具的纯消息协议库，以便其行为完全确定且可用属性测试验证。

#### Acceptance Criteria

1. THE Agent_Message_Protocol SHALL 仅由纯函数与不可变类型构成，不包含 I/O、网络访问、React 依赖、可变全局状态、时间或随机依赖。
2. THE Agent_Message_Protocol SHALL 仅以散文引用前序子规格中已定义的类型，而不重新定义它们。
3. FOR ALL Agent_Message_Protocol 对外暴露的函数，THE Agent_Message_Protocol SHALL 对相同输入返回相同输出（确定性）。
4. THE Agent_Message_Protocol SHALL 不就地修改任何输入的 Message 或 Transcript，所有变更结果均以新值返回（不可变性）。
5. THE Agent_Message_Protocol SHALL 不调用任何语言模型或工具、不产生任何副作用；其全部函数均为纯数据变换或校验。

### Requirement 2: Role 与 ContentPart 数据模型

**User Story:** 作为编排引擎开发者，我想要明确的角色与内容片段类型，以便统一表达文本、工具调用与工具结果。

#### Acceptance Criteria

1. THE Agent_Message_Protocol SHALL 将 Role 定义为取值于 `system`、`user`、`assistant`、`tool` 的枚举。
2. THE Agent_Message_Protocol SHALL 将 ContentPart 定义为 Text_Part、Tool_Call_Part 与 Tool_Result_Part 三个分支的可辨识联合，各分支以一个判别标签区分。
3. THE Agent_Message_Protocol SHALL 将 Text_Part 定义为携带一个字符串 Text 的不可变结构。
4. THE Agent_Message_Protocol SHALL 将 Tool_Call_Part 定义为携带 Call_Id、Tool_Name 与 Arguments_Json 的不可变结构。
5. THE Agent_Message_Protocol SHALL 将 Tool_Result_Part 定义为携带 Call_Id 与 Result_Json 的不可变结构。

### Requirement 3: Message 数据模型

**User Story:** 作为编排引擎开发者，我想要一个带类型、不可变的 Message 结构，以便统一表达一条对话消息。

#### Acceptance Criteria

1. THE Agent_Message_Protocol SHALL 将 Message 定义为由 Message_Id、Role 与一个 Part_List 组成的不可变结构。
2. THE Agent_Message_Protocol SHALL 将 Part_List 定义为 ContentPart 的有序列表。
3. THE Agent_Message_Protocol SHALL 使 Message 的判等基于其全部字段的语义内容，而不基于引用标识。

### Requirement 4: Transcript 不可变序列结构

**User Story:** 作为编排引擎开发者，我想要一个有序、不可变的消息序列，以便集中管理一段对话并保证写操作不改动既有记录。

#### Acceptance Criteria

1. THE Agent_Message_Protocol SHALL 将 Transcript 定义为一个不可变的、有序的 Message 列表。
2. THE Agent_Message_Protocol SHALL 提供纯函数 `emptyTranscript()`，返回一个不含任何 Message 的空 Transcript。
3. THE Agent_Message_Protocol SHALL 提供纯函数 `messageCount(transcript)`，返回该 Transcript 中 Message 的数量。
4. FOR ALL Transcript 写操作，THE Agent_Message_Protocol SHALL 返回一个新的 Transcript，且作为输入的原 Transcript 在操作后保持不变（不可变写）。
5. THE Agent_Message_Protocol SHALL 提供纯函数 `getMessage(transcript, messageId)`，WHEN messageId 存在则返回该 Message，IF 不存在 THEN 返回不存在 (空) 值，而不抛出异常。

### Requirement 5: 追加消息 (appendMessage)

**User Story:** 作为编排引擎开发者，我想要向对话记录末尾追加消息并在 id 重复时得到明确错误，以便安全地扩展对话。

#### Acceptance Criteria

1. THE Agent_Message_Protocol SHALL 提供纯函数 `appendMessage(transcript, message)`，返回一个 Transcript_Result。
2. WHEN `appendMessage(transcript, message)` 被调用且 message 的 Message_Id 不存在于 transcript，THE Agent_Message_Protocol SHALL 返回一个成功 Transcript_Result，其携带的新 Transcript 在原序列末尾恰好多出 message 一条，且其余消息顺序不变。
3. IF `appendMessage(transcript, message)` 被调用且 message 的 Message_Id 已存在于 transcript，THEN THE Agent_Message_Protocol SHALL 返回一个失败 Transcript_Result，其携带的 MessageError 的 MessageErrorCode 为 `MESSAGE_DUPLICATE_ID`，并定位该 Message_Id。
4. WHEN `appendMessage` 返回失败，THE Agent_Message_Protocol SHALL 使 transcript 保持不变。
5. WHEN `appendMessage` 成功，THE Agent_Message_Protocol SHALL 使所得新 Transcript 的 `messageCount` 等于 `messageCount(transcript)` 加 1。

### Requirement 6: 替换消息 (replaceMessage)

**User Story:** 作为编排引擎开发者，我想要按 id 替换对话记录中一条既有消息并在不存在时得到明确错误，以便修正消息而不改变其位置。

#### Acceptance Criteria

1. THE Agent_Message_Protocol SHALL 提供纯函数 `replaceMessage(transcript, message)`，返回一个 Transcript_Result。
2. WHEN `replaceMessage(transcript, message)` 被调用且 message 的 Message_Id 存在于 transcript，THE Agent_Message_Protocol SHALL 返回一个成功 Transcript_Result，其携带的新 Transcript 在该 Message_Id 所处位置的 Message 等于 message，其余位置的消息不变。
3. IF `replaceMessage(transcript, message)` 被调用且 message 的 Message_Id 不存在于 transcript，THEN THE Agent_Message_Protocol SHALL 返回一个失败 Transcript_Result，其携带的 MessageError 的 MessageErrorCode 为 `MESSAGE_NOT_FOUND`，并定位该 Message_Id。
4. WHEN `replaceMessage` 成功，THE Agent_Message_Protocol SHALL 使所得新 Transcript 的消息数量与消息顺序（按 Message_Id）与 transcript 相同（替换保持序列结构不变）。

### Requirement 7: 单条消息校验 (validateMessage)

**User Story:** 作为编排引擎开发者，我想要 `validateMessage` 完整且确定地报告一条消息的全部违规，以便上层稳定地处置校验错误。

#### Acceptance Criteria

1. THE Agent_Message_Protocol SHALL 提供纯函数 `validateMessage(message)`，输入一个 Message，输出一个 Message_Validation_Result。
2. IF 一条 Message 的 Message_Id 为空字符串，THEN THE Agent_Message_Protocol SHALL 产出一条 MessageErrorCode 为 `MESSAGE_EMPTY_ID` 的 MessageError，并定位字段名 `id`。
3. IF 一条 Message 的 Part_List 为空，THEN THE Agent_Message_Protocol SHALL 产出一条 MessageErrorCode 为 `MESSAGE_EMPTY_PARTS` 的 MessageError，并定位字段名 `parts`。
4. IF 一条 Message 含一个 Call_Id 为空字符串的 Tool_Call_Part 或 Tool_Result_Part，THEN THE Agent_Message_Protocol SHALL 产出一条 MessageErrorCode 为 `MESSAGE_EMPTY_CALL_ID` 的 MessageError，并定位该片段序号。
5. IF 一条 Message 含一个 Tool_Name 为空字符串的 Tool_Call_Part，THEN THE Agent_Message_Protocol SHALL 产出一条 MessageErrorCode 为 `MESSAGE_EMPTY_TOOL_NAME` 的 MessageError，并定位该片段序号。
6. WHEN 一条 Message 不违反任何校验规则，THE Agent_Message_Protocol SHALL 返回 `valid` 为真且 MessageError 组为空的 Message_Validation_Result。
7. WHEN 一条 Message 违反一条或多条校验规则，THE Agent_Message_Protocol SHALL 在单次校验中报告全部被违反规则对应的 MessageError，而非在首条错误处停止，并以确定且稳定的顺序排列这些 MessageError。
8. FOR ALL Message `m`，THE Agent_Message_Protocol SHALL 对相同输入返回相同的 Message_Validation_Result（校验确定性）。

### Requirement 8: 对话记录校验 (validateTranscript)

**User Story:** 作为编排引擎开发者，我想要 `validateTranscript` 在校验每条消息的同时核对全局 id 唯一性与工具调用配对，以便整段对话既逐条合法又全局自洽。

#### Acceptance Criteria

1. THE Agent_Message_Protocol SHALL 提供纯函数 `validateTranscript(transcript)`，输入一个 Transcript，输出一个 Transcript_Validation_Result。
2. WHEN `validateTranscript` 校验一个 Transcript，THE Agent_Message_Protocol SHALL 对其每条 Message 施加 `validateMessage` 的全部校验规则，并汇集所产出的全部 MessageError。
3. IF 一个 Transcript 中存在两条或更多 Message 持有相同的 Message_Id，THEN THE Agent_Message_Protocol SHALL 产出一条 MessageErrorCode 为 `MESSAGE_DUPLICATE_ID` 的 MessageError，并定位该重复的 Message_Id。
4. IF 一个 Transcript 中存在一个 Tool_Result_Part，其 Call_Id 不等于任何在它**之前**出现的 Tool_Call_Part 的 Call_Id，THEN THE Agent_Message_Protocol SHALL 产出一条 MessageErrorCode 为 `MESSAGE_UNPAIRED_TOOL_RESULT` 的 MessageError，并定位该 Call_Id。
5. IF 一个 Transcript 中存在两个或更多 Tool_Call_Part 持有相同的 Call_Id，THEN THE Agent_Message_Protocol SHALL 产出一条 MessageErrorCode 为 `MESSAGE_DUPLICATE_CALL_ID` 的 MessageError，并定位该重复的 Call_Id。
6. WHEN 一个 Transcript 的全部 Message 均通过 `validateMessage`、无重复 Message_Id、无重复 Call_Id 且每个 Tool_Result_Part 均有更早的同 Call_Id 的 Tool_Call_Part，THE Agent_Message_Protocol SHALL 返回 `valid` 为真且 MessageError 组为空的 Transcript_Validation_Result。
7. THE Agent_Message_Protocol SHALL 以确定且稳定的顺序排列 Transcript_Validation_Result 中的 MessageError，并对相同输入返回相同结果。

### Requirement 9: 错误码枚举与跨层互斥

**User Story:** 作为编排引擎开发者，我想要所有错误携带稳定且与前序各层互不冲突的错误码，以便跨层聚合并程序化区分错误来源。

#### Acceptance Criteria

1. THE Agent_Message_Protocol SHALL 使每条 MessageError 携带一个取值于 MessageErrorCode 枚举的稳定错误码，且该枚举至少包含 `MESSAGE_DUPLICATE_ID`、`MESSAGE_NOT_FOUND`、`MESSAGE_EMPTY_ID`、`MESSAGE_EMPTY_PARTS`、`MESSAGE_EMPTY_CALL_ID`、`MESSAGE_EMPTY_TOOL_NAME`、`MESSAGE_UNPAIRED_TOOL_RESULT`、`MESSAGE_DUPLICATE_CALL_ID`、`MESSAGE_MALFORMED_JSON`。
2. THE Agent_Message_Protocol SHALL 使 MessageErrorCode 的取值集合与前序子规格的 `ErrorCode`（workflow-graph-model）取值集合不相交。
3. THE Agent_Message_Protocol SHALL 使 MessageErrorCode 的取值集合与前序子规格的 `Config_Error_Code`（workflow-node-types）取值集合不相交。
4. THE Agent_Message_Protocol SHALL 使 MessageErrorCode 的取值集合与前序子规格的 `Executor_Error_Code`（workflow-execution-engine）取值集合不相交。
5. THE Agent_Message_Protocol SHALL 使 MessageErrorCode 的取值集合与前序子规格的 `AgentErrorCode`（agent-definition-registry）取值集合不相交。
6. THE Agent_Message_Protocol SHALL 使 MessageErrorCode 的取值集合与前序子规格的 `ToolErrorCode`（agent-tool-system）取值集合不相交。
7. THE Agent_Message_Protocol SHALL 使 MessageErrorCode 的取值集合与前序子规格的 `ResolutionErrorCode`（agent-tool-resolution）取值集合不相交。
8. THE Agent_Message_Protocol SHALL 使每条 MessageError 携带一条人类可读的描述字符串，并在与某具体 Message_Id、Call_Id、字段名或片段序号相关时于其定位信息中记录该标识。

### Requirement 10: 规范化 (normalizeMessage)

**User Story:** 作为编排引擎开发者，我想要每条消息有唯一的规范形式，以便消息可被稳定地比较、去重与存储。

#### Acceptance Criteria

1. THE Agent_Message_Protocol SHALL 提供纯函数 `normalizeMessage(message)`，将一条 Message 转换为其 Canonical_Message 形式。
2. WHEN `normalizeMessage` 规范化一条 Message，THE Agent_Message_Protocol SHALL 把其 Tool_Call_Part 的 Arguments_Json 与 Tool_Result_Part 的 Result_Json 规范化为其等价的规范 JSON 字符串表示（键序确定），并保持 Part_List 的顺序不变。
3. FOR ALL Message `m`，THE Agent_Message_Protocol SHALL 使 `normalizeMessage(normalizeMessage(m))` 等于 `normalizeMessage(m)`（规范化幂等性）。
4. FOR ALL 两个语义等价（除内部 JSON 的键序/空白外字段内容相同）的 Message，THE Agent_Message_Protocol SHALL 使 `normalizeMessage` 对二者产出相等的 Canonical_Message（规范形式唯一）。
5. FOR ALL Message `m`，WHEN `m` 已为 Canonical_Message 形式，THE Agent_Message_Protocol SHALL 使 `normalizeMessage(m)` 等于 `m`（规范形式为规范化的不动点）。
6. THE Agent_Message_Protocol SHALL 使 `normalizeMessage` 保持 Message 的 Message_Id、Role、Part_List 长度与各片段的判别标签、Call_Id、Tool_Name、Text 在语义上不变（规范化不改变这些字段的语义内容）。

### Requirement 11: 序列化与往返恒等 (serializeTranscript / deserializeTranscript)

**User Story:** 作为编排引擎开发者，我想要对话记录的规范化 JSON 序列化与可靠反序列化，以便对话可被存储、传输并无损还原。

#### Acceptance Criteria

1. THE Agent_Message_Protocol SHALL 提供纯函数 `serializeTranscript(transcript)`，将任意 Transcript 渲染为 Transcript_Json 字符串。
2. THE Agent_Message_Protocol SHALL 提供纯函数 `deserializeTranscript(json)`，将一个合法的 Transcript_Json 字符串还原为 Transcript。
3. FOR ALL Transcript `t`，THE Agent_Message_Protocol SHALL 使 `deserializeTranscript(serializeTranscript(t))` 得到与规范化后的 `t`（每条 Message 经 `normalizeMessage`）语义相等的 Transcript（序列化往返恒等）。
4. FOR ALL 由 `serializeTranscript` 产出的 Transcript_Json 字符串 `j`，THE Agent_Message_Protocol SHALL 使 `serializeTranscript(deserializeTranscript(j))` 等于 `j`（规范化字符串往返恒等）。
5. FOR ALL 两个语义等价的 Transcript，THE Agent_Message_Protocol SHALL 使 `serializeTranscript` 对二者产出逐字符相同的 Transcript_Json（规范化输出唯一）。
6. IF `deserializeTranscript` 接收一个不符合 Transcript_Json 结构的字符串，THEN THE Agent_Message_Protocol SHALL 返回一个 MessageErrorCode 为 `MESSAGE_MALFORMED_JSON` 的失败结果，并指明解析失败的原因，而非产出一个 Transcript。
7. WHEN `deserializeTranscript` 成功还原一个 Transcript，THE Agent_Message_Protocol SHALL 保留每条 Message 的 Message_Id、Role、Part_List 及各片段全部组成部分与顺序。

### Requirement 12: 查询与派生 (messagesByRole / lastMessage / toolCalls / pairToolResults)

**User Story:** 作为编排引擎开发者，我想要以确定方式查询对话记录，以便上层稳定地展示与检索消息与工具调用。

#### Acceptance Criteria

1. THE Agent_Message_Protocol SHALL 提供纯函数 `messagesByRole(transcript, role)`，返回 Role 等于 `role` 的全部 Message，且保持其在 Transcript 中的相对顺序。
2. THE Agent_Message_Protocol SHALL 提供纯函数 `lastMessage(transcript)`，WHEN transcript 非空则返回其最后一条 Message，IF transcript 为空 THEN 返回不存在 (空) 值。
3. THE Agent_Message_Protocol SHALL 提供纯函数 `toolCalls(transcript)`，返回 transcript 中全部 Tool_Call_Part（连同其所属 Message_Id），且保持其在 Transcript 中的出现顺序。
4. THE Agent_Message_Protocol SHALL 提供纯函数 `pairToolResults(transcript)`，返回每个 Tool_Result_Part 与其同 Call_Id 的更早 Tool_Call_Part 之间的配对；对没有匹配 Tool_Call_Part 的 Tool_Result_Part，标记其为未配对。
5. FOR ALL Transcript `t` 与查询参数，THE Agent_Message_Protocol SHALL 对相同输入返回逐元素相同且顺序相同的结果（查询确定性）。
6. FOR ALL Transcript `t` 与 Role `role`，THE Agent_Message_Protocol SHALL 使 `messagesByRole(t, role)` 所返回的每条 Message 的 Role 均等于 `role`，且 `t` 中其余 Message 均不等于 `role`（按角色过滤的完备且精确）。
