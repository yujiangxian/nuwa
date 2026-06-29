# Requirements Document

## Introduction

「智能体工具系统」(agent-tool-system) 是女娲 Nuwa「多智能体工作流编排引擎」(multi-agent workflow orchestration engine) 的**第五个子规格**，构建于已实现的四个前序子规格之上：

- **工作流图模型** (workflow-graph-model, 位于 `app/web/src/lib/workflow/`)：提供 `PortType`、`isAssignable`、规范 JSON 序列化与基础层 `ErrorCode` 枚举。
- **工作流节点类型** (workflow-node-types, 位于 `app/web/src/lib/workflow/nodeTypes/`)：定义 `ToolConfig`（含 `Tool_Name`、`Argument_Bindings`）与配置层 `Config_Error_Code` 枚举。
- **工作流执行引擎** (workflow-execution-engine, 位于 `app/web/src/lib/workflow/engine/`)：定义执行层 `Executor_Error_Code` 枚举。
- **智能体定义注册表** (agent-definition-registry, 位于 `app/web/src/lib/agents/`)：定义 `AgentDefinition`、`ToolBinding`（含 `Tool_Id`）与 `AgentErrorCode` 枚举。

本子规格 (agent-tool-system) 的职责是定义一个**纯的库**，用于声明与管理「工具定义」(ToolDefinition)——即智能体可调用、工作流 `tool` 节点可引用的、带类型参数模式 (Parameter_Schema) 的工具规格。实现位于 `app/web/src/lib/tools/`。

**核心约束（关键设计原则）**：本子规格必须是**纯数据 + 纯函数**的库，**不含任何 I/O、不依赖 React、不发起任何网络访问、不真正执行任何工具**，亦不含可变全局状态、时间或随机依赖。ToolRegistry 是**不可变集合**：一切写操作（添加、移除、更新）都返回**新的注册表**而绝不就地修改既有注册表。所有错误都建模为带稳定错误码 (ToolErrorCode) 的 ToolError 值，其取值集合与前序四层的错误码取值集合互不相交，便于跨层聚合区分。

本子规格的范围限定为以下相互关联、作为整体交付的目标：

1. **ToolDefinition 数据模型**：以不可变、带类型的结构描述一个工具，含标识 (Tool_Id)、名称 (Tool_Name)、描述 (Tool_Description)、参数模式 (Parameter_Schema)、结果类型 (Result_Type) 与标签集合 (Tag 集合)。
2. **Parameter_Schema 数据模型**：一个有序的参数定义 (ParameterDef) 列表；每个 ParameterDef 含参数名 (Param_Name)、参数类型 (引用前序层 `PortType`)、是否必需 (Required) 与可选默认存在标志。
3. **ToolRegistry 不可变集合**：以 Tool_Id 为键的 ToolDefinition 不可变集合，提供 `addTool`、`removeTool`、`updateTool`、`getTool`、`listTools`、`listByTag` 等纯操作，写操作均返回新注册表，并以结果类型 (Tool_Registry_Result) 表达错误（重复 id、未找到）。
4. **校验** (`validateTool` / `validateRegistry`)：Tool_Id 非空且唯一；Tool_Name 非空；Parameter_Schema 中 Param_Name 非空且不重复；Tag 不重复且非空；产出带稳定错误码的 ToolError 值。
5. **规范化** (`normalizeTool`)：将 ToolDefinition 转换为规范形式（标签排序、参数定义按 Param_Name 确定顺序、去重），幂等且对语义等价唯一。
6. **序列化** (`serializeRegistry` / `deserializeRegistry`)：规范化 JSON 往返恒等、规范形式唯一、对畸形输入产出错误。
7. **参数绑定校验** (`validateArguments`)：给定一个 ToolDefinition 与一组实参 (Argument_Map：Param_Name → 实参 PortType)，纯粹地校验必需参数齐备、无未知参数、类型可赋值 (用前序层 `isAssignable`)，产出带稳定错误码的结果，不执行工具。
8. **与工作流/智能体层的桥接**（纯）：`toolConfigToToolId(toolConfig)` 从 `ToolConfig` 的 `Tool_Name` 推导查询键；`isToolReferencedBy(tool, agent)` 判定一个 AgentDefinition 的 Tool_Binding_List 是否引用某 ToolDefinition；`buildToolIndex` 派生标签索引。

本子规格仅产出本工具系统层的需求与纯函数契约，**不做任何实现**。前序子规格已定义的类型（`PortType`、`isAssignable`、`ToolConfig`、`AgentDefinition`、`ToolBinding`、各层 `ErrorCode` 等）在本文档中仅以散文引用，不在此重新定义。

## Glossary

- **Agent_Tool_System**: 本子规格定义的整体模块（ToolDefinition/ToolRegistry 纯数据模型 + 校验/规范化/序列化/参数校验/桥接等纯函数库），位于 `app/web/src/lib/tools/`。
- **ToolDefinition**: 一个可被智能体调用、工作流 `tool` 节点可引用的不可变、带类型工具规格，由 Tool_Id、Tool_Name、Tool_Description、Parameter_Schema、Result_Type 与 Tag_Set 组成。
- **Tool_Id**: ToolDefinition 的唯一标识，为非空字符串，在一个 ToolRegistry 内唯一。
- **Tool_Name**: ToolDefinition 的人类可读名称，为非空字符串。
- **Tool_Description**: ToolDefinition 的描述字符串，说明该工具的用途（可为空字符串）。
- **Parameter_Schema**: ToolDefinition 的参数模式，为 ParameterDef 的有序列表，其 Param_Name 不含重复。
- **ParameterDef**: Parameter_Schema 中的单个参数定义，由 Param_Name、Param_Type、Required 标志组成。
- **Param_Name**: ParameterDef 中参数的非空字符串名称，在一个 Parameter_Schema 内唯一。
- **Param_Type**: ParameterDef 中参数的类型，引用前序子规格 (workflow-graph-model) 的 `PortType`。
- **Required**: ParameterDef 中标识该参数是否必需的布尔标志。
- **Result_Type**: ToolDefinition 调用结果的类型，引用前序子规格的 `PortType`。
- **Tag**: 用于对 ToolDefinition 分类的非空字符串标签。
- **Tag_Set**: ToolDefinition 上 Tag 的集合，不含重复。
- **ToolRegistry**: 以 Tool_Id 为键的 ToolDefinition 不可变集合，提供纯查询与返回新注册表的纯写操作。
- **Tool_Registry_Result**: ToolRegistry 写操作 (`addTool`/`removeTool`/`updateTool`) 的返回，或为成功（携带一个新的 ToolRegistry），或为失败（携带一个 ToolError）。
- **ToolError**: 单条错误值，含 ToolErrorCode、定位信息（涉及的 Tool_Id / Param_Name / 字段名等）与人类可读描述。
- **ToolErrorCode**: ToolError 的稳定枚举标识，用于程序化区分错误类别，其取值集合与前序子规格的 `ErrorCode`、`Config_Error_Code`、`Executor_Error_Code`、`AgentErrorCode` 取值集合互不相交。
- **Tool_Validation_Result**: `validateTool` 的结果，含布尔 `valid` 与一组 ToolError（valid 为真时该组为空）。
- **Registry_Validation_Result**: `validateRegistry` 的结果，含布尔 `valid` 与一组 ToolError（valid 为真时该组为空）。
- **Argument_Map**: 一组实参，从 Param_Name 映射到一个实参 PortType，作为 `validateArguments` 的输入。
- **Argument_Validation_Result**: `validateArguments` 的结果，含布尔 `valid` 与一组 ToolError。
- **Canonical_Tool**: ToolDefinition 的规范形式，其 Tag_Set 已排序、Parameter_Schema 已按 Param_Name 确定顺序排序，使语义等价的 ToolDefinition 具有唯一表示。
- **Canonical_Registry**: ToolRegistry 的规范形式，其全部 ToolDefinition 均为 Canonical_Tool，且条目以 Tool_Id 排序。
- **Tool_Json**: 单个 ToolDefinition 的规范化 JSON 表示，键顺序与集合顺序确定。
- **Registry_Json**: ToolRegistry 的规范化 JSON 表示，键顺序与条目顺序确定，使语义相等的注册表序列化输出唯一。
- **Tool_Index**: 由查询助手派生的、从 Tag 到持有该 Tag 的 Tool_Id 集合的映射。
- **Listing_Order**: ToolDefinition 列表的确定排序规则：按 Tool_Id 的字典序升序。
- **PortType**: 前序子规格 (workflow-graph-model) 定义的端口类型，本子规格仅以散文引用，不重新定义。
- **isAssignable**: 前序子规格定义的类型可赋值判定函数，本子规格仅以散文引用，用于 `validateArguments` 的类型兼容判定。
- **ToolConfig**: 前序子规格 (workflow-node-types) 为 `tool` 节点定义的配置结构，含 `Tool_Name`、`Argument_Bindings`。本子规格仅以散文引用，不重新定义。
- **AgentDefinition**: 前序子规格 (agent-definition-registry) 定义的智能体规格，其 Tool_Binding_List 含 ToolBinding。本子规格仅以散文引用。
- **ToolBinding**: 前序子规格 (agent-definition-registry) 定义的工具绑定，含 Tool_Id。本子规格仅以散文引用。
- **Round_Trip**: 一个操作与其逆操作复合后回到等价起点的往返性质。
- **Determinism**: 纯函数对相同输入恒产出相同输出的确定性性质。
- **Idempotence**: 一个操作施加一次与施加多次结果相同的幂等性质。

## Requirements

### Requirement 1: 模块范围与纯库约束

**User Story:** 作为编排引擎开发者，我想要一个不含 I/O、网络与 React 依赖、且不真正执行工具的纯工具系统库，以便其行为完全确定且可用属性测试 (property-based testing) 验证。

#### Acceptance Criteria

1. THE Agent_Tool_System SHALL 仅由纯函数与不可变类型构成，不包含 I/O、网络访问、React 依赖、可变全局状态、时间或随机依赖。
2. THE Agent_Tool_System SHALL 仅以散文与类型引用前序子规格中已定义的类型（如 `PortType`、`isAssignable`、`ToolConfig`、`AgentDefinition`、`ToolBinding`、`ErrorCode`、`Config_Error_Code`、`Executor_Error_Code`、`AgentErrorCode`），而不重新定义这些类型。
3. FOR ALL Agent_Tool_System 对外暴露的函数，THE Agent_Tool_System SHALL 对相同输入返回相同输出（确定性）。
4. THE Agent_Tool_System SHALL 不就地修改任何输入的 ToolDefinition 或 ToolRegistry，所有变更结果均以新值返回（不可变性）。
5. THE Agent_Tool_System SHALL 不真正执行任何工具、不产生任何副作用；其全部函数均为纯数据变换或校验。

### Requirement 2: ToolDefinition 数据模型

**User Story:** 作为编排引擎开发者，我想要一个带类型、不可变的 ToolDefinition 结构，以便统一地声明可复用的工具规格。

#### Acceptance Criteria

1. THE Agent_Tool_System SHALL 将 ToolDefinition 定义为由 Tool_Id、Tool_Name、Tool_Description、Parameter_Schema、Result_Type 与 Tag_Set 组成的不可变结构。
2. THE Agent_Tool_System SHALL 将 Tool_Id、Tool_Name 与 Tool_Description 定义为字符串字段。
3. THE Agent_Tool_System SHALL 将 Parameter_Schema 定义为 ParameterDef 的有序列表，将 Tag_Set 定义为 Tag 的集合。
4. THE Agent_Tool_System SHALL 将 Result_Type 定义为引用前序层 `PortType` 的字段。
5. THE Agent_Tool_System SHALL 使 ToolDefinition 的判等基于其全部字段的语义内容，而不基于引用标识。

### Requirement 3: Parameter_Schema 与 ParameterDef 数据模型

**User Story:** 作为编排引擎开发者，我想要 Parameter_Schema 明确承载每个参数的名称、类型与是否必需，以便工具的输入契约被精确描述。

#### Acceptance Criteria

1. THE Agent_Tool_System SHALL 将 ParameterDef 定义为由 Param_Name、Param_Type 与 Required 布尔标志组成的不可变结构。
2. THE Agent_Tool_System SHALL 将 Param_Name 定义为字符串字段，将 Param_Type 定义为引用前序层 `PortType` 的字段。
3. THE Agent_Tool_System SHALL 将 Parameter_Schema 约束为其 Param_Name 不含重复的有序列表。
4. THE Agent_Tool_System SHALL 不要求 Parameter_Schema 或 Tag_Set 非空，二者均可为空集合。

### Requirement 4: ToolRegistry 不可变集合结构

**User Story:** 作为编排引擎开发者，我想要一个以 Tool_Id 为键的不可变工具集合，以便集中管理一组工具定义并保证写操作不改动既有集合。

#### Acceptance Criteria

1. THE Agent_Tool_System SHALL 将 ToolRegistry 定义为以 Tool_Id 为键、以 ToolDefinition 为值的不可变映射。
2. THE Agent_Tool_System SHALL 提供纯函数 `emptyRegistry()`，返回一个不含任何 ToolDefinition 的空 ToolRegistry。
3. THE Agent_Tool_System SHALL 保证一个 ToolRegistry 内每个 Tool_Id 至多对应一个 ToolDefinition（键唯一）。
4. FOR ALL ToolRegistry 写操作，THE Agent_Tool_System SHALL 返回一个新的 ToolRegistry，且作为输入的原 ToolRegistry 在操作后保持不变（不可变写）。
5. THE Agent_Tool_System SHALL 提供纯函数 `size(registry)`，返回该 ToolRegistry 中 ToolDefinition 的数量。

### Requirement 5: 添加工具 (addTool)

**User Story:** 作为编排引擎开发者，我想要向注册表添加工具并在 id 重复时得到明确错误，以便安全地扩充注册表。

#### Acceptance Criteria

1. THE Agent_Tool_System SHALL 提供纯函数 `addTool(registry, tool)`，返回一个 Tool_Registry_Result。
2. WHEN `addTool(registry, tool)` 被调用且 `tool` 的 Tool_Id 不存在于 `registry`，THE Agent_Tool_System SHALL 返回一个成功 Tool_Registry_Result，其携带的新 ToolRegistry 较 `registry` 恰好多出 `tool` 一个条目。
3. IF `addTool(registry, tool)` 被调用且 `tool` 的 Tool_Id 已存在于 `registry`，THEN THE Agent_Tool_System SHALL 返回一个失败 Tool_Registry_Result，其携带的 ToolError 的 ToolErrorCode 为 `TOOL_DUPLICATE_ID`，并定位该 Tool_Id。
4. WHEN `addTool(registry, tool)` 返回失败，THE Agent_Tool_System SHALL 使 `registry` 保持不变。
5. FOR ALL `registry` 与 `tool`，WHEN `addTool` 成功，THE Agent_Tool_System SHALL 使所得新 ToolRegistry 的 `size` 等于 `size(registry)` 加 1。

### Requirement 6: 移除工具 (removeTool) 与添加/移除往返

**User Story:** 作为编排引擎开发者，我想要按 id 移除工具并在不存在时得到明确错误，以便维护注册表内容。

#### Acceptance Criteria

1. THE Agent_Tool_System SHALL 提供纯函数 `removeTool(registry, toolId)`，返回一个 Tool_Registry_Result。
2. WHEN `removeTool(registry, toolId)` 被调用且 `toolId` 存在于 `registry`，THE Agent_Tool_System SHALL 返回一个成功 Tool_Registry_Result，其携带的新 ToolRegistry 较 `registry` 恰好少去 `toolId` 对应条目。
3. IF `removeTool(registry, toolId)` 被调用且 `toolId` 不存在于 `registry`，THEN THE Agent_Tool_System SHALL 返回一个失败 Tool_Registry_Result，其携带的 ToolError 的 ToolErrorCode 为 `TOOL_NOT_FOUND`，并定位该 Tool_Id。
4. FOR ALL ToolRegistry `r` 与 ToolDefinition `t`，IF `t` 的 Tool_Id 不存在于 `r`，THEN THE Agent_Tool_System SHALL 使 `removeTool(addTool(r, t) 的新注册表, t 的 Tool_Id)` 成功且其结果注册表与 `r` 语义相等（添加/移除往返恒等）。
5. WHEN `removeTool` 成功，THE Agent_Tool_System SHALL 使所得新 ToolRegistry 的 `size` 等于 `size(registry)` 减 1。

### Requirement 7: 更新工具 (updateTool)

**User Story:** 作为编排引擎开发者，我想要按 id 替换一个既有工具定义并在不存在时得到明确错误，以便修改注册表中的工具而不改变其键。

#### Acceptance Criteria

1. THE Agent_Tool_System SHALL 提供纯函数 `updateTool(registry, tool)`，返回一个 Tool_Registry_Result。
2. WHEN `updateTool(registry, tool)` 被调用且 `tool` 的 Tool_Id 存在于 `registry`，THE Agent_Tool_System SHALL 返回一个成功 Tool_Registry_Result，其携带的新 ToolRegistry 在该 Tool_Id 处的 ToolDefinition 等于 `tool`，其余条目不变。
3. IF `updateTool(registry, tool)` 被调用且 `tool` 的 Tool_Id 不存在于 `registry`，THEN THE Agent_Tool_System SHALL 返回一个失败 Tool_Registry_Result，其携带的 ToolError 的 ToolErrorCode 为 `TOOL_NOT_FOUND`，并定位该 Tool_Id。
4. WHEN `updateTool` 成功，THE Agent_Tool_System SHALL 使所得新 ToolRegistry 的 Tool_Id 键集合与 `size` 与 `registry` 相同（更新保持键集合不变）。
5. FOR ALL `updateTool` 成功的调用，THE Agent_Tool_System SHALL 保留被更新 ToolDefinition 的 Tool_Id 不变（更新不改变 id）。

### Requirement 8: 查询与列举 (getTool / listTools / listByTag)

**User Story:** 作为编排引擎开发者，我想要以确定顺序查询与列举工具，以便上层稳定地展示与检索工具。

#### Acceptance Criteria

1. THE Agent_Tool_System SHALL 提供纯函数 `getTool(registry, toolId)`，WHEN `toolId` 存在则返回携带该 ToolDefinition 的存在值，IF `toolId` 不存在 THEN 返回不存在 (空) 值，而不抛出异常。
2. THE Agent_Tool_System SHALL 提供纯函数 `listTools(registry)`，返回该注册表全部 ToolDefinition 且以 Listing_Order（按 Tool_Id 字典序升序）排列。
3. THE Agent_Tool_System SHALL 提供纯函数 `listByTag(registry, tag)`，返回 Tag_Set 含 `tag` 的全部 ToolDefinition，且以 Listing_Order 排列。
4. FOR ALL ToolRegistry `r` 与查询参数，THE Agent_Tool_System SHALL 对相同输入返回逐元素相同且顺序相同的列表（查询确定性）。
5. FOR ALL ToolRegistry `r`，THE Agent_Tool_System SHALL 使 `listTools(r)` 的长度等于 `size(r)`，且其元素的 Tool_Id 两两不同。

### Requirement 9: 单个工具校验 (validateTool)

**User Story:** 作为编排引擎开发者，我想要 `validateTool` 完整且确定地报告一个工具定义的全部违规，以便上层稳定地展示与处置校验错误。

#### Acceptance Criteria

1. THE Agent_Tool_System SHALL 提供纯函数 `validateTool(tool)`，输入一个 ToolDefinition，输出一个 Tool_Validation_Result（含布尔 `valid` 与一组 ToolError）。
2. IF 一个 ToolDefinition 的 Tool_Id 为空字符串，THEN THE Agent_Tool_System SHALL 产出一条 ToolErrorCode 为 `TOOL_EMPTY_ID` 的 ToolError，并定位字段名 `id`。
3. IF 一个 ToolDefinition 的 Tool_Name 为空字符串，THEN THE Agent_Tool_System SHALL 产出一条 ToolErrorCode 为 `TOOL_EMPTY_NAME` 的 ToolError，并定位字段名 `name`。
4. IF 一个 ToolDefinition 的 Parameter_Schema 含某个为空字符串的 Param_Name，THEN THE Agent_Tool_System SHALL 产出一条 ToolErrorCode 为 `TOOL_EMPTY_PARAM_NAME` 的 ToolError，并定位该参数。
5. IF 一个 ToolDefinition 的 Parameter_Schema 含重复的 Param_Name，THEN THE Agent_Tool_System SHALL 产出一条 ToolErrorCode 为 `TOOL_DUPLICATE_PARAM` 的 ToolError，并定位重复的 Param_Name。
6. IF 一个 ToolDefinition 的 Tag_Set 含某个为空字符串的 Tag，THEN THE Agent_Tool_System SHALL 产出一条 ToolErrorCode 为 `TOOL_EMPTY_TAG` 的 ToolError。
7. WHEN 一个 ToolDefinition 不违反任何校验规则，THE Agent_Tool_System SHALL 返回 `valid` 为真且 ToolError 组为空的 Tool_Validation_Result。
8. WHEN 一个 ToolDefinition 违反一条或多条校验规则，THE Agent_Tool_System SHALL 在单次校验中报告全部被违反规则对应的 ToolError，而非在首条错误处停止，并以确定且稳定的顺序排列这些 ToolError。
9. FOR ALL ToolDefinition `t`，THE Agent_Tool_System SHALL 对相同输入返回相同的 Tool_Validation_Result（校验确定性）。

### Requirement 10: 注册表校验 (validateRegistry)

**User Story:** 作为编排引擎开发者，我想要 `validateRegistry` 在校验每个工具的同时核对全局 id 唯一性，以便整张注册表既逐项合法又全局自洽。

#### Acceptance Criteria

1. THE Agent_Tool_System SHALL 提供纯函数 `validateRegistry(registry)`，输入一个 ToolRegistry，输出一个 Registry_Validation_Result（含布尔 `valid` 与一组 ToolError）。
2. WHEN `validateRegistry` 校验一个 ToolRegistry，THE Agent_Tool_System SHALL 对其每个 ToolDefinition 施加 `validateTool` 的全部校验规则，并汇集所产出的全部 ToolError。
3. IF 一个 ToolRegistry 中存在两个或更多 ToolDefinition 持有相同的 Tool_Id，THEN THE Agent_Tool_System SHALL 产出一条 ToolErrorCode 为 `TOOL_DUPLICATE_ID` 的 ToolError，并定位该重复的 Tool_Id。
4. WHEN 一个 ToolRegistry 的全部 ToolDefinition 均通过 `validateTool` 且无重复 Tool_Id，THE Agent_Tool_System SHALL 返回 `valid` 为真且 ToolError 组为空的 Registry_Validation_Result。
5. THE Agent_Tool_System SHALL 以确定且稳定的顺序排列 Registry_Validation_Result 中的 ToolError，并对相同输入返回相同结果（校验确定性）。
6. FOR ALL 通过 `validateRegistry` 的 ToolRegistry，THE Agent_Tool_System SHALL 保证 `listTools` 所返回每个 ToolDefinition 单独施加 `validateTool` 时亦 `valid` 为真（注册表合法蕴含逐项合法）。

### Requirement 11: 错误码枚举与跨层互斥

**User Story:** 作为编排引擎开发者，我想要所有错误携带稳定且与前序各层互不冲突的错误码，以便跨层聚合并程序化区分错误来源。

#### Acceptance Criteria

1. THE Agent_Tool_System SHALL 使每条 ToolError 携带一个取值于 ToolErrorCode 枚举的稳定错误码，且该枚举至少包含 `TOOL_DUPLICATE_ID`、`TOOL_NOT_FOUND`、`TOOL_EMPTY_ID`、`TOOL_EMPTY_NAME`、`TOOL_EMPTY_PARAM_NAME`、`TOOL_DUPLICATE_PARAM`、`TOOL_EMPTY_TAG`、`TOOL_MISSING_REQUIRED_ARGUMENT`、`TOOL_UNKNOWN_ARGUMENT`、`TOOL_ARGUMENT_TYPE_MISMATCH`、`TOOL_MALFORMED_JSON`。
2. THE Agent_Tool_System SHALL 使 ToolErrorCode 的取值集合与前序子规格的 `ErrorCode`（workflow-graph-model）取值集合不相交。
3. THE Agent_Tool_System SHALL 使 ToolErrorCode 的取值集合与前序子规格的 `Config_Error_Code`（workflow-node-types）取值集合不相交。
4. THE Agent_Tool_System SHALL 使 ToolErrorCode 的取值集合与前序子规格的 `Executor_Error_Code`（workflow-execution-engine）取值集合不相交。
5. THE Agent_Tool_System SHALL 使 ToolErrorCode 的取值集合与前序子规格的 `AgentErrorCode`（agent-definition-registry）取值集合不相交。
6. THE Agent_Tool_System SHALL 使每条 ToolError 携带一条人类可读的描述字符串，并在与某具体 Tool_Id、Param_Name 或字段名相关时于其定位信息中记录该标识。

### Requirement 12: 规范化 (normalizeTool)

**User Story:** 作为编排引擎开发者，我想要每个工具定义有唯一的规范形式，以便工具可被稳定地比较、去重与存储。

#### Acceptance Criteria

1. THE Agent_Tool_System SHALL 提供纯函数 `normalizeTool(tool)`，将一个 ToolDefinition 转换为其 Canonical_Tool 形式。
2. WHEN `normalizeTool` 规范化一个 ToolDefinition，THE Agent_Tool_System SHALL 将其 Tag_Set 以确定顺序排序去重、将其 Parameter_Schema 以 Param_Name 确定顺序排序并对重复 Param_Name 去重（保留首现）。
3. FOR ALL ToolDefinition `t`，THE Agent_Tool_System SHALL 使 `normalizeTool(normalizeTool(t))` 等于 `normalizeTool(t)`（规范化幂等性）。
4. FOR ALL 两个语义等价（字段内容相同，仅 Tag 或 Parameter 顺序不同）的 ToolDefinition，THE Agent_Tool_System SHALL 使 `normalizeTool` 对二者产出相等的 Canonical_Tool（规范形式唯一）。
5. FOR ALL ToolDefinition `t`，WHEN `t` 已为 Canonical_Tool 形式，THE Agent_Tool_System SHALL 使 `normalizeTool(t)` 等于 `t`（规范形式为规范化的不动点）。
6. THE Agent_Tool_System SHALL 使 `normalizeTool` 保持 ToolDefinition 的 Tool_Id、Tool_Name、Tool_Description、Result_Type 与每个 ParameterDef 的 Param_Type/Required 在语义上不变（规范化不改变这些字段的语义内容）。

### Requirement 13: 序列化与往返恒等 (serializeRegistry / deserializeRegistry)

**User Story:** 作为编排引擎开发者，我想要注册表的规范化 JSON 序列化与可靠反序列化，以便注册表可被存储、传输并无损还原。

#### Acceptance Criteria

1. THE Agent_Tool_System SHALL 提供纯函数 `serializeRegistry(registry)`，将任意 ToolRegistry 渲染为 Registry_Json 字符串。
2. THE Agent_Tool_System SHALL 提供纯函数 `deserializeRegistry(json)`，将一个合法的 Registry_Json 字符串还原为 ToolRegistry。
3. FOR ALL ToolRegistry `r`，THE Agent_Tool_System SHALL 使 `deserializeRegistry(serializeRegistry(r))` 得到与规范化后的 `r`（每个 ToolDefinition 经 `normalizeTool`）语义相等的 ToolRegistry（序列化往返恒等）。
4. FOR ALL 由 `serializeRegistry` 产出的 Registry_Json 字符串 `j`，THE Agent_Tool_System SHALL 使 `serializeRegistry(deserializeRegistry(j))` 等于 `j`（规范化字符串往返恒等）。
5. FOR ALL 两个语义等价的 ToolRegistry，THE Agent_Tool_System SHALL 使 `serializeRegistry` 对二者产出逐字符相同的 Registry_Json（规范化输出唯一）。
6. IF `deserializeRegistry` 接收一个不符合 Registry_Json 结构的字符串，THEN THE Agent_Tool_System SHALL 返回一个 ToolErrorCode 为 `TOOL_MALFORMED_JSON` 的失败结果，并指明解析失败的原因，而非产出一个 ToolRegistry。
7. WHEN `deserializeRegistry` 成功还原一个 ToolRegistry，THE Agent_Tool_System SHALL 保留每个 ToolDefinition 的 Tool_Id、Tool_Name、Tool_Description、Parameter_Schema、Result_Type 与 Tag_Set 全部组成部分。

### Requirement 14: 参数绑定校验 (validateArguments)

**User Story:** 作为编排引擎开发者，我想要纯粹地校验一组实参是否满足某工具的参数模式，以便在不执行工具的前提下确保调用契约成立。

#### Acceptance Criteria

1. THE Agent_Tool_System SHALL 提供纯函数 `validateArguments(tool, argumentMap)`，输入一个 ToolDefinition 与一个 Argument_Map（Param_Name → 实参 PortType），输出一个 Argument_Validation_Result。
2. IF `tool` 的 Parameter_Schema 中某个 Required 为真的 ParameterDef 的 Param_Name 不存在于 `argumentMap`，THEN THE Agent_Tool_System SHALL 产出一条 ToolErrorCode 为 `TOOL_MISSING_REQUIRED_ARGUMENT` 的 ToolError，并定位该 Param_Name。
3. IF `argumentMap` 含某个不对应 `tool` 任何 ParameterDef 的 Param_Name，THEN THE Agent_Tool_System SHALL 产出一条 ToolErrorCode 为 `TOOL_UNKNOWN_ARGUMENT` 的 ToolError，并定位该 Param_Name。
4. IF `argumentMap` 中某个 Param_Name 对应的实参 PortType 不能赋值 (依前序层 `isAssignable`) 给 `tool` 中同名 ParameterDef 的 Param_Type，THEN THE Agent_Tool_System SHALL 产出一条 ToolErrorCode 为 `TOOL_ARGUMENT_TYPE_MISMATCH` 的 ToolError，并定位该 Param_Name。
5. WHEN 全部必需参数齐备、无未知参数且所有同名实参类型均可赋值，THE Agent_Tool_System SHALL 返回 `valid` 为真且 ToolError 组为空的 Argument_Validation_Result。
6. THE Agent_Tool_System SHALL 在单次校验中报告全部违规、不在首错处停止，并以确定且稳定的顺序排列这些 ToolError，对相同输入返回相同结果（校验确定性）。
7. THE Agent_Tool_System SHALL 不要求实参提供非必需参数；缺失的非必需参数不产出任何 ToolError。

### Requirement 15: 与工作流/智能体层的桥接 (toolConfigToToolName / isToolReferencedBy)

**User Story:** 作为编排引擎开发者，我想要纯粹地把工作流 `tool` 节点配置与智能体工具绑定关联到工具定义，以便上层在不重复声明的情况下解析引用。

#### Acceptance Criteria

1. THE Agent_Tool_System SHALL 提供纯函数 `toolConfigToToolName(toolConfig)`，返回前序层 `ToolConfig` 的 `Tool_Name` 字段，作为查询 ToolRegistry 的依据，纯数据读取、不修改输入。
2. THE Agent_Tool_System SHALL 提供纯函数 `isToolReferencedBy(tool, agent)`，WHEN `agent` 的 Tool_Binding_List 含某 ToolBinding 其 Tool_Id 等于 `tool` 的 Tool_Id THEN 返回真，否则返回假，纯数据判定、不修改输入。
3. THE Agent_Tool_System SHALL 使 `isToolReferencedBy` 对相同输入返回相同结果，且不修改输入 `tool` 或 `agent`（确定性与不可变性）。
4. THE Agent_Tool_System SHALL 使 `toolConfigToToolName` 与 `isToolReferencedBy` 均不发起任何执行、I/O 或网络访问（纯数据变换）。

### Requirement 16: 查询派生——标签索引与按工具引用查找的一致性

**User Story:** 作为编排引擎开发者，我想要标签索引与按引用查找的派生结果确定且与逐项查询一致，以便高效检索而不损失正确性。

#### Acceptance Criteria

1. THE Agent_Tool_System SHALL 提供纯函数 `buildToolIndex(registry)`，返回一个 Tool_Index（从 Tag 到持有该 Tag 的 Tool_Id 集合的映射）。
2. FOR ALL ToolRegistry `r` 与 Tag `t`，THE Agent_Tool_System SHALL 使 `buildToolIndex(r)` 中 `t` 对应的 Tool_Id 集合恰好等于 `listByTag(r, t)` 所返回 ToolDefinition 的 Tool_Id 集合（标签索引与列举一致）。
3. FOR ALL ToolRegistry `r`，THE Agent_Tool_System SHALL 对相同输入返回相同的 Tool_Index（派生确定性）。
4. FOR ALL ToolRegistry `r` 与 Tag `t`，THE Agent_Tool_System SHALL 使 `listByTag(r, t)` 所返回的每个 ToolDefinition 的 Tag_Set 均含 `t`，且 `r` 中其余 ToolDefinition 均不含（按标签列举的完备且精确）。
