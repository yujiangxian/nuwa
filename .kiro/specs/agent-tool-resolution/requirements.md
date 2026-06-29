# Requirements Document

## Introduction

「智能体工具解析」(agent-tool-resolution) 是女娲 Nuwa「多智能体工作流编排引擎」的**第六个子规格**，构建于已实现的五个前序子规格之上：

- **工作流图模型** (workflow-graph-model, `app/web/src/lib/workflow/`)：`PortType`、`isAssignable` 与基础层 `ErrorCode`。
- **工作流节点类型** (workflow-node-types, `app/web/src/lib/workflow/nodeTypes/`)：`ToolConfig`（含 `Tool_Name`、`Argument_Bindings`，每个绑定含 `portId`、`argName`、`portType`）与 `Config_Error_Code`。
- **工作流执行引擎** (workflow-execution-engine, `app/web/src/lib/workflow/engine/`)：`Executor_Error_Code`。
- **智能体定义注册表** (agent-definition-registry, `app/web/src/lib/agents/`)：`AgentDefinition`、`ToolBinding`（含 `Tool_Id`）、`AgentRegistry`、`AgentErrorCode`。
- **智能体工具系统** (agent-tool-system, `app/web/src/lib/tools/`)：`ToolDefinition`、`Parameter_Schema`、`ToolRegistry`、`getTool`、`validateArguments`、`Argument_Map`、`ToolErrorCode`。

本子规格 (agent-tool-resolution) 的职责是定义一个**纯的库**，用于把「智能体的工具绑定」与「工作流工具节点的实参绑定」**解析**到具体的 `ToolDefinition` 并**交叉校验**其一致性——即：智能体声明的每个 `Tool_Id` 是否存在于工具注册表、工作流 `tool` 节点的实参绑定是否满足所引用工具的参数模式、并派生智能体的能力索引 (Capability_Index)。实现位于 `app/web/src/lib/resolution/`。

**核心约束（关键设计原则）**：本子规格必须是**纯数据 + 纯函数**的库，**不含任何 I/O、不依赖 React、不发起任何网络访问、不执行任何工具或工作流**，亦不含可变全局状态、时间或随机依赖。所有错误都建模为带稳定错误码 (ResolutionErrorCode) 的 ResolutionError 值，其取值集合与前序五层的错误码取值集合互不相交。本层不重定义前序类型，仅以类型/函数引用接入。

本子规格的范围限定为以下相互关联、作为整体交付的目标：

1. **解析数据模型**：`ResolvedToolBinding`（一个 `Tool_Id` 与其在工具注册表中解析得到的 `ToolDefinition` 配对）、`AgentResolution`（一个智能体的全部已解析工具绑定与未解析 `Tool_Id` 列表）。
2. **智能体工具解析** (`resolveAgentTools`)：纯粹地按智能体的 `Tool_Binding_List` 在 `ToolRegistry` 中查找每个 `Tool_Id`，划分为「已解析」与「未解析（悬空）」两部分，全函数、不抛异常。
3. **悬空引用校验** (`validateAgentToolRefs` / `validateRegistriesConsistency`)：对每个未解析 `Tool_Id` 产出 `RESOLUTION_TOOL_NOT_FOUND`；对一对 (AgentRegistry, ToolRegistry) 聚合校验全部智能体的全部绑定。
4. **工作流工具节点实参解析校验** (`resolveToolNodeArguments`)：按 `ToolConfig` 的 `Tool_Name` 在 `ToolRegistry` 中查找工具；找不到产出 `RESOLUTION_TOOL_NOT_FOUND`；找到则把 `Argument_Bindings` 投影为 `Argument_Map`（`argName` → `portType`），委托前序层 `validateArguments` 校验并将其结果纳入解析校验结果。
5. **能力索引派生** (`buildCapabilityIndex` / `agentCapabilities`)：纯粹地从一个智能体已解析工具的标签集合并集派生其能力 (Capability) 集合，以及从一对注册表派生「能力 → 持有该能力的 Agent_Id 集合」的索引。
6. **查询确定性与不可变性**：全部函数对相同输入返回相同输出，且不就地修改任何输入。

本子规格仅产出本解析层的需求与纯函数契约，**不做任何实现**。前序子规格已定义的类型与函数在本文档中仅以散文引用，不重新定义。

## Glossary

- **Agent_Tool_Resolution**: 本子规格定义的整体模块（解析数据模型 + 解析/交叉校验/能力派生等纯函数库），位于 `app/web/src/lib/resolution/`。
- **ResolvedToolBinding**: 一个 `Tool_Id` 与其在 `ToolRegistry` 中解析得到的 `ToolDefinition` 的配对。
- **AgentResolution**: 对一个 `AgentDefinition` 解析的结果，含其全部 `ResolvedToolBinding`（已解析）与全部未解析 `Tool_Id` 列表（悬空引用），二者均以确定顺序排列。
- **Unresolved_Tool_Id**: 一个出现在智能体 `Tool_Binding_List` 中、但不存在于 `ToolRegistry` 的 `Tool_Id`。
- **Capability**: 一个 `Tag` 字符串，来自某个已解析 `ToolDefinition` 的 `Tag_Set`；一个智能体的能力集合是其全部已解析工具的 `Tag_Set` 的并集。
- **Capability_Index**: 从一对 (AgentRegistry, ToolRegistry) 派生的、从 Capability 到持有该 Capability 的 Agent_Id 集合的映射。
- **Argument_Map**: 前序层 (agent-tool-system) 定义的从 `Param_Name`/`argName` 到 `PortType` 的映射，本子规格仅以散文引用并构造之。
- **ResolutionError**: 单条错误值，含 ResolutionErrorCode、定位信息（涉及的 Agent_Id / Tool_Id / Tool_Name / Param_Name / 字段名等）与人类可读描述。
- **ResolutionErrorCode**: ResolutionError 的稳定枚举标识，其取值集合与前序子规格的 `ErrorCode`、`Config_Error_Code`、`Executor_Error_Code`、`AgentErrorCode`、`ToolErrorCode` 取值集合互不相交。
- **Resolution_Validation_Result**: 校验函数的结果，含布尔 `valid` 与一组 ResolutionError（valid 为真时该组为空）。
- **AgentRegistry**: 前序层 (agent-definition-registry) 定义的以 Agent_Id 为键的智能体集合。本子规格仅以散文引用。
- **ToolRegistry**: 前序层 (agent-tool-system) 定义的以 Tool_Id 为键的工具集合。本子规格仅以散文引用。
- **ToolDefinition / ToolBinding / AgentDefinition / ToolConfig / Parameter_Schema / PortType**: 前序子规格定义的类型，本子规格仅以散文引用，不重新定义。
- **Listing_Order**: 确定的排序规则：字符串按 UTF-16 码元字典序升序；ResolvedToolBinding 按其 `Tool_Id` 排序；Unresolved_Tool_Id 列表按字典序排序。
- **Determinism**: 纯函数对相同输入恒产出相同输出的确定性性质。
- **Idempotence**: 一个操作施加一次与施加多次结果相同的幂等性质。

## Requirements

### Requirement 1: 模块范围与纯库约束

**User Story:** 作为编排引擎开发者，我想要一个不含 I/O、网络与 React 依赖、且不执行任何工具或工作流的纯解析库，以便其行为完全确定且可用属性测试验证。

#### Acceptance Criteria

1. THE Agent_Tool_Resolution SHALL 仅由纯函数与不可变类型构成，不包含 I/O、网络访问、React 依赖、可变全局状态、时间或随机依赖。
2. THE Agent_Tool_Resolution SHALL 仅以散文与类型引用前序子规格中已定义的类型与函数（如 `PortType`、`isAssignable`、`ToolConfig`、`AgentDefinition`、`ToolBinding`、`AgentRegistry`、`ToolDefinition`、`ToolRegistry`、`getTool`、`validateArguments`、`Argument_Map`、各层 `ErrorCode`），而不重新定义它们。
3. FOR ALL Agent_Tool_Resolution 对外暴露的函数，THE Agent_Tool_Resolution SHALL 对相同输入返回相同输出（确定性）。
4. THE Agent_Tool_Resolution SHALL 不就地修改任何输入的 AgentDefinition、ToolDefinition、AgentRegistry、ToolRegistry 或 ToolConfig，所有结果均以新值返回（不可变性）。
5. THE Agent_Tool_Resolution SHALL 不执行任何工具或工作流、不产生任何副作用；其全部函数均为纯数据变换或校验。

### Requirement 2: 解析数据模型

**User Story:** 作为编排引擎开发者，我想要明确的解析结果数据模型，以便统一表达「绑定到具体工具」与「悬空引用」。

#### Acceptance Criteria

1. THE Agent_Tool_Resolution SHALL 将 ResolvedToolBinding 定义为由一个 Tool_Id 与一个 ToolDefinition 组成的不可变结构。
2. THE Agent_Tool_Resolution SHALL 将 AgentResolution 定义为由一个 Agent_Id、一个 ResolvedToolBinding 的有序列表与一个 Unresolved_Tool_Id 的有序列表组成的不可变结构。
3. THE Agent_Tool_Resolution SHALL 使 AgentResolution 中 ResolvedToolBinding 列表按其 Tool_Id 以 Listing_Order 排列，使 Unresolved_Tool_Id 列表按字典序排列。
4. THE Agent_Tool_Resolution SHALL 使解析数据模型的判等基于其全部字段的语义内容。

### Requirement 3: 智能体工具解析 (resolveAgentTools)

**User Story:** 作为编排引擎开发者，我想要把一个智能体的工具绑定解析到具体工具定义并识别悬空引用，以便后续装配与校验。

#### Acceptance Criteria

1. THE Agent_Tool_Resolution SHALL 提供纯函数 `resolveAgentTools(agent, toolRegistry)`，返回一个 AgentResolution，且为全函数（不抛异常）。
2. WHEN `resolveAgentTools` 处理一个智能体的 Tool_Binding_List，THE Agent_Tool_Resolution SHALL 对每个 Tool_Id 在 toolRegistry 中查找：存在则纳入 ResolvedToolBinding（携带查得的 ToolDefinition），不存在则纳入 Unresolved_Tool_Id 列表。
3. FOR ALL `agent` 与 `toolRegistry`，THE Agent_Tool_Resolution SHALL 使 AgentResolution 中已解析的 Tool_Id 集合与未解析的 Tool_Id 集合互不相交，且二者之并等于 agent 的 Tool_Binding_List 中出现的 Tool_Id 集合（解析划分完备）。
4. FOR ALL ResolvedToolBinding `rb`（由 `resolveAgentTools(agent, toolRegistry)` 产出），THE Agent_Tool_Resolution SHALL 使 `rb` 携带的 ToolDefinition 等于 `getTool(toolRegistry, rb 的 Tool_Id)` 所返回的 ToolDefinition（解析忠实于注册表）。
5. THE Agent_Tool_Resolution SHALL 使 AgentResolution 的 Agent_Id 等于输入 agent 的 Agent_Id。

### Requirement 4: 悬空引用校验 (validateAgentToolRefs)

**User Story:** 作为编排引擎开发者，我想要明确地报告一个智能体引用了哪些不存在的工具，以便在装配前发现配置错误。

#### Acceptance Criteria

1. THE Agent_Tool_Resolution SHALL 提供纯函数 `validateAgentToolRefs(agent, toolRegistry)`，返回一个 Resolution_Validation_Result。
2. IF 一个智能体的 Tool_Binding_List 含一个不存在于 toolRegistry 的 Tool_Id，THEN THE Agent_Tool_Resolution SHALL 产出一条 ResolutionErrorCode 为 `RESOLUTION_TOOL_NOT_FOUND` 的 ResolutionError，并定位该 Agent_Id 与该 Tool_Id。
3. WHEN 一个智能体的全部 Tool_Id 均存在于 toolRegistry，THE Agent_Tool_Resolution SHALL 返回 `valid` 为真且 ResolutionError 组为空的 Resolution_Validation_Result。
4. THE Agent_Tool_Resolution SHALL 在单次校验中报告全部悬空引用、不在首条错误处停止，并以确定且稳定的顺序排列这些 ResolutionError，对相同输入返回相同结果。
5. FOR ALL `agent` 与 `toolRegistry`，THE Agent_Tool_Resolution SHALL 使 `validateAgentToolRefs(agent, toolRegistry).valid` 为真**当且仅当** `resolveAgentTools(agent, toolRegistry)` 的 Unresolved_Tool_Id 列表为空。

### Requirement 5: 注册表一致性校验 (validateRegistriesConsistency)

**User Story:** 作为编排引擎开发者，我想要一次性校验整个智能体注册表对工具注册表的引用一致性，以便整体装配前确认无悬空引用。

#### Acceptance Criteria

1. THE Agent_Tool_Resolution SHALL 提供纯函数 `validateRegistriesConsistency(agentRegistry, toolRegistry)`，返回一个 Resolution_Validation_Result。
2. WHEN `validateRegistriesConsistency` 校验一对注册表，THE Agent_Tool_Resolution SHALL 对 agentRegistry 中每个智能体施加 `validateAgentToolRefs` 的全部规则并汇集所产出的全部 ResolutionError。
3. WHEN agentRegistry 中全部智能体的全部 Tool_Id 均存在于 toolRegistry，THE Agent_Tool_Resolution SHALL 返回 `valid` 为真且 ResolutionError 组为空的 Resolution_Validation_Result。
4. THE Agent_Tool_Resolution SHALL 以确定且稳定的顺序排列结果中的 ResolutionError（先按 Agent_Id 再按 Tool_Id 字典序），并对相同输入返回相同结果。

### Requirement 6: 工作流工具节点实参解析校验 (resolveToolNodeArguments)

**User Story:** 作为编排引擎开发者，我想要校验一个工作流 `tool` 节点的实参绑定是否满足其所引用工具的参数模式，以便在执行前确保调用契约成立。

#### Acceptance Criteria

1. THE Agent_Tool_Resolution SHALL 提供纯函数 `resolveToolNodeArguments(toolConfig, toolRegistry)`，返回一个 Resolution_Validation_Result。
2. IF `toolConfig` 的 Tool_Name 不存在于 toolRegistry，THEN THE Agent_Tool_Resolution SHALL 产出一条 ResolutionErrorCode 为 `RESOLUTION_TOOL_NOT_FOUND` 的 ResolutionError，并定位该 Tool_Name，且不再进行实参类型校验。
3. WHEN `toolConfig` 的 Tool_Name 存在于 toolRegistry，THE Agent_Tool_Resolution SHALL 将 `toolConfig` 的 Argument_Bindings 投影为一个 Argument_Map（从 argName 到 portType），并以所查得工具委托前序层 `validateArguments` 进行校验。
4. WHEN 前序层 `validateArguments` 产出一个或多个错误，THE Agent_Tool_Resolution SHALL 产出对应的 ResolutionError（其 ResolutionErrorCode 为 `RESOLUTION_ARGUMENT_INVALID`），保留所涉 Param_Name 的定位信息，并使本结果 `valid` 为假。
5. WHEN 所查得工具存在且其实参绑定满足参数模式，THE Agent_Tool_Resolution SHALL 返回 `valid` 为真且 ResolutionError 组为空的 Resolution_Validation_Result。
6. IF `toolConfig` 的 Argument_Bindings 含重复的 argName，THEN THE Agent_Tool_Resolution SHALL 产出一条 ResolutionErrorCode 为 `RESOLUTION_DUPLICATE_ARGUMENT` 的 ResolutionError，并定位该 argName。
7. THE Agent_Tool_Resolution SHALL 在单次校验中报告全部违规、不在首条错误处停止（Tool_Name 不存在的情形除外），并以确定且稳定的顺序排列这些 ResolutionError，对相同输入返回相同结果。

### Requirement 7: 错误码枚举与跨层互斥

**User Story:** 作为编排引擎开发者，我想要所有错误携带稳定且与前序各层互不冲突的错误码，以便跨层聚合并程序化区分错误来源。

#### Acceptance Criteria

1. THE Agent_Tool_Resolution SHALL 使每条 ResolutionError 携带一个取值于 ResolutionErrorCode 枚举的稳定错误码，且该枚举至少包含 `RESOLUTION_TOOL_NOT_FOUND`、`RESOLUTION_AGENT_NOT_FOUND`、`RESOLUTION_ARGUMENT_INVALID`、`RESOLUTION_DUPLICATE_ARGUMENT`。
2. THE Agent_Tool_Resolution SHALL 使 ResolutionErrorCode 的取值集合与前序子规格的 `ErrorCode`（workflow-graph-model）取值集合不相交。
3. THE Agent_Tool_Resolution SHALL 使 ResolutionErrorCode 的取值集合与前序子规格的 `Config_Error_Code`（workflow-node-types）取值集合不相交。
4. THE Agent_Tool_Resolution SHALL 使 ResolutionErrorCode 的取值集合与前序子规格的 `Executor_Error_Code`（workflow-execution-engine）取值集合不相交。
5. THE Agent_Tool_Resolution SHALL 使 ResolutionErrorCode 的取值集合与前序子规格的 `AgentErrorCode`（agent-definition-registry）取值集合不相交。
6. THE Agent_Tool_Resolution SHALL 使 ResolutionErrorCode 的取值集合与前序子规格的 `ToolErrorCode`（agent-tool-system）取值集合不相交。
7. THE Agent_Tool_Resolution SHALL 使每条 ResolutionError 携带一条人类可读的描述字符串，并在与某具体 Agent_Id、Tool_Id、Tool_Name 或 Param_Name 相关时于其定位信息中记录该标识。

### Requirement 8: 能力索引派生 (agentCapabilities / buildCapabilityIndex)

**User Story:** 作为编排引擎开发者，我想要从已解析工具派生智能体的能力集合与全局能力索引，以便按能力检索智能体。

#### Acceptance Criteria

1. THE Agent_Tool_Resolution SHALL 提供纯函数 `agentCapabilities(agent, toolRegistry)`，返回该智能体全部已解析工具的 Tag_Set 之并集（一个 Capability 的集合），不含重复。
2. FOR ALL `agent` 与 `toolRegistry`，THE Agent_Tool_Resolution SHALL 使 `agentCapabilities(agent, toolRegistry)` 仅包含来自已解析工具的 Tag，且每个这样的 Tag 均出现于至少一个已解析工具的 Tag_Set（能力派生忠实且完备）。
3. THE Agent_Tool_Resolution SHALL 提供纯函数 `buildCapabilityIndex(agentRegistry, toolRegistry)`，返回一个 Capability_Index（从 Capability 到持有该 Capability 的 Agent_Id 集合的映射）。
4. FOR ALL (agentRegistry, toolRegistry) 与 Capability `c`，THE Agent_Tool_Resolution SHALL 使 `buildCapabilityIndex(agentRegistry, toolRegistry)` 中 `c` 对应的 Agent_Id 集合恰好等于「`agentCapabilities(agent, toolRegistry)` 含 `c` 的全部 agent 的 Agent_Id 集合」（索引与逐项派生一致）。
5. FOR ALL (agentRegistry, toolRegistry)，THE Agent_Tool_Resolution SHALL 对相同输入返回相同的 Capability_Index（派生确定性）。

### Requirement 9: 解析的确定性、稳定顺序与不可变性

**User Story:** 作为编排引擎开发者，我想要解析与校验的输出确定、稳定排序且不改动输入，以便结果可稳定地比较、展示与缓存。

#### Acceptance Criteria

1. FOR ALL `agent` 与 `toolRegistry`，THE Agent_Tool_Resolution SHALL 使 `resolveAgentTools` 两次调用返回语义相等的 AgentResolution（解析确定性）。
2. THE Agent_Tool_Resolution SHALL 使 `resolveAgentTools` 产出的 ResolvedToolBinding 列表按 Tool_Id 以 Listing_Order 排列、Unresolved_Tool_Id 列表按字典序排列，且二列表均不含重复 Tool_Id（稳定且去重）。
3. FOR ALL 解析与校验函数，THE Agent_Tool_Resolution SHALL 在调用后保持输入的 agent、toolRegistry、agentRegistry、toolConfig 不变（不可变性）。
4. FOR ALL `agent` 其 Tool_Binding_List 为空，THE Agent_Tool_Resolution SHALL 使 `resolveAgentTools(agent, toolRegistry)` 返回的 ResolvedToolBinding 列表与 Unresolved_Tool_Id 列表均为空，且 `validateAgentToolRefs` 返回 `valid` 为真（空绑定的平凡解析）。
