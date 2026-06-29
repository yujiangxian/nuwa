# Requirements Document

## Introduction

「工作流执行引擎」(workflow-execution-engine) 是女娲 Nuwa「多智能体工作流编排引擎」(multi-agent workflow orchestration engine) 的**第三个子规格**，构建于已实现的两个前序子规格之上：

- **工作流图模型** (workflow-graph-model, 位于 `app/web/src/lib/workflow/`)：提供 `WorkflowGraph`、`WorkflowNode`、`Port`、`PortType`、`NodeType`、`Endpoint`、`LoopScope`、`Back_Edge`、`Forward_Subgraph` 等纯数据模型类型，以及 `validate`、`analyze`、`topologicalOrder`、Forward_Subgraph 构造、`Graph_Serializer` 的 `serialize`/`deserialize` 等纯函数。
- **工作流节点类型** (workflow-node-types, 位于 `app/web/src/lib/workflow/nodeTypes/`)：提供 `Typed_Node_Config`、`validateNodeConfig`、`expectedPorts`、`typeOfExpression` 等，定义六种 NodeType（`llm`、`condition`、`tool`、`transform`、`human_input`、`loop`）的配置 schema 与端口契约。

本子规格 (workflow-execution-engine) 的职责是定义一台**纯的、确定性的执行状态机**，用于运行一张已通过校验的 `WorkflowGraph`。实现位于 `app/web/src/lib/workflow/engine/`。

**核心约束（关键设计原则）**：本执行引擎必须是一个 **reducer 风格的纯函数引擎**，**不含任何真实 I/O，不发起任何真实的 LLM 调用或工具调用**。每个节点的执行效果由**注入的纯「节点执行器」(NodeExecutor)**（从输入到输出的纯函数或预置的 mock 结果）建模，使引擎本身完全确定、可用属性测试 (property-based testing) 验证。引擎不感知时间、随机性或网络；一切非确定性都被外移到注入的 NodeExecutor 之外，并通过 Execution_Environment 以确定的方式提供。

本子规格的范围限定为以下相互关联、作为整体交付的目标：

1. **执行状态模型** (ExecutionState)：捕获每节点的 ExecutionStatus、每端口的产出值（以 Endpoint 为键的 ValueStore）、已满足的边集合、每个 LoopScope 的 LoopCounter，以及一个 RunStatus。
2. **步进语义（纯 reducer）**：`step(state, graph, env)` 以一次确定的微步推进执行——选择下一个 ReadyNode、调用其注入的 NodeExecutor、将输出写入 ValueStore、标记为 Completed 并沿出边传播值。
3. **条件/分支语义**：`condition` 节点根据求得的条件值将执行路由至真/假分支；未被取用的分支的下游在无其他已满足路径可达时变为 Skipped。
4. **循环语义**：`loop` 节点经良构回边迭代其循环体，直至 Break_Condition 成立或达到 Max_Iterations；迭代计数有界且确定地递增；达上界时经退出端口离开循环。
5. **跑到完成驱动器**：`run(state, graph, env)` 反复施加 `step` 直至到达终止状态 (Completed/Failed) 或 Paused/被阻塞状态；必然终止（以节点数 × 最大循环迭代数为界）。
6. **终止性与进展性保证**：每一步都产生进展；引擎对任何有界循环的合法图都终止；任何节点的执行次数都不超过其循环上界所允许。
7. **中断/恢复**：可在 `human_input` 节点暂停（等待注入的响应）并确定地恢复；从序列化的 ExecutionState 恢复所得最终状态与未中断的一次性运行所得最终状态相同。
8. **错误处理**：NodeExecutor 失败将该节点标记为 Failed 并（按策略）阻塞其下游；RunStatus 变为 Failed；不引入部分性的非确定。
9. **ExecutionState 序列化**：ExecutionState 的规范化 `serialize`/`deserialize` 往返恒等（支撑可恢复性）。
10. **不变量**：节点绝不在其全部必需输入产出之前运行；Completed 节点的全部必需输入均已就位；ValueStore 单调性（值只增不改，跨循环迭代使用迭代作用域键除外）；确定性（同图 + 同注入执行器结果 + 同 env ⇒ 同一最终 ExecutionState）。

本子规格仅产出本执行层的需求与纯函数契约，**不做任何实现**。前序子规格已定义的类型（`WorkflowGraph`、`WorkflowNode`、`Port`、`PortType`、`Endpoint`、`LoopScope`、`Typed_Node_Config` 等）在本文档中仅以散文引用，不在此重新定义。

## Glossary

- **Execution_Engine**: 本子规格定义的整体模块（纯执行状态机 + reducer 风格纯函数库），位于 `app/web/src/lib/workflow/engine/`。
- **ExecutionState**: 一次运行在某一时刻的完整可序列化状态，由 Node_Status_Map、ValueStore、Satisfied_Edge_Set、Loop_Counter_Map、RunStatus 以及 Pending_Human_Input（可空）组成。
- **ExecutionStatus**: 单个 WorkflowNode 的执行状态，取值于 `{ Pending, Ready, Running, Completed, Skipped, Failed, Blocked }`。
- **Node_Status_Map**: 从 Node_Id 到该节点 ExecutionStatus 的映射。
- **Pending**: ExecutionStatus 取值，表示节点尚未具备执行条件（存在未产出的必需输入或上游门控未满足）。
- **Ready**: ExecutionStatus 取值，表示节点全部必需输入已在 ValueStore 中产出且上游门控已满足，可被选中执行。
- **Running**: ExecutionStatus 取值，表示节点已被选中、其 NodeExecutor 正在本微步内被调用（在纯引擎中为一个瞬态标记）。
- **Completed**: ExecutionStatus 取值，表示节点的 NodeExecutor 已成功返回且其输出已写入 ValueStore。
- **Skipped**: ExecutionStatus 取值，表示节点因位于未被取用的分支且无任何其他已满足路径可达而被跳过。
- **Failed**: ExecutionStatus 取值，表示节点的 NodeExecutor 返回失败结果。
- **Blocked**: ExecutionStatus 取值，表示节点因某上游节点 Failed（按 Error_Policy）而无法执行。
- **RunStatus**: 整次运行的状态，取值于 `{ Idle, Running, Paused, Completed, Failed }`。
- **Idle**: RunStatus 取值，表示运行尚未开始的初始状态。
- **Paused**: RunStatus 取值，表示运行在一个 `human_input` 节点处暂停、等待注入的人工响应。
- **ValueStore**: 一个以 Value_Key 为键、以端口产出值为值的不可变映射，记录已产出的端口值。
- **Value_Key**: ValueStore 的键，由一个 Endpoint (Node_Id, Port_Id) 与一个 Loop_Iteration_Index（非循环作用域内为基准索引 0）共同确定，保证跨循环迭代的产出值互不覆盖。
- **Endpoint**: 前序子规格定义的边端点，由 (Node_Id, Port_Id) 二元组确定。本子规格复用之。
- **Satisfied_Edge_Set**: 已满足的 WorkflowEdge 集合；一条边在其源 Output_Port 已在 ValueStore 产出值后被加入该集合，表示值已沿该边传播。
- **NodeExecutor**: 注入的纯函数，签名形如 `(node, inputs, env) → NodeExecutorResult`，将一个 WorkflowNode 与其输入端口值映射到输出端口值或失败；建模节点执行效果，使引擎确定且无真实副作用。
- **NodeExecutorResult**: NodeExecutor 的返回，或为成功（携带从 Output_Port 的 Port_Id 到产出值的映射），或为失败（携带一个 Executor_Error_Code 与可读描述）。
- **NodeExecutor_Registry**: 从 NodeType（或 Node_Id）到 NodeExecutor 的注入映射，由 Execution_Environment 持有。
- **Execution_Environment**: 注入引擎的不可变环境 (env)，含 NodeExecutor_Registry、Condition_Evaluator、Human_Input_Provider、Error_Policy 等；引擎一切外部行为均经由 env 以确定方式获得。
- **Condition_Evaluator**: env 中注入的纯函数，将一个 `condition` 节点或 `loop` 节点 Break_Condition 在其输入值上映射到一个确定的布尔结果。
- **Human_Input_Provider**: env 中注入的、将一个 `human_input` 节点映射到一个确定的人工响应值（或「尚无响应」）的纯函数，用于建模人工输入而不引入真实 I/O。
- **Human_Input_Response**: 由 Human_Input_Provider 提供、注入给某 `human_input` 节点的确定响应值。
- **Pending_Human_Input**: ExecutionState 中记录当前因等待 Human_Input_Response 而暂停所处 `human_input` 节点 Node_Id 的可空字段。
- **Error_Policy**: env 中注入的错误传播策略，决定一个 Failed 节点如何影响其下游（取值至少含 `block_downstream` 与 `fail_fast`）。
- **Step**: 一次由 `step(state, graph, env)` 施加的确定性微步，至多推进一个节点的 ExecutionStatus 或一次 Loop_Counter 递增。
- **Micro_Step_Result**: `step` 的返回，含推进后的新 ExecutionState 与一个 Progress_Flag，指示本步是否产生了进展。
- **Progress_Flag**: 布尔标志，指示一次 Step 是否改变了 ExecutionState（推进了至少一个节点状态或一个 LoopCounter）。
- **ReadyNode**: 在某一 ExecutionState 下 ExecutionStatus 为 Ready 的 WorkflowNode，即其全部必需输入已在 ValueStore 产出且上游门控已满足。
- **Ready_Selection_Rule**: 在存在多个 ReadyNode 时确定地选取下一个待执行节点的稳定规则：先按前序子规格的 Topological_Order，Topological_Order 相同位次再按 Node_Id 字典序。
- **LoopScope**: 前序子规格定义的循环作用域（含 Loop_Header、Loop_Body、Loop_Scope_Id）。本子规格复用之。
- **Loop_Header**: NodeType 为 `loop` 的循环头节点。本子规格复用前序子规格定义。
- **LoopCounter**: 某个 LoopScope 当前已完成的迭代次数，自 0 起，每完成一轮循环体迭代后递增 1。
- **Loop_Counter_Map**: 从 Loop_Scope_Id 到其 LoopCounter 的映射。
- **Loop_Iteration_Index**: 标识某次循环体执行所处迭代轮次的非负整数，用于构造迭代作用域的 Value_Key。
- **Max_Iterations**: 前序子规格 Loop_Config 定义的循环迭代上限（大于等于 1 的整数）。本子规格复用之作为终止界。
- **Break_Condition**: 前序子规格 Loop_Config 定义的中止条件表达式，经 Condition_Evaluator 求值为布尔。
- **Terminal_Status**: 运行的终止 RunStatus，取值于 `{ Completed, Failed }`。
- **Run_Driver**: 执行跑到完成逻辑的纯函数 `run(state, graph, env)`，反复施加 `step` 直至到达 Terminal_Status 或 Paused。
- **Run_Result**: `run` 的返回，含最终 ExecutionState 与已施加的 Step 计数。
- **State_Serializer**: 执行 ExecutionState 序列化与反序列化的纯函数组件，提供 `serializeState`/`deserializeState`。
- **Canonical_State_Json**: ExecutionState 的规范化 JSON 表示，键顺序与集合顺序确定，使语义相等的状态序列化输出唯一。
- **Valid_Graph**: 通过前序子规格 Graph_Validation（且其各节点通过 `validateNodeConfig`）的 WorkflowGraph，是 Execution_Engine 接受的合法输入。
- **Round_Trip**: 一个操作与其逆操作复合后回到等价起点的往返性质。
- **Determinism**: 引擎对相同输入（同图、同注入执行器结果、同 env）恒产出相同输出的确定性性质。
- **Executor_Error_Code**: NodeExecutorResult 失败时携带的稳定枚举标识。

## Requirements

### Requirement 1: 模块范围与纯执行引擎约束

**User Story:** 作为编排引擎开发者，我想要一台不含真实副作用的纯执行引擎，以便其行为完全确定且可用属性测试验证。

#### Acceptance Criteria

1. THE Execution_Engine SHALL 仅由纯函数与不可变类型构成，不包含真实 I/O、网络访问、可变全局状态、时间或随机依赖。
2. THE Execution_Engine SHALL 将每个 WorkflowNode 的执行效果建模为由 Execution_Environment 注入的 NodeExecutor，且不在引擎内部发起任何真实的 LLM 调用或工具调用。
3. THE Execution_Engine SHALL 复用前序子规格 (workflow-graph-model 与 workflow-node-types) 中的 `WorkflowGraph`、`WorkflowNode`、`Port`、`PortType`、`NodeType`、`Endpoint`、`LoopScope`、`Typed_Node_Config` 类型，而不重新定义这些类型。
4. THE Execution_Engine SHALL 仅接受 Valid_Graph 作为执行输入。
5. IF `step`、`run`、`serializeState` 或 `deserializeState` 接收一个未通过前序子规格 Graph_Validation 的 WorkflowGraph，THEN THE Execution_Engine SHALL 返回一个 Executor_Error_Code 为 `INVALID_GRAPH` 的错误结果，而不尝试执行。
6. FOR ALL ExecutionState `s`、Valid_Graph `g` 与 Execution_Environment `env`，THE Execution_Engine SHALL 对相同的 (s, g, env) 输入返回相同的输出（确定性）。

### Requirement 2: 执行状态模型

**User Story:** 作为编排引擎开发者，我想要一个完整且可序列化的执行状态模型，以便在任意时刻精确表示一次运行的进度。

#### Acceptance Criteria

1. THE Execution_Engine SHALL 将 ExecutionState 表示为由 Node_Status_Map、ValueStore、Satisfied_Edge_Set、Loop_Counter_Map、RunStatus 与可空 Pending_Human_Input 六部分组成的不可变结构。
2. THE Execution_Engine SHALL 限定 ExecutionStatus 取值于集合 `{ Pending, Ready, Running, Completed, Skipped, Failed, Blocked }`。
3. THE Execution_Engine SHALL 限定 RunStatus 取值于集合 `{ Idle, Running, Paused, Completed, Failed }`。
4. THE Execution_Engine SHALL 将 ValueStore 表示为从 Value_Key 到端口产出值的不可变映射，其中 Value_Key 由一个 Endpoint 与一个 Loop_Iteration_Index 共同确定。
5. THE Execution_Engine SHALL 提供纯函数 `initialState(graph)`，为一个 Valid_Graph 构造初始 ExecutionState：RunStatus 为 Idle、ValueStore 为空、Satisfied_Edge_Set 为空、每个 LoopScope 的 LoopCounter 为 0、Pending_Human_Input 为空，且除 EntryNode 标记为 Ready 外其余每个节点的 ExecutionStatus 为 Pending。
6. FOR ALL Valid_Graph `g`，THE Execution_Engine SHALL 对相同输入返回相同的 `initialState(g)`（确定性）。
7. THE Execution_Engine SHALL 使 `initialState(graph)` 的 Node_Status_Map 恰好为该图每个 WorkflowNode 各含一个条目。

### Requirement 3: 步进语义——就绪节点选择的确定性

**User Story:** 作为编排引擎开发者，我想要就绪节点的选择遵循稳定规则，以便每一微步在多个候选时都做出确定选择。

#### Acceptance Criteria

1. THE Execution_Engine SHALL 提供纯函数 `step(state, graph, env)`，将一个 ExecutionState 以一次确定的微步推进，返回一个 Micro_Step_Result（含新 ExecutionState 与 Progress_Flag）。
2. WHEN `step` 被调用且存在一个或多个 ReadyNode，THE Execution_Engine SHALL 依据 Ready_Selection_Rule 恰好选取一个 ReadyNode 执行。
3. THE Execution_Engine SHALL 将 Ready_Selection_Rule 定义为：先按前序子规格的 Topological_Order，Topological_Order 相同位次再按 Node_Id 的字典序，取序最先者。
4. FOR ALL ExecutionState `s`、Valid_Graph `g` 与 Execution_Environment `env`，THE Execution_Engine SHALL 对相同的 (s, g, env) 选取相同的 ReadyNode（选择确定性）。
5. WHEN `step` 选取一个 ReadyNode 并调用其 NodeExecutor，THE Execution_Engine SHALL 仅以该节点全部输入端口在 ValueStore 中当前迭代作用域下的产出值构造传给 NodeExecutor 的输入。
6. WHEN 不存在任何 ReadyNode 且运行尚未到达 Terminal_Status 或 Paused，THE Execution_Engine SHALL 返回 Progress_Flag 为假且 ExecutionState 不变的 Micro_Step_Result。

### Requirement 4: 步进语义——执行、产出与传播

**User Story:** 作为编排引擎开发者，我想要每一微步完整地执行节点并传播其产出，以便数据沿图确定地流动。

#### Acceptance Criteria

1. WHEN `step` 调用某 ReadyNode 的 NodeExecutor 且返回成功，THE Execution_Engine SHALL 将该成功结果中每个 Output_Port 的产出值以对应 Value_Key 写入 ValueStore，并将该节点 ExecutionStatus 置为 Completed。
2. WHEN 某节点被置为 Completed，THE Execution_Engine SHALL 将每条以该节点某 Output_Port 为 Source_Endpoint 的 WorkflowEdge 加入 Satisfied_Edge_Set。
3. WHEN 一条 WorkflowEdge 被加入 Satisfied_Edge_Set，THE Execution_Engine SHALL 使其 Target_Endpoint 对应 Input_Port 在 ValueStore 中获得由其 Source_Endpoint 产出的值。
4. WHEN 某节点被置为 Completed 后，THE Execution_Engine SHALL 将每个其全部必需 Input_Port 均已在 ValueStore 产出值且上游门控已满足、且当前 ExecutionStatus 为 Pending 的下游节点置为 Ready。
5. THE Execution_Engine SHALL 在每一成功微步中将被选中节点的 ExecutionStatus 经 Running 瞬态推进至 Completed，且 RunStatus 由 Idle 或 Running 置为 Running。
6. WHEN `step` 成功推进了至少一个节点状态或一个 LoopCounter，THE Execution_Engine SHALL 返回 Progress_Flag 为真的 Micro_Step_Result。

### Requirement 5: 不变量——节点不在输入就绪前运行

**User Story:** 作为编排引擎开发者，我想要任何节点都不在其必需输入产出之前执行，以便执行顺序始终尊重数据依赖。

#### Acceptance Criteria

1. FOR ALL 在某次 `step` 中被调用 NodeExecutor 的 WorkflowNode，THE Execution_Engine SHALL 保证该节点的每个必需 Input_Port 在调用前均已在 ValueStore 的当前迭代作用域中持有产出值（前置就绪不变量）。
2. FOR ALL ExecutionStatus 为 Completed 的 WorkflowNode，THE Execution_Engine SHALL 保证其每个必需 Input_Port 在 ValueStore 中均存在对应产出值（Completed 节点输入完备不变量）。
3. WHILE 某节点存在至少一个尚未产出值的必需 Input_Port，THE Execution_Engine SHALL 不将该节点置为 Ready 或 Running。
4. THE Execution_Engine SHALL 仅在一个节点的全部前驱依赖（其必需输入对应的上游节点）均已到达 Completed 或被确定地 Skipped 时，方将该节点视为可门控通过。

### Requirement 6: 不变量——ValueStore 单调性

**User Story:** 作为编排引擎开发者，我想要已产出的端口值在一次运行内不被原地篡改，以便执行结果可追溯且确定。

#### Acceptance Criteria

1. WHEN `step` 推进 ExecutionState，THE Execution_Engine SHALL 仅向 ValueStore 新增 Value_Key 条目，而不删除或就地修改既有 Value_Key 的产出值（单调新增）。
2. FOR ALL 连续两次微步产生的 ExecutionState `s` 与 `s'`，THE Execution_Engine SHALL 使 `s` 的 ValueStore 的每个 (Value_Key, 值) 条目都存在于 `s'` 的 ValueStore 中（ValueStore 单调性）。
3. WHERE 同一 Endpoint 在不同循环迭代中再次产出值，THE Execution_Engine SHALL 以不同 Loop_Iteration_Index 构造互不相同的 Value_Key，从而不覆盖既有迭代的产出值。
4. FOR ALL 同一 Value_Key，THE Execution_Engine SHALL 在一次运行内至多向 ValueStore 写入一次该键的值。

### Requirement 7: 条件/分支语义

**User Story:** 作为编排引擎开发者，我想要 `condition` 节点据其条件值路由执行，以便实现确定的分支控制。

#### Acceptance Criteria

1. WHEN `step` 执行一个 `condition` 节点，THE Execution_Engine SHALL 调用 env 的 Condition_Evaluator 在该节点输入值上求得一个确定的布尔结果。
2. WHEN 一个 `condition` 节点求值为真，THE Execution_Engine SHALL 沿其 True_Branch_Port（名为 `true`）的出边传播，并将该 True_Branch_Port 对应出边加入 Satisfied_Edge_Set。
3. WHEN 一个 `condition` 节点求值为假，THE Execution_Engine SHALL 沿其 False_Branch_Port（名为 `false`）的出边传播，并将该 False_Branch_Port 对应出边加入 Satisfied_Edge_Set。
4. WHEN 一个分支未被取用，THE Execution_Engine SHALL 将仅经该未取用分支可达、且不被任何其他已满足路径可达的每个下游节点的 ExecutionStatus 置为 Skipped。
5. IF 一个本可被置为 Skipped 的下游节点同时可经至少一条已满足路径到达，THEN THE Execution_Engine SHALL 不将该节点置为 Skipped。
6. FOR ALL `condition` 节点求值，THE Execution_Engine SHALL 对相同输入值经 Condition_Evaluator 得到相同布尔结果（分支确定性）。
7. THE Execution_Engine SHALL 不向任何已被置为 Skipped 的节点调用 NodeExecutor。

### Requirement 8: 循环语义——有界迭代

**User Story:** 作为编排引擎开发者，我想要 `loop` 节点经良构回边受控迭代，以便表达必然终止的循环。

#### Acceptance Criteria

1. WHEN `step` 在一个 LoopScope 完成一轮循环体迭代，THE Execution_Engine SHALL 将该 LoopScope 的 LoopCounter 在 Loop_Counter_Map 中递增 1。
2. WHILE 某 LoopScope 的 LoopCounter 小于其 Loop_Header 对应 Loop_Config 的 Max_Iterations 且其 Break_Condition 经 Condition_Evaluator 求值为假，THE Execution_Engine SHALL 经该 LoopScope 的 Loop_Header 的循环体进入端口（名为 `body_in`）启动下一轮迭代。
3. WHEN 某 LoopScope 的 Break_Condition 经 Condition_Evaluator 求值为真，THE Execution_Engine SHALL 经该 Loop_Header 的退出端口（名为 `exit`）离开循环，且不再启动新迭代。
4. WHEN 某 LoopScope 的 LoopCounter 达到其 Max_Iterations，THE Execution_Engine SHALL 经该 Loop_Header 的退出端口（名为 `exit`）离开循环，且不再启动新迭代。
5. FOR ALL LoopScope 与其每轮循环体迭代，THE Execution_Engine SHALL 为该迭代内各节点产出值采用与其 Loop_Iteration_Index 一致的 Value_Key。
6. FOR ALL LoopScope，THE Execution_Engine SHALL 保证其 LoopCounter 在一次运行内的取值单调不减且不超过其 Max_Iterations（迭代计数有界单调）。

### Requirement 9: 循环语义——执行次数受界

**User Story:** 作为编排引擎开发者，我想要循环体节点的执行次数受其循环上界约束，以便引擎无法无限运行。

#### Acceptance Criteria

1. FOR ALL 属于某 LoopScope 的 Loop_Body 的 WorkflowNode，THE Execution_Engine SHALL 使其 NodeExecutor 在一次运行内被调用的次数不超过该 LoopScope 的 Max_Iterations。
2. FOR ALL 不属于任何 LoopScope 的 Loop_Body 的 WorkflowNode，THE Execution_Engine SHALL 使其 NodeExecutor 在一次运行内至多被调用一次。
3. WHERE 一个 WorkflowNode 属于多个嵌套的 LoopScope 的 Loop_Body，THE Execution_Engine SHALL 使其 NodeExecutor 在一次运行内被调用的次数不超过其所属各 LoopScope 的 Max_Iterations 之积。
4. THE Execution_Engine SHALL 保证不向任何 ExecutionStatus 为 Completed（且不处于新一轮循环迭代作用域）的节点重复调用 NodeExecutor。

### Requirement 10: 跑到完成驱动器

**User Story:** 作为编排引擎开发者，我想要一个反复步进至终止的驱动器，以便一次性运行整张图。

#### Acceptance Criteria

1. THE Execution_Engine SHALL 提供纯函数 `run(state, graph, env)`，反复施加 `step` 直至 RunStatus 到达 Terminal_Status 或变为 Paused，返回一个 Run_Result（含最终 ExecutionState 与已施加 Step 计数）。
2. WHEN `run` 施加的某次 `step` 返回 Progress_Flag 为假且 RunStatus 未到达 Terminal_Status 或 Paused，THE Execution_Engine SHALL 停止继续步进并以当前 ExecutionState 返回 Run_Result。
3. WHEN 全部可达且未被 Skipped 的节点均到达 Completed，THE Execution_Engine SHALL 将 RunStatus 置为 Completed。
4. WHEN 存在至少一个节点到达 Failed，THE Execution_Engine SHALL 依据 Error_Policy 将 RunStatus 置为 Failed。
5. WHEN `run` 在一个 `human_input` 节点处需要尚未提供的 Human_Input_Response，THE Execution_Engine SHALL 将 RunStatus 置为 Paused 并在 Pending_Human_Input 中记录该节点 Node_Id，然后返回 Run_Result。
6. FOR ALL ExecutionState `s`、Valid_Graph `g` 与 Execution_Environment `env`，THE Execution_Engine SHALL 对相同的 (s, g, env) 返回相同的 Run_Result（运行确定性）。

### Requirement 11: 终止性与进展性保证

**User Story:** 作为编排引擎开发者，我想要引擎在有界图上必然终止，以便运行不会挂起或无限循环。

#### Acceptance Criteria

1. FOR ALL Valid_Graph `g`、初始 ExecutionState 与任意 Execution_Environment，THE Execution_Engine SHALL 使 `run` 在有限次 `step` 内到达 Terminal_Status 或 Paused（终止性）。
2. THE Execution_Engine SHALL 使 `run` 所施加的 Step 总数有上界，该上界不超过 g 的节点数与各 LoopScope 的 Max_Iterations 之积所确定的有限量（步数有界）。
3. FOR ALL 使 Progress_Flag 为真的 `step`，THE Execution_Engine SHALL 至少推进一个节点的 ExecutionStatus 或递增一个 LoopCounter（进展性）。
4. WHEN `run` 从一个 RunStatus 为 Running 的状态出发且仍存在未到达终止状态的可执行进度，THE Execution_Engine SHALL 经有限次步进使每个可达且非 Skipped 的节点最终到达 Completed、Failed 或 Blocked 之一（活性）。
5. THE Execution_Engine SHALL 不依赖任何外部时钟或超时来保证终止（终止性来自图结构与循环上界，而非时间）。

### Requirement 12: 中断与恢复——human_input 暂停

**User Story:** 作为编排引擎开发者，我想要运行能在人工输入节点暂停并稍后注入响应继续，以便引入人工介入步骤。

#### Acceptance Criteria

1. WHEN `step` 选中一个 `human_input` 节点且 env 的 Human_Input_Provider 尚未为该节点提供 Human_Input_Response，THE Execution_Engine SHALL 将 RunStatus 置为 Paused 并将该节点 Node_Id 记入 Pending_Human_Input，且不将该节点置为 Completed。
2. WHEN env 的 Human_Input_Provider 已为某 Paused 所在 `human_input` 节点提供 Human_Input_Response，THE Execution_Engine SHALL 将该响应作为该节点 `response` 输出端口的产出值写入 ValueStore，将该节点置为 Completed，清空 Pending_Human_Input，并将 RunStatus 由 Paused 置回 Running。
3. WHILE RunStatus 为 Paused，THE Execution_Engine SHALL 不向除当前 Pending_Human_Input 所指节点以外的任何节点调用 NodeExecutor。
4. FOR ALL Paused 状态的恢复，THE Execution_Engine SHALL 对相同的注入 Human_Input_Response 产生相同的后续 ExecutionState（恢复确定性）。

### Requirement 13: 中断与恢复——恢复等价性

**User Story:** 作为编排引擎开发者，我想要从序列化状态恢复所得最终状态与一次不中断运行相同，以便暂停/恢复不改变结果。

#### Acceptance Criteria

1. FOR ALL Valid_Graph `g` 与 Execution_Environment `env`，IF 一次运行 `R1` 在某 `human_input` 节点暂停后经 `serializeState`/`deserializeState` 往返再恢复至终止，AND 另一次运行 `R2` 自相同初始状态在相同注入响应下不中断地跑到终止，THEN THE Execution_Engine SHALL 使 `R1` 与 `R2` 的最终 ExecutionState 语义相等（恢复等价性）。
2. FOR ALL 在同一 `human_input` 节点处对同一 ExecutionState 暂停并恢复任意多次（每次注入相同 Human_Input_Response）的运行，THE Execution_Engine SHALL 产生相同的最终 ExecutionState（恢复幂等性）。
3. WHEN 从一个被序列化保存的 Paused ExecutionState 恢复，THE Execution_Engine SHALL 不重新调用任何已处于 Completed 的节点的 NodeExecutor。
4. FOR ALL 在任意可暂停点暂停并恢复的运行，THE Execution_Engine SHALL 使其最终 ExecutionState 与对应不中断运行的最终 ExecutionState 在 Node_Status_Map、ValueStore（按语义等价）、RunStatus 上一致。

### Requirement 14: 错误处理与故障传播

**User Story:** 作为编排引擎开发者，我想要节点执行失败被确定地处理并按策略传播，以便失败不引入非确定性。

#### Acceptance Criteria

1. WHEN 某 ReadyNode 的 NodeExecutor 返回失败，THE Execution_Engine SHALL 将该节点 ExecutionStatus 置为 Failed，并将其 NodeExecutorResult 中的 Executor_Error_Code 记入该节点的执行结果。
2. WHEN 某节点被置为 Failed 且 Error_Policy 为 `block_downstream`，THE Execution_Engine SHALL 将仅经该 Failed 节点可达、且无任何其他已满足路径可达的每个下游节点的 ExecutionStatus 置为 Blocked。
3. WHEN 某节点被置为 Failed 且 Error_Policy 为 `fail_fast`，THE Execution_Engine SHALL 立即将 RunStatus 置为 Failed 并停止选取新的 ReadyNode 执行。
4. WHEN 一次运行中存在至少一个 Failed 节点且无可继续推进的非阻塞进度，THE Execution_Engine SHALL 将 RunStatus 置为 Failed。
5. THE Execution_Engine SHALL 不向任何 ExecutionStatus 为 Blocked 的节点调用 NodeExecutor。
6. FOR ALL 注入的 NodeExecutor 失败结果集合相同的两次运行，THE Execution_Engine SHALL 产生相同的最终 ExecutionState（错误处理确定性，无部分性非确定）。

### Requirement 15: ExecutionState 序列化与往返恒等

**User Story:** 作为编排引擎开发者，我想要 ExecutionState 的规范化序列化与可靠反序列化，以便运行状态可被保存、传输并无损还原以支撑恢复。

#### Acceptance Criteria

1. THE State_Serializer SHALL 提供纯函数 `serializeState(state)`，将任意 ExecutionState 渲染为 Canonical_State_Json 字符串。
2. THE State_Serializer SHALL 提供纯函数 `deserializeState(json)`，将一个合法的 Canonical_State_Json 字符串还原为 ExecutionState。
3. FOR ALL ExecutionState `s`，THE State_Serializer SHALL 使 `deserializeState(serializeState(s))` 得到与 `s` 语义等价的 ExecutionState（状态序列化往返恒等）。
4. FOR ALL 由 `serializeState` 产出的 Canonical_State_Json 字符串 `j`，THE State_Serializer SHALL 使 `serializeState(deserializeState(j))` 等于 `j`（规范化字符串往返恒等）。
5. FOR ALL 两个语义等价的 ExecutionState，THE State_Serializer SHALL 使 `serializeState` 对二者产出逐字符相同的 Canonical_State_Json（规范化输出唯一）。
6. IF `deserializeState` 接收一个不符合 Canonical_State_Json 结构的字符串，THEN THE State_Serializer SHALL 返回一个指明解析失败位置或原因的错误结果，而非产出一个 ExecutionState。
7. WHEN `deserializeState` 成功还原一个 ExecutionState，THE State_Serializer SHALL 保留 Node_Status_Map、ValueStore（含每个 Value_Key 的 Loop_Iteration_Index）、Satisfied_Edge_Set、Loop_Counter_Map、RunStatus 与 Pending_Human_Input 全部组成部分。

### Requirement 16: 端到端确定性

**User Story:** 作为编排引擎开发者，我想要相同输入恒产生相同运行结果，以便引擎可被属性测试可靠验证。

#### Acceptance Criteria

1. FOR ALL Valid_Graph `g`、初始 ExecutionState `s0` 与 Execution_Environment `env`，THE Execution_Engine SHALL 使两次 `run(s0, g, env)` 产生逐字段相等的最终 ExecutionState（运行级确定性）。
2. FOR ALL 注入的 NodeExecutor、Condition_Evaluator 与 Human_Input_Provider 对相同输入均返回相同结果的两个 Execution_Environment，THE Execution_Engine SHALL 使二者在相同 (s0, g) 上的最终 ExecutionState 相等（环境外延确定性）。
3. FOR ALL Valid_Graph `g` 与 Execution_Environment `env`，THE Execution_Engine SHALL 使「反复施加 `step` 至终止」与「调用 `run`」从同一初始状态出发得到语义相等的最终 ExecutionState（step 与 run 一致性）。
4. THE Execution_Engine SHALL 使最终 ExecutionState 不依赖 ReadyNode 在内部容器中的偶然枚举顺序（结果与遍历顺序无关，由 Ready_Selection_Rule 唯一确定）。
5. FOR ALL 一次运行到达 Completed 的 Valid_Graph，THE Execution_Engine SHALL 使每个可达且非 Skipped、非 Failed、非 Blocked 的节点 ExecutionStatus 均为 Completed（完成完备性）。

### Requirement 17: 运行状态机一致性约束

**User Story:** 作为编排引擎开发者，我想要 RunStatus 与节点状态之间始终自洽，以便任意时刻的 ExecutionState 都是良构的。

#### Acceptance Criteria

1. WHILE RunStatus 为 Idle，THE Execution_Engine SHALL 保证 ValueStore 为空且除 EntryNode 外无任何节点的 ExecutionStatus 为 Completed。
2. WHILE RunStatus 为 Completed，THE Execution_Engine SHALL 保证不存在 ExecutionStatus 为 Ready 或 Running 的节点。
3. WHILE RunStatus 为 Failed，THE Execution_Engine SHALL 保证至少存在一个 ExecutionStatus 为 Failed 的节点。
4. WHILE RunStatus 为 Paused，THE Execution_Engine SHALL 保证 Pending_Human_Input 非空且其所指节点的 NodeType 为 `human_input`。
5. THE Execution_Engine SHALL 保证每个 WorkflowNode 在任一 ExecutionState 中的 ExecutionStatus 恰好取 `{ Pending, Ready, Running, Completed, Skipped, Failed, Blocked }` 之一（状态全覆盖且互斥）。
6. FOR ALL 由 `step` 或 `run` 产出的 ExecutionState，THE Execution_Engine SHALL 使 Satisfied_Edge_Set 仅含源节点 ExecutionStatus 为 Completed 的 WorkflowEdge（边满足与节点完成一致性）。
