# Requirements Document

## Introduction

「工作流图模型」(workflow-graph-model) 是女娲 Nuwa「多智能体工作流编排引擎」(multi-agent workflow orchestration engine) 这一全新子系统的**基础子规格**。该编排引擎让用户以「图」的形式编排并运行由多个 AI 智能体节点（LLM 节点、条件/分支节点、工具调用节点、转换节点、人工输入节点、循环节点）组成的工作流。本子规格只负责整套引擎赖以建立的**纯数据模型层与纯函数层**——即工作流图的几何/拓扑层，不涉及执行、调度、持久化、UI 或任何外部副作用。

本子规格刻意保持对外部依赖的轻量，而将重心放在大量**纯函数、可用属性测试 (property-based testing) 验证**的能力上。其范围限定为以下相互关联、作为整体交付的目标：

1. **工作流图数据模型**：由带类型的 `WorkflowNode` 与有向 `WorkflowEdge` 构成的 `WorkflowGraph`；每个节点拥有唯一 id、节点类型标签 (NodeType)、带类型的配置载荷 (Node_Config) 以及带类型的输入/输出端口 (Port)；每条边连接源节点的一个输出端口与目标节点的一个输入端口。
2. **图校验** (Graph_Validation)：覆盖一组丰富且可测试的规则，包括节点 id 唯一性、边引用合法性、连接端口的类型兼容性、非循环子图的无环性、入口节点可达性、必需输入端口不悬空、循环节点回边良构、端口数量 (arity) 约束等。
3. **拓扑分析** (Topological_Analysis)：拓扑排序、分层 (layering)、可达性、不可达/孤立节点检测、环检测与环提取、关键路径/最长路径。
4. **图变更操作** (Graph_Mutation)：增删节点、增删边、替换节点配置等，均为纯操作并返回新的图，保持校验不变量。
5. **序列化** (Serialization)：`WorkflowGraph` 的规范化 JSON 形式，保证往返恒等 (`parse ∘ serialize = identity`)。
6. **端口类型系统** (Type_System)：一个小型结构化端口值类型系统（string、number、boolean、json、message、list\<T\>、optional\<T\>），其上的可赋值兼容关系 `isAssignable(from, to)` 必须满足自反性与传递性。

本子规格仅产出本数据模型层的需求与纯函数契约，**不做任何实现**，亦不依赖编排引擎其余尚未存在的子规格。

## Glossary

- **Workflow_Graph_Model**: 本子规格定义的整体模块（纯数据模型 + 纯函数库），是编排引擎的几何/拓扑基础层。
- **WorkflowGraph**: 一个工作流图，由一组 WorkflowNode、一组 WorkflowEdge 以及一组 LoopScope 声明组成，并标记一个 EntryNode。
- **WorkflowNode**: 工作流图中的一个节点，含唯一 Node_Id、一个 NodeType 标签、一个 Node_Config 配置载荷、一组 Input_Port 与一组 Output_Port。
- **Node_Id**: WorkflowNode 在所属 WorkflowGraph 内的唯一标识符字符串。
- **NodeType**: 节点类型标签，取值于受支持的类型集合：`llm`、`condition`、`tool`、`transform`、`human_input`、`loop`。
- **Node_Config**: WorkflowNode 携带的带类型配置载荷，其结构由该节点的 NodeType 决定。
- **Port**: 节点上的一个端口，含 Port_Id、所属方向（输入或输出）、一个 PortType、以及一个 Required 标志（仅对 Input_Port 有意义）。
- **Port_Id**: 一个 Port 在其所属 WorkflowNode 同一方向端口集合内的唯一标识符字符串。
- **Input_Port**: 方向为「输入」的 Port，作为 WorkflowEdge 的目标端点。
- **Output_Port**: 方向为「输出」的 Port，作为 WorkflowEdge 的源端点。
- **Required**: Input_Port 的布尔标志；为真时表示该输入端口必须被一条入边连接。
- **PortType**: 端口值的结构化类型，由 Type_System 定义，取值于：`string`、`number`、`boolean`、`json`、`message`、`list<T>`（T 为 PortType）、`optional<T>`（T 为 PortType）。
- **Type_System**: 定义 PortType 集合及其上 `isAssignable` 可赋值关系的小型结构化类型系统。
- **isAssignable(from, to)**: Type_System 提供的二元判定函数，判断 from 类型的值是否可被赋给期望 to 类型的端口。
- **WorkflowEdge**: 一条有向边，连接某源 WorkflowNode 的一个 Output_Port 与某目标 WorkflowNode 的一个 Input_Port，含 Edge_Id、Source_Endpoint、Target_Endpoint。
- **Edge_Id**: WorkflowEdge 在所属 WorkflowGraph 内的唯一标识符字符串。
- **Endpoint**: 边的一个端点，由 (Node_Id, Port_Id) 二元组确定；Source_Endpoint 指向一个 Output_Port，Target_Endpoint 指向一个 Input_Port。
- **EntryNode**: WorkflowGraph 声明的唯一入口节点，工作流执行的起点；由其 Node_Id 标记。
- **LoopScope**: 一个循环作用域声明，含 Loop_Scope_Id、一个类型为 `loop` 的 Loop_Header 节点 Node_Id、以及属于该作用域的成员节点 Node_Id 集合 (Loop_Body)。
- **Loop_Header**: NodeType 为 `loop` 的节点，作为某个 LoopScope 的头节点，是该作用域内合法回边 (Back_Edge) 的目标。
- **Loop_Body**: 隶属于某个 LoopScope 的节点 Node_Id 集合。
- **Back_Edge**: 目标端点位于其所属 LoopScope 的 Loop_Header、且源端点位于同一 LoopScope 的 Loop_Body 内的 WorkflowEdge；Back_Edge 是 WorkflowGraph 中唯一被允许形成环的边。
- **Forward_Subgraph**: WorkflowGraph 去除所有 Back_Edge 后得到的有向子图，要求无环 (acyclic)。
- **Graph_Validation**: 由 Graph_Validator 对一个 WorkflowGraph 执行的全部校验规则的总称。
- **Graph_Validator**: 执行 Graph_Validation 的纯函数组件，输入一个 WorkflowGraph，输出一个 Validation_Result。
- **Validation_Result**: 校验结果，含一个布尔 `valid` 与一组 Validation_Error（valid 为真时该组为空）。
- **Validation_Error**: 单条校验错误，含 Error_Code（枚举码）、定位信息（涉及的 Node_Id/Edge_Id/Port_Id）与人类可读描述。
- **Error_Code**: Validation_Error 的稳定枚举标识，用于程序化区分错误类别。
- **Valid_Graph**: 通过 Graph_Validation（Validation_Result.valid 为真）的 WorkflowGraph。
- **Graph_Analyzer**: 执行 Topological_Analysis 的纯函数组件。
- **Topological_Analysis**: 在 Forward_Subgraph 上进行的拓扑相关分析的总称。
- **Topological_Order**: Forward_Subgraph 节点的一个线性排列，使每条非回边的源节点排在目标节点之前。
- **Layering**: 对 Forward_Subgraph 节点的分层赋值，EntryNode 层号为 0，每个节点层号等于其所有前驱层号最大值加一。
- **Reachable_Node**: 在 Forward_Subgraph 中从 EntryNode 沿有向边可达的 WorkflowNode。
- **Orphan_Node**: 在 Forward_Subgraph 中既非 EntryNode、又无任何入边的 WorkflowNode。
- **Unreachable_Node**: 不属于 Reachable_Node 集合的 WorkflowNode。
- **Cycle**: WorkflowGraph 中一条首尾相接的有向边序列构成的环。
- **Critical_Path**: Forward_Subgraph 中从 EntryNode 出发的最长有向路径（按节点数计权）。
- **Graph_Mutation**: 对 WorkflowGraph 的纯变更操作总称，均不修改输入图而返回新图。
- **Graph_Mutator**: 执行 Graph_Mutation 的纯函数组件。
- **Graph_Serializer**: 执行 Serialization 与反序列化的纯函数组件。
- **Canonical_Json**: WorkflowGraph 的规范化 JSON 表示，键顺序与集合顺序确定，保证序列化输出对语义相等的图唯一。
- **Round_Trip**: 对一个 WorkflowGraph 先序列化再反序列化（或先反序列化再序列化）应得到语义等价结果的往返性质。

## Requirements

### Requirement 1: 工作流图数据模型结构

**User Story:** 作为编排引擎开发者，我想要一个结构清晰的工作流图数据模型，以便在其之上构建校验、分析与执行能力。

#### Acceptance Criteria

1. THE Workflow_Graph_Model SHALL 将一个 WorkflowGraph 表示为「WorkflowNode 集合、WorkflowEdge 集合、LoopScope 声明集合、以及一个标记 EntryNode 的 Node_Id」四部分组成的结构。
2. THE Workflow_Graph_Model SHALL 为每个 WorkflowNode 提供 Node_Id、NodeType、Node_Config、Input_Port 集合与 Output_Port 集合五个组成部分。
3. THE Workflow_Graph_Model SHALL 限定 NodeType 取值于集合 `{ llm, condition, tool, transform, human_input, loop }`。
4. THE Workflow_Graph_Model SHALL 将每个 WorkflowEdge 表示为「Edge_Id、Source_Endpoint、Target_Endpoint」三部分组成的结构，其中 Source_Endpoint 指向一个 Output_Port，Target_Endpoint 指向一个 Input_Port。
5. THE Workflow_Graph_Model SHALL 将每个 Endpoint 表示为 (Node_Id, Port_Id) 二元组。
6. THE Workflow_Graph_Model SHALL 提供构造一个空 WorkflowGraph（无 WorkflowNode、无 WorkflowEdge、无 LoopScope）的纯构造函数。

### Requirement 2: 端口模型

**User Story:** 作为编排引擎开发者，我想要带类型与方向的端口定义，以便描述节点之间可连接的数据接口。

#### Acceptance Criteria

1. THE Workflow_Graph_Model SHALL 为每个 Port 提供 Port_Id、方向（输入或输出）、PortType 与 Required 四个组成部分。
2. THE Workflow_Graph_Model SHALL 要求每个 Input_Port 携带一个 Required 布尔标志。
3. WHERE 一个 Port 的方向为输出，THE Workflow_Graph_Model SHALL 将该 Output_Port 的 Required 标志视为不适用（在 Graph_Validation 中忽略）。
4. THE Workflow_Graph_Model SHALL 要求同一 WorkflowNode 同一方向的端口集合内 Port_Id 互不相同。
5. THE Workflow_Graph_Model SHALL 允许同一 WorkflowNode 的一个 Input_Port 与一个 Output_Port 使用相同的 Port_Id 字符串。

### Requirement 3: 端口类型系统与可赋值关系

**User Story:** 作为编排引擎开发者，我想要一个结构化端口类型系统及其可赋值关系，以便判断两个端口的连接在类型上是否合法。

#### Acceptance Criteria

1. THE Type_System SHALL 定义 PortType 取值于基础类型 `{ string, number, boolean, json, message }` 与复合类型 `list<T>`、`optional<T>`（T 为任意 PortType）。
2. THE Type_System SHALL 提供纯函数 `isAssignable(from, to)`，对任意两个 PortType 返回一个布尔判定。
3. FOR ALL PortType `t`，THE Type_System SHALL 使 `isAssignable(t, t)` 为真（自反性）。
4. FOR ALL PortType `a`、`b`、`c`，IF `isAssignable(a, b)` 为真且 `isAssignable(b, c)` 为真，THEN THE Type_System SHALL 使 `isAssignable(a, c)` 为真（传递性）。
5. FOR ALL PortType `t`，THE Type_System SHALL 使 `isAssignable(t, json)` 为真（任意类型可赋给 `json`）。
6. FOR ALL PortType `t`，THE Type_System SHALL 使 `isAssignable(t, optional<t>)` 为真。
7. FOR ALL PortType `a`、`b`，IF `isAssignable(a, b)` 为真，THEN THE Type_System SHALL 使 `isAssignable(list<a>, list<b>)` 为真（list 协变）。
8. FOR ALL PortType `a`、`b`，IF `isAssignable(a, b)` 为真，THEN THE Type_System SHALL 使 `isAssignable(optional<a>, optional<b>)` 为真。
9. IF `from` 为 `optional<a>` 且 `to` 为非 optional 且非 `json` 的基础类型，THEN THE Type_System SHALL 使 `isAssignable(from, to)` 为假（`json` 作为 5 中的全局顶类型不受此限制，仍可被任意类型赋值）。
10. THE Type_System SHALL 提供纯函数 `formatPortType(t)`，将任意 PortType 渲染为唯一的规范字符串表示。
11. THE Type_System SHALL 提供纯函数 `parsePortType(s)`，对由 `formatPortType` 产出的字符串还原出等价的 PortType。
12. FOR ALL PortType `t`，THE Type_System SHALL 使 `parsePortType(formatPortType(t))` 等于 `t`（类型表示往返性质）。

### Requirement 4: 校验——节点 id 唯一性

**User Story:** 作为编排引擎开发者，我想要图中节点 id 唯一，以便每个节点与每条边端点都能被无歧义地引用。

#### Acceptance Criteria

1. WHEN Graph_Validator 校验一个 WorkflowGraph，THE Graph_Validator SHALL 检查全部 WorkflowNode 的 Node_Id 互不相同。
2. IF 两个或更多 WorkflowNode 共享同一 Node_Id，THEN THE Graph_Validator SHALL 产出一条 Error_Code 为 `DUPLICATE_NODE_ID` 的 Validation_Error，并在其中列出冲突的 Node_Id。
3. WHEN Graph_Validator 校验一个 WorkflowGraph，THE Graph_Validator SHALL 检查全部 WorkflowEdge 的 Edge_Id 互不相同。
4. IF 两个或更多 WorkflowEdge 共享同一 Edge_Id，THEN THE Graph_Validator SHALL 产出一条 Error_Code 为 `DUPLICATE_EDGE_ID` 的 Validation_Error，并在其中列出冲突的 Edge_Id。

### Requirement 5: 校验——边引用合法性

**User Story:** 作为编排引擎开发者，我想要每条边都引用存在的节点与端口，以便图不含悬空连接。

#### Acceptance Criteria

1. WHEN Graph_Validator 校验一条 WorkflowEdge，THE Graph_Validator SHALL 检查其 Source_Endpoint 的 Node_Id 与 Target_Endpoint 的 Node_Id 均存在于该 WorkflowGraph 的 WorkflowNode 集合中。
2. IF 一条 WorkflowEdge 的某个 Endpoint 引用了不存在的 Node_Id，THEN THE Graph_Validator SHALL 产出一条 Error_Code 为 `EDGE_REFERENCES_MISSING_NODE` 的 Validation_Error，并定位该 Edge_Id 与缺失的 Node_Id。
3. WHEN Graph_Validator 校验一条 WorkflowEdge，THE Graph_Validator SHALL 检查其 Source_Endpoint 的 Port_Id 是源节点的一个 Output_Port，且其 Target_Endpoint 的 Port_Id 是目标节点的一个 Input_Port。
4. IF 一条 WorkflowEdge 的 Source_Endpoint 未对应到源节点的某个 Output_Port，THEN THE Graph_Validator SHALL 产出一条 Error_Code 为 `EDGE_REFERENCES_MISSING_PORT` 的 Validation_Error，并定位该 Edge_Id 与 Port_Id。
5. IF 一条 WorkflowEdge 的 Target_Endpoint 未对应到目标节点的某个 Input_Port，THEN THE Graph_Validator SHALL 产出一条 Error_Code 为 `EDGE_REFERENCES_MISSING_PORT` 的 Validation_Error，并定位该 Edge_Id 与 Port_Id。
6. IF 一条 WorkflowEdge 的 Source_Endpoint 与 Target_Endpoint 指向同一个 Node_Id，THEN THE Graph_Validator SHALL 产出一条 Error_Code 为 `SELF_LOOP_EDGE` 的 Validation_Error。

### Requirement 6: 校验——端口类型兼容性

**User Story:** 作为编排引擎开发者，我想要相连端口的类型兼容，以便数据能在节点之间安全流动。

#### Acceptance Criteria

1. WHEN Graph_Validator 校验一条引用合法的 WorkflowEdge，THE Graph_Validator SHALL 调用 `isAssignable(源 Output_Port 的 PortType, 目标 Input_Port 的 PortType)` 判断类型兼容性。
2. IF 一条 WorkflowEdge 连接的源 Output_Port 类型对目标 Input_Port 类型不可赋值，THEN THE Graph_Validator SHALL 产出一条 Error_Code 为 `INCOMPATIBLE_PORT_TYPES` 的 Validation_Error，并记录涉及的两个 PortType 的规范字符串表示。
3. WHEN `isAssignable` 判定为真，THE Graph_Validator SHALL 不就该条 WorkflowEdge 产出 `INCOMPATIBLE_PORT_TYPES` 的 Validation_Error。

### Requirement 7: 校验——端口数量 (arity) 约束

**User Story:** 作为编排引擎开发者，我想要约束每个输入端口的入边数量，以便每个输入接口在执行期有确定的数据来源。

#### Acceptance Criteria

1. WHEN Graph_Validator 校验一个 WorkflowGraph，THE Graph_Validator SHALL 对每个 Input_Port 统计以其为 Target_Endpoint 的 WorkflowEdge 数量。
2. IF 某个 Input_Port 被两条或更多 WorkflowEdge 同时作为 Target_Endpoint，THEN THE Graph_Validator SHALL 产出一条 Error_Code 为 `INPUT_PORT_ARITY_EXCEEDED` 的 Validation_Error，并定位该 Node_Id 与 Port_Id。
3. THE Graph_Validator SHALL 允许一个 Output_Port 作为零条、一条或多条 WorkflowEdge 的 Source_Endpoint（输出端口扇出不受上限约束）。

### Requirement 8: 校验——必需输入端口不悬空

**User Story:** 作为编排引擎开发者，我想要所有标记为必需的输入端口都被连接，以便不出现缺少必填输入的节点。

#### Acceptance Criteria

1. WHEN Graph_Validator 校验一个 WorkflowGraph，THE Graph_Validator SHALL 对每个 Required 为真的 Input_Port 检查是否存在至少一条以其为 Target_Endpoint 的 WorkflowEdge。
2. IF 某个 Required 为真的 Input_Port 没有任何入边，THEN THE Graph_Validator SHALL 产出一条 Error_Code 为 `MISSING_REQUIRED_INPUT` 的 Validation_Error，并定位该 Node_Id 与 Port_Id。
3. WHERE 一个 Input_Port 的 Required 为假，WHEN 该 Input_Port 没有任何入边，THE Graph_Validator SHALL 不产出 `MISSING_REQUIRED_INPUT` 的 Validation_Error。

### Requirement 9: 校验——入口节点与可达性

**User Story:** 作为编排引擎开发者，我想要图恰好有一个可达的入口节点，以便工作流执行有确定起点。

#### Acceptance Criteria

1. WHEN Graph_Validator 校验一个非空 WorkflowGraph，THE Graph_Validator SHALL 检查所标记的 EntryNode 的 Node_Id 存在于 WorkflowNode 集合中。
2. IF 一个非空 WorkflowGraph 标记的 EntryNode 不存在于其 WorkflowNode 集合中，THEN THE Graph_Validator SHALL 产出一条 Error_Code 为 `ENTRY_NODE_NOT_FOUND` 的 Validation_Error。
3. WHEN Graph_Validator 校验一个 WorkflowGraph，THE Graph_Validator SHALL 检查 EntryNode 在 Forward_Subgraph 中没有任何入边。
4. IF EntryNode 在 Forward_Subgraph 中存在入边，THEN THE Graph_Validator SHALL 产出一条 Error_Code 为 `ENTRY_NODE_HAS_INCOMING_EDGE` 的 Validation_Error。
5. WHEN Graph_Validator 校验一个 WorkflowGraph，THE Graph_Validator SHALL 计算 Reachable_Node 集合，并将不属于该集合的每个 WorkflowNode 标识为 Unreachable_Node。
6. IF 存在一个或多个 Unreachable_Node，THEN THE Graph_Validator SHALL 产出一条 Error_Code 为 `UNREACHABLE_NODE` 的 Validation_Error，并列出全部 Unreachable_Node 的 Node_Id。

### Requirement 10: 校验——非循环子图无环性

**User Story:** 作为编排引擎开发者，我想要除合法回边外的图保持无环，以便工作流的前向数据流可被拓扑排序。

#### Acceptance Criteria

1. WHEN Graph_Validator 校验一个 WorkflowGraph，THE Graph_Validator SHALL 通过排除全部 Back_Edge 构造 Forward_Subgraph。
2. WHEN Graph_Validator 校验 Forward_Subgraph，THE Graph_Validator SHALL 检查 Forward_Subgraph 不含任何 Cycle。
3. IF Forward_Subgraph 含有一个或多个 Cycle，THEN THE Graph_Validator SHALL 产出一条 Error_Code 为 `CYCLE_IN_FORWARD_SUBGRAPH` 的 Validation_Error，并在其中列出构成至少一个 Cycle 的有序 Node_Id 序列。

### Requirement 11: 校验——循环作用域与回边良构

**User Story:** 作为编排引擎开发者，我想要循环仅以良构的回边形式存在于声明的作用域内，以便循环结构受控且可分析。

#### Acceptance Criteria

1. WHEN Graph_Validator 校验一个 LoopScope，THE Graph_Validator SHALL 检查其 Loop_Header 的 Node_Id 存在且对应节点的 NodeType 为 `loop`。
2. IF 一个 LoopScope 的 Loop_Header 对应节点的 NodeType 不为 `loop`，THEN THE Graph_Validator SHALL 产出一条 Error_Code 为 `INVALID_LOOP_HEADER` 的 Validation_Error。
3. WHEN Graph_Validator 校验一条 Back_Edge，THE Graph_Validator SHALL 检查该 Back_Edge 的 Target_Endpoint 位于某个 LoopScope 的 Loop_Header、且其 Source_Endpoint 的 Node_Id 属于同一 LoopScope 的 Loop_Body。
4. IF 一条边形成了环但不满足 Back_Edge 的良构条件（目标非声明的 Loop_Header，或源不属于同一 LoopScope 的 Loop_Body），THEN THE Graph_Validator SHALL 产出一条 Error_Code 为 `MALFORMED_BACK_EDGE` 的 Validation_Error。
5. WHEN Graph_Validator 校验全部 LoopScope，THE Graph_Validator SHALL 检查每个 LoopScope 的 Loop_Scope_Id 互不相同。
6. IF 两个或更多 LoopScope 共享同一 Loop_Scope_Id，THEN THE Graph_Validator SHALL 产出一条 Error_Code 为 `DUPLICATE_LOOP_SCOPE_ID` 的 Validation_Error。
7. WHEN Graph_Validator 校验一个 LoopScope 的 Loop_Body，THE Graph_Validator SHALL 检查 Loop_Body 中的每个 Node_Id 均存在于 WorkflowNode 集合中。
8. IF 某个 LoopScope 的 Loop_Body 含有不存在于 WorkflowNode 集合的 Node_Id，THEN THE Graph_Validator SHALL 产出一条 Error_Code 为 `LOOP_BODY_REFERENCES_MISSING_NODE` 的 Validation_Error。

### Requirement 12: 校验结果聚合与确定性

**User Story:** 作为编排引擎开发者，我想要校验输出确定且可程序化处理，以便上层能够稳定地展示与处置全部错误。

#### Acceptance Criteria

1. WHEN Graph_Validator 完成对一个 WorkflowGraph 的校验，THE Graph_Validator SHALL 返回一个 Validation_Result，含布尔 `valid` 与一组 Validation_Error。
2. WHEN 一个 WorkflowGraph 不违反任何校验规则，THE Graph_Validator SHALL 返回 `valid` 为真且 Validation_Error 组为空的 Validation_Result。
3. WHEN 一个 WorkflowGraph 违反一条或多条校验规则，THE Graph_Validator SHALL 返回 `valid` 为假且 Validation_Error 组非空的 Validation_Result。
4. FOR ALL WorkflowGraph，THE Graph_Validator SHALL 对相同输入返回相同的 Validation_Result（校验为纯函数，结果确定）。
5. THE Graph_Validator SHALL 以确定且稳定的顺序排列 Validation_Result 中的 Validation_Error。
6. THE Graph_Validator SHALL 在单次校验中报告全部被违反规则的 Validation_Error，而非在首条错误处停止。

### Requirement 13: 拓扑分析——拓扑排序与分层

**User Story:** 作为编排引擎开发者，我想要对前向子图做拓扑排序与分层，以便确定节点的执行先后与并行层次。

#### Acceptance Criteria

1. WHEN Graph_Analyzer 处理一个 Valid_Graph，THE Graph_Analyzer SHALL 在 Forward_Subgraph 上产出一个 Topological_Order。
2. FOR ALL Forward_Subgraph 中的边，THE Graph_Analyzer SHALL 使 Topological_Order 中源节点的位置先于目标节点的位置。
3. WHEN Graph_Analyzer 产出 Topological_Order，THE Graph_Analyzer SHALL 使该序列恰好包含 Forward_Subgraph 的每个 WorkflowNode 一次。
4. WHEN Graph_Analyzer 处理一个 Valid_Graph，THE Graph_Analyzer SHALL 为每个 Reachable_Node 计算 Layering 层号，其中 EntryNode 层号为 0。
5. FOR ALL Forward_Subgraph 中的边，THE Graph_Analyzer SHALL 使目标节点的 Layering 层号严格大于源节点的 Layering 层号。
6. FOR ALL Valid_Graph，THE Graph_Analyzer SHALL 对相同输入产出相同的 Topological_Order（在确定的定序规则下结果唯一）。

### Requirement 14: 拓扑分析——可达性与孤立节点

**User Story:** 作为编排引擎开发者，我想要识别不可达与孤立节点，以便发现图中冗余或断裂的部分。

#### Acceptance Criteria

1. WHEN Graph_Analyzer 处理一个 WorkflowGraph，THE Graph_Analyzer SHALL 计算从 EntryNode 在 Forward_Subgraph 中可达的 Reachable_Node 集合。
2. WHEN Graph_Analyzer 计算可达性，THE Graph_Analyzer SHALL 将既非 EntryNode 又无任何入边的每个 WorkflowNode 标识为 Orphan_Node。
3. WHEN Graph_Analyzer 计算可达性，THE Graph_Analyzer SHALL 将不属于 Reachable_Node 集合的每个 WorkflowNode 标识为 Unreachable_Node。
4. FOR ALL WorkflowGraph，THE Graph_Analyzer SHALL 使 Reachable_Node 集合与 Unreachable_Node 集合互斥且其并集等于全部 WorkflowNode。
5. WHEN EntryNode 自身存在于图中，THE Graph_Analyzer SHALL 将 EntryNode 纳入 Reachable_Node 集合。

### Requirement 15: 拓扑分析——环检测与环提取

**User Story:** 作为编排引擎开发者，我想要检测并提取图中的环，以便定位非法循环结构。

#### Acceptance Criteria

1. WHEN Graph_Analyzer 处理一个 WorkflowGraph，THE Graph_Analyzer SHALL 在 Forward_Subgraph 上判定是否存在 Cycle。
2. WHEN Forward_Subgraph 存在一个或多个 Cycle，THE Graph_Analyzer SHALL 提取并返回至少一个 Cycle 的有序 Node_Id 序列。
3. WHEN Graph_Analyzer 提取到一个 Cycle，THE Graph_Analyzer SHALL 使该序列中相邻 Node_Id（含首尾相接）之间均存在一条 Forward_Subgraph 中的有向边。
4. WHEN Forward_Subgraph 无任何 Cycle，THE Graph_Analyzer SHALL 返回空的 Cycle 集合。

### Requirement 16: 拓扑分析——关键路径/最长路径

**User Story:** 作为编排引擎开发者，我想要计算图的最长路径，以便估计工作流的最长执行链路。

#### Acceptance Criteria

1. WHEN Graph_Analyzer 处理一个 Valid_Graph，THE Graph_Analyzer SHALL 在 Forward_Subgraph 上计算从 EntryNode 出发的 Critical_Path。
2. WHEN Graph_Analyzer 产出一个 Critical_Path，THE Graph_Analyzer SHALL 使该路径中相邻 Node_Id 之间均存在一条 Forward_Subgraph 中的有向边。
3. FOR ALL Forward_Subgraph 中从 EntryNode 出发的有向路径，THE Graph_Analyzer SHALL 使所产出 Critical_Path 的节点数不小于该路径的节点数。
4. WHEN Forward_Subgraph 仅含 EntryNode 一个节点，THE Graph_Analyzer SHALL 产出长度为 1 且仅含 EntryNode 的 Critical_Path。

### Requirement 17: 图变更操作（纯操作返回新图）

**User Story:** 作为编排引擎开发者，我想要不可变的图变更操作，以便安全地编辑工作流而不破坏既有引用。

#### Acceptance Criteria

1. WHEN Graph_Mutator 执行任意一项 Graph_Mutation，THE Graph_Mutator SHALL 返回一个新的 WorkflowGraph 且不修改作为输入的 WorkflowGraph（输入图保持不变）。
2. WHEN Graph_Mutator 接收一个添加 WorkflowNode 的请求且新节点 Node_Id 在输入图中不存在，THE Graph_Mutator SHALL 返回包含该新节点的新 WorkflowGraph。
3. IF 添加 WorkflowNode 的请求所用 Node_Id 已存在于输入图，THEN THE Graph_Mutator SHALL 拒绝该操作并返回一个指明 `DUPLICATE_NODE_ID` 原因的错误结果。
4. WHEN Graph_Mutator 接收一个移除 WorkflowNode 的请求，THE Graph_Mutator SHALL 返回同时移除该节点及全部以其为 Source_Endpoint 或 Target_Endpoint 的 WorkflowEdge 的新 WorkflowGraph。
5. WHEN Graph_Mutator 接收一个添加 WorkflowEdge 的请求，THE Graph_Mutator SHALL 返回包含该新边的新 WorkflowGraph。
6. WHEN Graph_Mutator 接收一个移除 WorkflowEdge 的请求，THE Graph_Mutator SHALL 返回移除该指定 Edge_Id 边的新 WorkflowGraph。
7. WHEN Graph_Mutator 接收一个替换某 WorkflowNode 的 Node_Config 的请求，THE Graph_Mutator SHALL 返回仅该节点 Node_Config 被替换、而其 Node_Id、NodeType、端口集合与其余节点均不变的新 WorkflowGraph。
8. FOR ALL Valid_Graph 与任意一项使 Graph_Mutator 返回成功结果的 Graph_Mutation，THE Graph_Mutator SHALL 保证对结果图再次执行同一操作（在结果图已满足前置条件时）得到与首次结果语义等价的图（幂等性，适用于配置替换与移除类操作）。
9. WHEN Graph_Mutator 对一个 Valid_Graph 执行 `removeNode` 后再 `addNode` 复原同一节点与其相关边，THE Graph_Mutator SHALL 得到与原 Valid_Graph 语义等价的 WorkflowGraph（往返性质）。

### Requirement 18: 序列化与往返恒等

**User Story:** 作为编排引擎开发者，我想要工作流图的规范化 JSON 序列化与可靠反序列化，以便图能被存储、传输并无损还原。

#### Acceptance Criteria

1. THE Graph_Serializer SHALL 提供纯函数 `serialize(graph)`，将任意 WorkflowGraph 渲染为 Canonical_Json 字符串。
2. THE Graph_Serializer SHALL 提供纯函数 `deserialize(json)`，将一个合法的 Canonical_Json 字符串还原为 WorkflowGraph。
3. FOR ALL WorkflowGraph `g`，THE Graph_Serializer SHALL 使 `deserialize(serialize(g))` 得到与 `g` 语义等价的 WorkflowGraph（序列化往返恒等）。
4. FOR ALL 由 `serialize` 产出的 Canonical_Json 字符串 `j`，THE Graph_Serializer SHALL 使 `serialize(deserialize(j))` 等于 `j`（规范化字符串往返恒等）。
5. FOR ALL 两个语义等价的 WorkflowGraph，THE Graph_Serializer SHALL 使 `serialize` 对二者产出逐字符相同的 Canonical_Json（规范化输出唯一）。
6. IF `deserialize` 接收一个不符合 Canonical_Json 结构的字符串，THEN THE Graph_Serializer SHALL 返回一个指明解析失败位置或原因的错误结果，而非产出一个 WorkflowGraph。
7. WHEN `deserialize` 成功还原一个 WorkflowGraph，THE Graph_Serializer SHALL 保留全部 WorkflowNode、WorkflowEdge、LoopScope、EntryNode 标记与每个 Port 的 PortType 与 Required 标志。
