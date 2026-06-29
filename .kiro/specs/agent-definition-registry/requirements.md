# Requirements Document

## Introduction

「智能体定义注册表」(agent-definition-registry) 是女娲 Nuwa「多智能体工作流编排引擎」(multi-agent workflow orchestration engine) 的**第四个子规格**，构建于已实现的三个前序子规格之上：

- **工作流图模型** (workflow-graph-model, 位于 `app/web/src/lib/workflow/`)：提供 `WorkflowGraph`、`WorkflowNode`、`Port`、`PortType`、`NodeType`、`Endpoint`、`Graph_Serializer` 等纯数据模型类型与纯函数，并定义了基础层的 `ErrorCode` 枚举。
- **工作流节点类型** (workflow-node-types, 位于 `app/web/src/lib/workflow/nodeTypes/`)：为六种 NodeType（`llm`、`condition`、`tool`、`transform`、`human_input`、`loop`）定义 `Typed_Node_Config` 配置 schema 与端口契约，其中 `Llm_Config` 含 `Model_Id`、`System_Prompt`、`Temperature`、`Max_Tokens` 等字段，并定义了配置层的 `Config_Error_Code` 枚举。
- **工作流执行引擎** (workflow-execution-engine, 位于 `app/web/src/lib/workflow/engine/`)：定义纯的、确定性的 reducer 风格执行状态机，并定义了执行层的 `Executor_Error_Code` 枚举。

本子规格 (agent-definition-registry) 的职责是定义一个**纯的库**，用于声明与管理「智能体定义」(AgentDefinition)——即工作流中 `llm` 节点与 `tool` 节点所引用的、可复用的 AI 智能体规格。实现位于 `app/web/src/lib/agents/`。

**核心约束（关键设计原则）**：本子规格必须是**纯数据 + 纯函数**的库，**不含任何 I/O、不依赖 React、不发起任何网络访问**，亦不含可变全局状态、时间或随机依赖。AgentRegistry 是**不可变集合**：一切写操作（添加、移除、更新）都返回**新的注册表**而绝不就地修改既有注册表。所有错误都建模为带稳定错误码 (AgentErrorCode) 的 AgentError 值，其取值集合与前序三层的错误码取值集合互不相交，便于跨层聚合区分。

本子规格的范围限定为以下相互关联、作为整体交付的目标：

1. **AgentDefinition 数据模型**：以不可变、带类型的结构描述一个智能体，含标识 (Agent_Id)、名称 (Agent_Name)、角色描述 (Agent_Role)、系统提示 (System_Prompt)、模型绑定 (ModelBinding)、工具绑定列表 (ToolBinding 列表)、可选的语音绑定 (VoiceBinding) 与标签集合 (Tag 集合)。
2. **ModelBinding 数据模型**：一个模型标识引用 (Model_Id) 加一组生成参数 (Generation_Params)：温度 (Temperature)、最大令牌数 (Max_Tokens)、核采样阈值 (Top_P)。
3. **AgentRegistry 不可变集合**：以 Agent_Id 为键的 AgentDefinition 不可变集合，提供 `addAgent`、`removeAgent`、`updateAgent`、`getAgent`、`listAgents`、`listByTag` 等纯操作，写操作均返回新注册表，并以结果类型 (Registry_Result) 表达错误（重复 id、未找到）。
4. **校验** (`validateAgent` / `validateRegistry`)：id 非空且唯一；name 非空；Temperature ∈ [0, 2]；Max_Tokens 为大于等于 1 的整数；Top_P ∈ [0, 1]；ToolBinding 无重复；System_Prompt 长度在界内；产出带稳定错误码的 AgentError 值。
5. **规范化** (`normalizeAgent`)：将 AgentDefinition 转换为规范形式（标签排序、工具绑定排序、数值参数收敛），幂等且对语义等价唯一。
6. **序列化** (`serializeRegistry` / `deserializeRegistry`)：规范化 JSON 往返恒等、规范形式唯一、对畸形输入产出错误。
7. **引用解析助手**（纯）：`resolveModelBinding(agent)` 推导模型 id 与生成参数；`bindAgentToNodeConfig(agent, nodeConfig)` 作为纯数据变换，产出工作流 `llm` 节点配置（前序子规格 `Llm_Config` 形态）的相应字段（不做执行）。
8. **查询与派生**：确定的列表顺序、标签索引 (Tag_Index)、按工具查找 (find-by-tool)。

本子规格仅产出本智能体定义层的需求与纯函数契约，**不做任何实现**。前序子规格已定义的类型（`WorkflowNode`、`Llm_Config`、`PortType`、`ErrorCode`、`Config_Error_Code`、`Executor_Error_Code` 等）在本文档中仅以散文引用，不在此重新定义。

## Glossary

- **Agent_Definition_Registry**: 本子规格定义的整体模块（AgentDefinition/AgentRegistry 纯数据模型 + 校验/规范化/序列化/引用解析/查询等纯函数库），位于 `app/web/src/lib/agents/`。
- **AgentDefinition**: 一个可复用 AI 智能体的不可变、带类型规格，由 Agent_Id、Agent_Name、Agent_Role、System_Prompt、ModelBinding、Tool_Binding_List、可空 VoiceBinding 与 Tag_Set 组成。
- **Agent_Id**: AgentDefinition 的唯一标识，为非空字符串，在一个 AgentRegistry 内唯一。
- **Agent_Name**: AgentDefinition 的人类可读名称，为非空字符串。
- **Agent_Role**: AgentDefinition 的角色描述字符串，说明该智能体的职责（可为空字符串）。
- **System_Prompt**: AgentDefinition 提供给语言模型的系统提示字符串，其字符长度不超过 System_Prompt_Max_Length。
- **System_Prompt_Max_Length**: System_Prompt 允许的最大字符长度，为一个固定的正整数上界。
- **ModelBinding**: AgentDefinition 中对语言模型的绑定，由一个 Model_Id 引用与一组 Generation_Params 组成。
- **Model_Id**: ModelBinding 中标识所引用语言模型的非空字符串。
- **Generation_Params**: ModelBinding 中的生成参数组，含 Temperature、Max_Tokens 与 Top_P 三个字段。
- **Temperature**: Generation_Params 中的采样温度数值，合法区间为闭区间 [0, 2]。
- **Max_Tokens**: Generation_Params 中允许生成的最大令牌数，为大于等于 1 的整数。
- **Top_P**: Generation_Params 中的核采样阈值数值，合法区间为闭区间 [0, 1]。
- **ToolBinding**: AgentDefinition 中声明该智能体可调用的一个工具的绑定，由一个 Tool_Id 标识。
- **Tool_Id**: ToolBinding 中标识一个可调用工具的非空字符串。
- **Tool_Binding_List**: AgentDefinition 中 ToolBinding 的有序列表，其 Tool_Id 不含重复。
- **VoiceBinding**: AgentDefinition 中对一个文本转语音 (TTS) 嗓音的可选绑定，由一个 Voice_Id 标识；可为不存在 (空)。
- **Voice_Id**: VoiceBinding 中标识一个 TTS 嗓音的非空字符串。
- **Tag**: 用于对 AgentDefinition 分类的非空字符串标签。
- **Tag_Set**: AgentDefinition 上 Tag 的集合，不含重复。
- **AgentRegistry**: 以 Agent_Id 为键的 AgentDefinition 不可变集合，提供纯查询与返回新注册表的纯写操作。
- **Registry_Result**: AgentRegistry 写操作 (`addAgent`/`removeAgent`/`updateAgent`) 的返回，或为成功（携带一个新的 AgentRegistry），或为失败（携带一个 AgentError）。
- **AgentError**: 单条错误值，含 AgentErrorCode、定位信息（涉及的 Agent_Id / 字段名 / Tool_Id 等）与人类可读描述。
- **AgentErrorCode**: AgentError 的稳定枚举标识，用于程序化区分错误类别，其取值集合与前序子规格的 `ErrorCode`、`Config_Error_Code`、`Executor_Error_Code` 取值集合互不相交。
- **Agent_Validation_Result**: `validateAgent` 的结果，含布尔 `valid` 与一组 AgentError（valid 为真时该组为空）。
- **Registry_Validation_Result**: `validateRegistry` 的结果，含布尔 `valid` 与一组 AgentError（valid 为真时该组为空）。
- **Canonical_Agent**: AgentDefinition 的规范形式，其 Tag_Set 已排序、Tool_Binding_List 已排序、Generation_Params 已收敛 (clamp)，使语义等价的 AgentDefinition 具有唯一表示。
- **Canonical_Registry**: AgentRegistry 的规范形式，其全部 AgentDefinition 均为 Canonical_Agent，且条目以 Agent_Id 排序。
- **Agent_Json**: 单个 AgentDefinition 的规范化 JSON 表示，键顺序与集合顺序确定。
- **Registry_Json**: AgentRegistry 的规范化 JSON 表示，键顺序与条目顺序确定，使语义相等的注册表序列化输出唯一。
- **Tag_Index**: 由查询助手派生的、从 Tag 到持有该 Tag 的 Agent_Id 集合的映射。
- **Listing_Order**: AgentDefinition 列表的确定排序规则：按 Agent_Id 的字典序升序。
- **Model_Binding_Resolution**: `resolveModelBinding(agent)` 的结果，携带该 AgentDefinition 的 Model_Id 与 Generation_Params。
- **Llm_Config**: 前序子规格 (workflow-node-types) 为 `llm` 节点定义的配置结构，含 `Model_Id`、`System_Prompt`、`Temperature`、`Max_Tokens` 等字段。本子规格仅以散文引用，不重新定义。
- **Node_Config_Binding_Result**: `bindAgentToNodeConfig(agent, nodeConfig)` 的结果，为一个被填充了由 AgentDefinition 推导出的相应 Llm_Config 字段的节点配置数据，纯数据变换、不含执行。
- **Round_Trip**: 一个操作与其逆操作复合后回到等价起点的往返性质。
- **Determinism**: 纯函数对相同输入恒产出相同输出的确定性性质。
- **Idempotence**: 一个操作施加一次与施加多次结果相同的幂等性质。

## Requirements

### Requirement 1: 模块范围与纯库约束

**User Story:** 作为编排引擎开发者，我想要一个不含 I/O、网络与 React 依赖的纯智能体定义库，以便其行为完全确定且可用属性测试 (property-based testing) 验证。

#### Acceptance Criteria

1. THE Agent_Definition_Registry SHALL 仅由纯函数与不可变类型构成，不包含 I/O、网络访问、React 依赖、可变全局状态、时间或随机依赖。
2. THE Agent_Definition_Registry SHALL 仅以散文引用前序子规格 (workflow-graph-model、workflow-node-types、workflow-execution-engine) 中已定义的类型（如 `WorkflowNode`、`Llm_Config`、`PortType`、`ErrorCode`、`Config_Error_Code`、`Executor_Error_Code`），而不重新定义这些类型。
3. FOR ALL Agent_Definition_Registry 对外暴露的函数，THE Agent_Definition_Registry SHALL 对相同输入返回相同输出（确定性）。
4. THE Agent_Definition_Registry SHALL 不就地修改任何输入的 AgentDefinition 或 AgentRegistry，所有变更结果均以新值返回（不可变性）。

### Requirement 2: AgentDefinition 数据模型

**User Story:** 作为编排引擎开发者，我想要一个带类型、不可变的 AgentDefinition 结构，以便统一地声明可复用的 AI 智能体规格。

#### Acceptance Criteria

1. THE Agent_Definition_Registry SHALL 将 AgentDefinition 定义为由 Agent_Id、Agent_Name、Agent_Role、System_Prompt、ModelBinding、Tool_Binding_List、可空 VoiceBinding 与 Tag_Set 组成的不可变结构。
2. THE Agent_Definition_Registry SHALL 将 Agent_Id 与 Agent_Name 定义为字符串字段，将 Agent_Role 与 System_Prompt 定义为字符串字段。
3. THE Agent_Definition_Registry SHALL 将 Tool_Binding_List 定义为 ToolBinding 的有序列表，将 Tag_Set 定义为 Tag 的集合。
4. THE Agent_Definition_Registry SHALL 将 VoiceBinding 定义为可空字段，其值或为一个携带 Voice_Id 的 VoiceBinding，或为不存在 (空)。
5. THE Agent_Definition_Registry SHALL 使 AgentDefinition 的判等基于其全部字段的语义内容，而不基于引用标识。

### Requirement 3: ModelBinding 与生成参数数据模型

**User Story:** 作为编排引擎开发者，我想要 ModelBinding 明确承载模型引用与生成参数，以便每个智能体的模型行为被精确描述。

#### Acceptance Criteria

1. THE Agent_Definition_Registry SHALL 将 ModelBinding 定义为由一个 Model_Id 与一组 Generation_Params 组成的不可变结构。
2. THE Agent_Definition_Registry SHALL 将 Generation_Params 定义为含 Temperature、Max_Tokens 与 Top_P 三个字段的不可变结构，其中 Temperature 与 Top_P 为数值、Max_Tokens 为整数。
3. THE Agent_Definition_Registry SHALL 将 Temperature 的合法区间定义为闭区间 [0, 2]。
4. THE Agent_Definition_Registry SHALL 将 Top_P 的合法区间定义为闭区间 [0, 1]。
5. THE Agent_Definition_Registry SHALL 将 Max_Tokens 的合法取值定义为大于等于 1 的整数。

### Requirement 4: ToolBinding、VoiceBinding 与 Tag 数据模型

**User Story:** 作为编排引擎开发者，我想要明确的工具绑定、语音绑定与标签结构，以便声明智能体可调用的工具、可选嗓音及其分类。

#### Acceptance Criteria

1. THE Agent_Definition_Registry SHALL 将 ToolBinding 定义为携带一个非空 Tool_Id 的不可变结构。
2. THE Agent_Definition_Registry SHALL 将 Tool_Binding_List 约束为其 Tool_Id 不含重复的列表。
3. THE Agent_Definition_Registry SHALL 将 VoiceBinding 定义为携带一个非空 Voice_Id 的不可变结构，且允许 AgentDefinition 不持有 VoiceBinding。
4. THE Agent_Definition_Registry SHALL 将 Tag_Set 约束为不含重复 Tag 的集合，且每个 Tag 为非空字符串。
5. THE Agent_Definition_Registry SHALL 不要求 Tool_Binding_List 或 Tag_Set 非空，二者均可为空集合。

### Requirement 5: AgentRegistry 不可变集合结构

**User Story:** 作为编排引擎开发者，我想要一个以 Agent_Id 为键的不可变智能体集合，以便集中管理一组智能体定义并保证写操作不改动既有集合。

#### Acceptance Criteria

1. THE Agent_Definition_Registry SHALL 将 AgentRegistry 定义为以 Agent_Id 为键、以 AgentDefinition 为值的不可变映射。
2. THE Agent_Definition_Registry SHALL 提供纯函数 `emptyRegistry()`，返回一个不含任何 AgentDefinition 的空 AgentRegistry。
3. THE Agent_Definition_Registry SHALL 保证一个 AgentRegistry 内每个 Agent_Id 至多对应一个 AgentDefinition（键唯一）。
4. FOR ALL AgentRegistry 写操作，THE Agent_Definition_Registry SHALL 返回一个新的 AgentRegistry，且作为输入的原 AgentRegistry 在操作后保持不变（不可变写）。
5. THE Agent_Definition_Registry SHALL 提供纯函数 `size(registry)`，返回该 AgentRegistry 中 AgentDefinition 的数量。

### Requirement 6: 添加智能体 (addAgent)

**User Story:** 作为编排引擎开发者，我想要向注册表添加智能体并在 id 重复时得到明确错误，以便安全地扩充注册表。

#### Acceptance Criteria

1. THE Agent_Definition_Registry SHALL 提供纯函数 `addAgent(registry, agent)`，返回一个 Registry_Result。
2. WHEN `addAgent(registry, agent)` 被调用且 `agent` 的 Agent_Id 不存在于 `registry`，THE Agent_Definition_Registry SHALL 返回一个成功 Registry_Result，其携带的新 AgentRegistry 较 `registry` 恰好多出 `agent` 一个条目。
3. IF `addAgent(registry, agent)` 被调用且 `agent` 的 Agent_Id 已存在于 `registry`，THEN THE Agent_Definition_Registry SHALL 返回一个失败 Registry_Result，其携带的 AgentError 的 AgentErrorCode 为 `AGENT_DUPLICATE_ID`，并定位该 Agent_Id。
4. WHEN `addAgent(registry, agent)` 返回失败，THE Agent_Definition_Registry SHALL 使 `registry` 保持不变，且不产出任何新 AgentRegistry 条目。
5. FOR ALL `registry` 与 `agent`，WHEN `addAgent` 成功，THE Agent_Definition_Registry SHALL 使所得新 AgentRegistry 的 `size` 等于 `size(registry)` 加 1。

### Requirement 7: 移除智能体 (removeAgent) 与添加/移除往返

**User Story:** 作为编排引擎开发者，我想要按 id 移除智能体并在不存在时得到明确错误，以便维护注册表内容。

#### Acceptance Criteria

1. THE Agent_Definition_Registry SHALL 提供纯函数 `removeAgent(registry, agentId)`，返回一个 Registry_Result。
2. WHEN `removeAgent(registry, agentId)` 被调用且 `agentId` 存在于 `registry`，THE Agent_Definition_Registry SHALL 返回一个成功 Registry_Result，其携带的新 AgentRegistry 较 `registry` 恰好少去 `agentId` 对应条目。
3. IF `removeAgent(registry, agentId)` 被调用且 `agentId` 不存在于 `registry`，THEN THE Agent_Definition_Registry SHALL 返回一个失败 Registry_Result，其携带的 AgentError 的 AgentErrorCode 为 `AGENT_NOT_FOUND`，并定位该 Agent_Id。
4. FOR ALL AgentRegistry `r` 与 AgentDefinition `a`，IF `a` 的 Agent_Id 不存在于 `r`，THEN THE Agent_Definition_Registry SHALL 使 `removeAgent(addAgent(r, a) 的新注册表, a 的 Agent_Id)` 成功且其结果注册表与 `r` 语义相等（添加/移除往返恒等）。
5. WHEN `removeAgent` 成功，THE Agent_Definition_Registry SHALL 使所得新 AgentRegistry 的 `size` 等于 `size(registry)` 减 1。

### Requirement 8: 更新智能体 (updateAgent)

**User Story:** 作为编排引擎开发者，我想要按 id 替换一个既有智能体定义并在不存在时得到明确错误，以便修改注册表中的智能体而不改变其键。

#### Acceptance Criteria

1. THE Agent_Definition_Registry SHALL 提供纯函数 `updateAgent(registry, agent)`，返回一个 Registry_Result。
2. WHEN `updateAgent(registry, agent)` 被调用且 `agent` 的 Agent_Id 存在于 `registry`，THE Agent_Definition_Registry SHALL 返回一个成功 Registry_Result，其携带的新 AgentRegistry 在该 Agent_Id 处的 AgentDefinition 等于 `agent`，其余条目不变。
3. IF `updateAgent(registry, agent)` 被调用且 `agent` 的 Agent_Id 不存在于 `registry`，THEN THE Agent_Definition_Registry SHALL 返回一个失败 Registry_Result，其携带的 AgentError 的 AgentErrorCode 为 `AGENT_NOT_FOUND`，并定位该 Agent_Id。
4. WHEN `updateAgent` 成功，THE Agent_Definition_Registry SHALL 使所得新 AgentRegistry 的 Agent_Id 键集合与 `size` 与 `registry` 相同（更新保持键集合不变）。
5. FOR ALL `updateAgent` 成功的调用，THE Agent_Definition_Registry SHALL 保留被更新 AgentDefinition 的 Agent_Id 不变（更新不改变 id）。

### Requirement 9: 查询与列举 (getAgent / listAgents / listByTag / findByTool)

**User Story:** 作为编排引擎开发者，我想要以确定顺序查询与列举智能体，以便上层稳定地展示与检索智能体。

#### Acceptance Criteria

1. THE Agent_Definition_Registry SHALL 提供纯函数 `getAgent(registry, agentId)`，WHEN `agentId` 存在则返回携带该 AgentDefinition 的存在值，IF `agentId` 不存在 THEN 返回不存在 (空) 值，而不抛出异常。
2. THE Agent_Definition_Registry SHALL 提供纯函数 `listAgents(registry)`，返回该注册表全部 AgentDefinition 且以 Listing_Order（按 Agent_Id 字典序升序）排列。
3. THE Agent_Definition_Registry SHALL 提供纯函数 `listByTag(registry, tag)`，返回 Tag_Set 含 `tag` 的全部 AgentDefinition，且以 Listing_Order 排列。
4. THE Agent_Definition_Registry SHALL 提供纯函数 `findByTool(registry, toolId)`，返回 Tool_Binding_List 含 Tool_Id 等于 `toolId` 的全部 AgentDefinition，且以 Listing_Order 排列。
5. FOR ALL AgentRegistry `r` 与查询参数，THE Agent_Definition_Registry SHALL 对相同输入返回逐元素相同且顺序相同的列表（查询确定性）。
6. FOR ALL AgentRegistry `r`，THE Agent_Definition_Registry SHALL 使 `listAgents(r)` 的长度等于 `size(r)`，且其元素的 Agent_Id 两两不同。

### Requirement 10: 单个智能体校验 (validateAgent)

**User Story:** 作为编排引擎开发者，我想要 `validateAgent` 完整且确定地报告一个智能体定义的全部违规，以便上层稳定地展示与处置校验错误。

#### Acceptance Criteria

1. THE Agent_Definition_Registry SHALL 提供纯函数 `validateAgent(agent)`，输入一个 AgentDefinition，输出一个 Agent_Validation_Result（含布尔 `valid` 与一组 AgentError）。
2. IF 一个 AgentDefinition 的 Agent_Id 为空字符串，THEN THE Agent_Definition_Registry SHALL 产出一条 AgentErrorCode 为 `AGENT_EMPTY_ID` 的 AgentError，并定位字段名 `id`。
3. IF 一个 AgentDefinition 的 Agent_Name 为空字符串，THEN THE Agent_Definition_Registry SHALL 产出一条 AgentErrorCode 为 `AGENT_EMPTY_NAME` 的 AgentError，并定位字段名 `name`。
4. IF 一个 AgentDefinition 的 Temperature 不在闭区间 [0, 2] 内，THEN THE Agent_Definition_Registry SHALL 产出一条 AgentErrorCode 为 `AGENT_TEMPERATURE_OUT_OF_RANGE` 的 AgentError，并定位字段名 `temperature`。
5. IF 一个 AgentDefinition 的 Max_Tokens 不是大于等于 1 的整数，THEN THE Agent_Definition_Registry SHALL 产出一条 AgentErrorCode 为 `AGENT_MAX_TOKENS_INVALID` 的 AgentError，并定位字段名 `maxTokens`。
6. IF 一个 AgentDefinition 的 Top_P 不在闭区间 [0, 1] 内，THEN THE Agent_Definition_Registry SHALL 产出一条 AgentErrorCode 为 `AGENT_TOP_P_OUT_OF_RANGE` 的 AgentError，并定位字段名 `topP`。
7. IF 一个 AgentDefinition 的 Tool_Binding_List 含重复 Tool_Id，THEN THE Agent_Definition_Registry SHALL 产出一条 AgentErrorCode 为 `AGENT_DUPLICATE_TOOL_BINDING` 的 AgentError，并定位重复的 Tool_Id。
8. IF 一个 AgentDefinition 的 System_Prompt 字符长度超过 System_Prompt_Max_Length，THEN THE Agent_Definition_Registry SHALL 产出一条 AgentErrorCode 为 `AGENT_SYSTEM_PROMPT_TOO_LONG` 的 AgentError，并定位字段名 `systemPrompt`。
9. WHEN 一个 AgentDefinition 不违反任何校验规则，THE Agent_Definition_Registry SHALL 返回 `valid` 为真且 AgentError 组为空的 Agent_Validation_Result。
10. WHEN 一个 AgentDefinition 违反一条或多条校验规则，THE Agent_Definition_Registry SHALL 在单次校验中报告全部被违反规则对应的 AgentError，而非在首条错误处停止，并以确定且稳定的顺序排列这些 AgentError。
11. FOR ALL AgentDefinition `a`，THE Agent_Definition_Registry SHALL 对相同输入返回相同的 Agent_Validation_Result（校验确定性）。

### Requirement 11: 注册表校验 (validateRegistry)

**User Story:** 作为编排引擎开发者，我想要 `validateRegistry` 在校验每个智能体的同时核对全局 id 唯一性，以便整张注册表既逐项合法又全局自洽。

#### Acceptance Criteria

1. THE Agent_Definition_Registry SHALL 提供纯函数 `validateRegistry(registry)`，输入一个 AgentRegistry，输出一个 Registry_Validation_Result（含布尔 `valid` 与一组 AgentError）。
2. WHEN `validateRegistry` 校验一个 AgentRegistry，THE Agent_Definition_Registry SHALL 对其每个 AgentDefinition 施加 `validateAgent` 的全部校验规则，并汇集所产出的全部 AgentError。
3. IF 一个 AgentRegistry 中存在两个或更多 AgentDefinition 持有相同的 Agent_Id，THEN THE Agent_Definition_Registry SHALL 产出一条 AgentErrorCode 为 `AGENT_DUPLICATE_ID` 的 AgentError，并定位该重复的 Agent_Id。
4. WHEN 一个 AgentRegistry 的全部 AgentDefinition 均通过 `validateAgent` 且无重复 Agent_Id，THE Agent_Definition_Registry SHALL 返回 `valid` 为真且 AgentError 组为空的 Registry_Validation_Result。
5. THE Agent_Definition_Registry SHALL 以确定且稳定的顺序排列 Registry_Validation_Result 中的 AgentError，并对相同输入返回相同结果（校验确定性）。
6. FOR ALL 通过 `validateRegistry` 的 AgentRegistry，THE Agent_Definition_Registry SHALL 保证 `listAgents` 所返回每个 AgentDefinition 单独施加 `validateAgent` 时亦 `valid` 为真（注册表合法蕴含逐项合法）。

### Requirement 12: 错误码枚举与跨层互斥

**User Story:** 作为编排引擎开发者，我想要所有错误携带稳定且与前序各层互不冲突的错误码，以便跨层聚合并程序化区分错误来源。

#### Acceptance Criteria

1. THE Agent_Definition_Registry SHALL 使每条 AgentError 携带一个取值于 AgentErrorCode 枚举的稳定错误码，且该枚举至少包含 `AGENT_DUPLICATE_ID`、`AGENT_NOT_FOUND`、`AGENT_EMPTY_ID`、`AGENT_EMPTY_NAME`、`AGENT_TEMPERATURE_OUT_OF_RANGE`、`AGENT_MAX_TOKENS_INVALID`、`AGENT_TOP_P_OUT_OF_RANGE`、`AGENT_DUPLICATE_TOOL_BINDING`、`AGENT_SYSTEM_PROMPT_TOO_LONG`、`AGENT_MALFORMED_JSON`。
2. THE Agent_Definition_Registry SHALL 使 AgentErrorCode 的取值集合与前序子规格的 `ErrorCode`（workflow-graph-model）取值集合不相交。
3. THE Agent_Definition_Registry SHALL 使 AgentErrorCode 的取值集合与前序子规格的 `Config_Error_Code`（workflow-node-types）取值集合不相交。
4. THE Agent_Definition_Registry SHALL 使 AgentErrorCode 的取值集合与前序子规格的 `Executor_Error_Code`（workflow-execution-engine）取值集合不相交。
5. THE Agent_Definition_Registry SHALL 使每条 AgentError 携带一条人类可读的描述字符串，并在与某具体 Agent_Id、字段名或 Tool_Id 相关时于其定位信息中记录该标识。

### Requirement 13: 规范化 (normalizeAgent)

**User Story:** 作为编排引擎开发者，我想要每个智能体定义有唯一的规范形式，以便智能体可被稳定地比较、去重与存储。

#### Acceptance Criteria

1. THE Agent_Definition_Registry SHALL 提供纯函数 `normalizeAgent(agent)`，将一个 AgentDefinition 转换为其 Canonical_Agent 形式。
2. WHEN `normalizeAgent` 规范化一个 AgentDefinition，THE Agent_Definition_Registry SHALL 将其 Tag_Set 以确定顺序排序、将其 Tool_Binding_List 以 Tool_Id 确定顺序排序，并将其 Generation_Params 收敛到合法区间。
3. FOR ALL AgentDefinition `a`，THE Agent_Definition_Registry SHALL 使 `normalizeAgent(normalizeAgent(a))` 等于 `normalizeAgent(a)`（规范化幂等性）。
4. FOR ALL 两个语义等价（字段内容相同，仅 Tag 或 Tool_Binding 顺序不同、或数值在收敛后相等）的 AgentDefinition，THE Agent_Definition_Registry SHALL 使 `normalizeAgent` 对二者产出相等的 Canonical_Agent（规范形式唯一）。
5. FOR ALL AgentDefinition `a`，WHEN `a` 已为 Canonical_Agent 形式，THE Agent_Definition_Registry SHALL 使 `normalizeAgent(a)` 等于 `a`（规范形式为规范化的不动点）。
6. THE Agent_Definition_Registry SHALL 使 `normalizeAgent` 保持 AgentDefinition 的 Agent_Id、Agent_Name、Agent_Role、System_Prompt、Model_Id 与 VoiceBinding 在语义上不变（规范化不改变这些字段的语义内容）。

### Requirement 14: 生成参数区间收敛与幂等性

**User Story:** 作为编排引擎开发者，我想要生成参数被收敛到合法区间且收敛可重复施加而结果不变，以便规范化后的参数始终可用。

#### Acceptance Criteria

1. THE Agent_Definition_Registry SHALL 提供纯函数 `clampGenerationParams(params)`，将越界的 Temperature、Top_P 收敛到其合法区间的最近端点，并将 Max_Tokens 收敛到大于等于 1 的最近整数取值。
2. FOR ALL Generation_Params `p`，THE Agent_Definition_Registry SHALL 使 `clampGenerationParams(clampGenerationParams(p))` 等于 `clampGenerationParams(p)`（收敛幂等性）。
3. FOR ALL Generation_Params `p`，WHEN `p` 的全部数值字段均在合法区间内，THE Agent_Definition_Registry SHALL 使 `clampGenerationParams(p)` 等于 `p`（区间内取值不被改动）。
4. FOR ALL Generation_Params `p`，THE Agent_Definition_Registry SHALL 使 `clampGenerationParams(p)` 的 Temperature 落在 [0, 2]、Top_P 落在 [0, 1]、Max_Tokens 为大于等于 1 的整数（收敛后恒落在合法区间）。
5. FOR ALL AgentDefinition `a`，THE Agent_Definition_Registry SHALL 使 `validateAgent(normalizeAgent(a))` 不产出 `AGENT_TEMPERATURE_OUT_OF_RANGE`、`AGENT_TOP_P_OUT_OF_RANGE` 或 `AGENT_MAX_TOKENS_INVALID` 的 AgentError（规范化消解数值越界）。

### Requirement 15: 序列化与往返恒等 (serializeRegistry / deserializeRegistry)

**User Story:** 作为编排引擎开发者，我想要注册表的规范化 JSON 序列化与可靠反序列化，以便注册表可被存储、传输并无损还原。

#### Acceptance Criteria

1. THE Agent_Definition_Registry SHALL 提供纯函数 `serializeRegistry(registry)`，将任意 AgentRegistry 渲染为 Registry_Json 字符串。
2. THE Agent_Definition_Registry SHALL 提供纯函数 `deserializeRegistry(json)`，将一个合法的 Registry_Json 字符串还原为 AgentRegistry。
3. FOR ALL AgentRegistry `r`，THE Agent_Definition_Registry SHALL 使 `deserializeRegistry(serializeRegistry(r))` 得到与规范化后的 `r`（每个 AgentDefinition 经 `normalizeAgent`）语义相等的 AgentRegistry（序列化往返恒等）。
4. FOR ALL 由 `serializeRegistry` 产出的 Registry_Json 字符串 `j`，THE Agent_Definition_Registry SHALL 使 `serializeRegistry(deserializeRegistry(j))` 等于 `j`（规范化字符串往返恒等）。
5. FOR ALL 两个语义等价的 AgentRegistry（每个 Agent_Id 对应的 AgentDefinition 经 `normalizeAgent` 后相等），THE Agent_Definition_Registry SHALL 使 `serializeRegistry` 对二者产出逐字符相同的 Registry_Json（规范化输出唯一）。
6. IF `deserializeRegistry` 接收一个不符合 Registry_Json 结构的字符串，THEN THE Agent_Definition_Registry SHALL 返回一个 AgentErrorCode 为 `AGENT_MALFORMED_JSON` 的失败结果，并指明解析失败的原因，而非产出一个 AgentRegistry。
7. WHEN `deserializeRegistry` 成功还原一个 AgentRegistry，THE Agent_Definition_Registry SHALL 保留每个 AgentDefinition 的 Agent_Id、Agent_Name、Agent_Role、System_Prompt、ModelBinding、Tool_Binding_List、VoiceBinding 与 Tag_Set 全部组成部分。

### Requirement 16: 模型绑定解析与节点配置绑定 (resolveModelBinding / bindAgentToNodeConfig)

**User Story:** 作为编排引擎开发者，我想要从智能体定义纯粹地推导模型参数并填充 `llm` 节点配置字段，以便工作流节点引用智能体而无需重复声明模型细节。

#### Acceptance Criteria

1. THE Agent_Definition_Registry SHALL 提供纯函数 `resolveModelBinding(agent)`，返回一个 Model_Binding_Resolution，携带该 AgentDefinition 的 Model_Id 与 Generation_Params。
2. FOR ALL AgentDefinition `a`，THE Agent_Definition_Registry SHALL 使 `resolveModelBinding(a)` 的 Model_Id 等于 `a` 的 ModelBinding 的 Model_Id，且其 Generation_Params 等于 `a` 的 ModelBinding 的 Generation_Params（解析忠实于源绑定）。
3. THE Agent_Definition_Registry SHALL 提供纯函数 `bindAgentToNodeConfig(agent, nodeConfig)`，作为纯数据变换返回一个 Node_Config_Binding_Result，将由 `agent` 推导出的 Model_Id、System_Prompt、Temperature、Max_Tokens 填入前序子规格 `Llm_Config` 形态的相应字段。
4. THE Agent_Definition_Registry SHALL 使 `bindAgentToNodeConfig` 不发起任何执行、I/O 或网络访问，且不就地修改输入的 `nodeConfig`（纯数据变换）。
5. WHEN `bindAgentToNodeConfig(agent, nodeConfig)` 产出结果，THE Agent_Definition_Registry SHALL 使其 `Model_Id` 字段等于 `agent` 的 Model_Id、`System_Prompt` 字段等于 `agent` 的 System_Prompt、`Temperature` 字段等于 `agent` 的 Temperature、`Max_Tokens` 字段等于 `agent` 的 Max_Tokens。
6. FOR ALL `agent` 与 `nodeConfig`，THE Agent_Definition_Registry SHALL 使 `bindAgentToNodeConfig` 对相同输入返回相同的 Node_Config_Binding_Result（绑定确定性）。
7. FOR ALL 已通过 `validateAgent` 的 AgentDefinition `a`，THE Agent_Definition_Registry SHALL 使 `bindAgentToNodeConfig(a, nodeConfig)` 产出的 Temperature 落在 [0, 2]、Max_Tokens 为大于等于 1 的整数（绑定结果满足 `Llm_Config` 的数值约束）。

### Requirement 17: 查询派生——标签索引与按工具查找的一致性

**User Story:** 作为编排引擎开发者，我想要标签索引与按工具查找的派生结果确定且与逐项查询一致，以便高效检索而不损失正确性。

#### Acceptance Criteria

1. THE Agent_Definition_Registry SHALL 提供纯函数 `buildTagIndex(registry)`，返回一个 Tag_Index（从 Tag 到持有该 Tag 的 Agent_Id 集合的映射）。
2. FOR ALL AgentRegistry `r` 与 Tag `t`，THE Agent_Definition_Registry SHALL 使 `buildTagIndex(r)` 中 `t` 对应的 Agent_Id 集合恰好等于 `listByTag(r, t)` 所返回 AgentDefinition 的 Agent_Id 集合（标签索引与列举一致）。
3. FOR ALL AgentRegistry `r`，THE Agent_Definition_Registry SHALL 对相同输入返回相同的 Tag_Index（派生确定性）。
4. FOR ALL AgentRegistry `r` 与 Tool_Id `toolId`，THE Agent_Definition_Registry SHALL 使 `findByTool(r, toolId)` 所返回的每个 AgentDefinition 的 Tool_Binding_List 均含一个 Tool_Id 等于 `toolId` 的 ToolBinding，且 `r` 中其余 AgentDefinition 均不含（按工具查找的完备且精确）。
5. FOR ALL AgentRegistry `r` 与 Tag `t`，THE Agent_Definition_Registry SHALL 使 `listByTag(r, t)` 所返回的每个 AgentDefinition 的 Tag_Set 均含 `t`，且 `r` 中其余 AgentDefinition 均不含（按标签列举的完备且精确）。
