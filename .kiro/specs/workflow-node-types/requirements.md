# Requirements Document

## Introduction

「工作流节点类型」(workflow-node-types) 是女娲 Nuwa「多智能体工作流编排引擎」(multi-agent workflow orchestration engine) 的**第二个子规格**，构建于已实现的基础子规格「工作流图模型」(workflow-graph-model, 位于 `app/web/src/lib/workflow/`) 之上。基础子规格提供了 `WorkflowGraph`、`WorkflowNode`、`Port`、`PortType`、`NodeType` 等纯数据模型类型，以及端口类型系统 (Type_System) 的 `isAssignable`、`formatPortType`、`parsePortType`，并将每个节点的配置载荷 (NodeConfig) 视为不透明的 `JsonValue`。

本子规格 (workflow-node-types) 的职责是为基础子规格中六种 NodeType（`llm`、`condition`、`tool`、`transform`、`human_input`、`loop`）定义**具体的、带类型的配置 schema 与每类型的语义契约**，并提供一组**纯的、可属性测试 (property-based testing) 验证**的校验与规范化函数。实现位于 `app/web/src/lib/workflow/nodeTypes/`。本子规格刻意保持对外部依赖的轻量，将重心放在大量纯函数上。其范围限定为以下相互关联、作为整体交付的目标：

1. **带类型的节点配置 schema** (Typed_Node_Config)：为每种 NodeType 定义一个具体的、可辨识联合 (discriminated union) 的配置结构，并声明该类型应暴露的输入/输出端口契约。
2. **每类型配置校验** (Config_Validation)：`validateNodeConfig(node)` 检查给定类型所需配置字段存在且类型良构、数值落在合法区间（如 temperature ∈ [0, 2]、maxIterations ≥ 1）、端口声明与该类型契约一致（如 `condition` 恰好两个输出），并产出带稳定错误码 (Config_Error_Code) 的 Config_Error 值。
3. **默认配置工厂** (Default_Config)：`defaultConfig(nodeType)` 为每种类型产出一个合法的默认配置与默认端口集合（往返性质：`defaultConfig` 的产出通过 `validateNodeConfig`）。
4. **端口契约推导** (Expected_Ports)：`expectedPorts(nodeType, config)` 给定节点类型与配置，推导其应暴露的输入/输出端口的规范集合，用于核对节点已声明端口是否与其类型契约相符。
5. **配置序列化与规范化** (Config_Normalization)：对每种配置做规范化 (Config_Normalizer)，与图序列化器 (Graph_Serializer) 往返一致。
6. **condition/transform 的表达式静态类型** (Expression_Typer)：一个小型、全函数 (total)、纯的表达式类型检查器，仅根据输入 PortType 静态推导 transform/condition 表达式的输出 PortType（此处不做运行时求值），复用基础子规格 Type_System 的 `isAssignable`。

本子规格仅产出本配置层的需求与纯函数契约，**不做任何实现**。基础子规格已定义的类型（`WorkflowGraph`、`WorkflowNode`、`Port`、`PortType`、`NodeType`、`Endpoint` 等）在本文档中仅以散文引用，不在此重新定义。

## Glossary

- **Workflow_Node_Types**: 本子规格定义的整体模块（每类型配置 schema + 校验/规范化/端口推导/表达式类型等纯函数库），位于 `app/web/src/lib/workflow/nodeTypes/`。
- **NodeType**: 基础子规格定义的节点类型标签，取值于 `{ llm, condition, tool, transform, human_input, loop }`。本子规格不重新定义，仅为每个取值赋予具体配置语义。
- **Typed_Node_Config**: 带类型的节点配置，是一个以 NodeType 为判别标签的可辨识联合，其每个分支为下列具体配置之一。
- **Llm_Config**: `llm` 节点的配置，含模型标识 (Model_Id)、系统提示 (System_Prompt)、温度 (Temperature)、最大令牌数 (Max_Tokens) 等字段。
- **Condition_Config**: `condition` 节点的配置，含一个布尔判定表达式 (Condition_Expression)，并约定恰好两个输出分支（真分支与假分支）。
- **Tool_Config**: `tool` 节点的配置，含工具名 (Tool_Name) 与一组参数绑定 (Argument_Bindings)，将输入端口映射到工具参数，并产出一个工具结果输出。
- **Transform_Config**: `transform` 节点的配置，含一个从输入到输出的纯映射表达式 (Transform_Expression)。
- **Human_Input_Config**: `human_input` 节点的配置，含面向人的提示 (Human_Prompt) 与期望响应类型 (Response_Type)。
- **Loop_Config**: `loop` 节点的配置，含迭代上限 (Max_Iterations) 与中止条件 (Break_Condition)，并约定循环体进入/退出端口。
- **Model_Id**: Llm_Config 中标识所用语言模型的非空字符串。
- **System_Prompt**: Llm_Config 中提供给模型的系统提示字符串。
- **Temperature**: Llm_Config 中的采样温度数值，合法区间为闭区间 [0, 2]。
- **Max_Tokens**: Llm_Config 中允许生成的最大令牌数，为大于等于 1 的整数。
- **Tool_Name**: Tool_Config 中标识被调用工具的非空字符串。
- **Argument_Bindings**: Tool_Config 中将输入端口 Port_Id 映射到工具参数名的键值映射。
- **Response_Type**: Human_Input_Config 中期望人工响应值的 PortType。
- **Max_Iterations**: Loop_Config 中循环允许执行的最大次数，为大于等于 1 的整数。
- **Break_Condition**: Loop_Config 中决定循环提前中止的布尔判定表达式 (Condition_Expression)。
- **Port_Contract**: 某 NodeType 在给定配置下应暴露的输入端口集合与输出端口集合的规范约定。
- **Expected_Ports**: 由 `expectedPorts(nodeType, config)` 推导得到的、满足 Port_Contract 的 Port 集合（含输入与输出两组）。
- **True_Branch_Port / False_Branch_Port**: `condition` 节点 Port_Contract 规定的两个输出端口，分别对应判定为真与为假的分支。
- **Config_Validator**: 执行 Config_Validation 的纯函数组件，对外暴露 `validateNodeConfig(node)`。
- **Config_Validation**: 针对单个 WorkflowNode 的 NodeType 与其 Typed_Node_Config（及其端口声明）执行的全部校验规则的总称。
- **Config_Validation_Result**: 配置校验结果，含布尔 `valid` 与一组 Config_Error（valid 为真时该组为空）。
- **Config_Error**: 单条配置校验错误，含 Config_Error_Code、定位信息（涉及的 Node_Id/Port_Id/字段名）与人类可读描述。
- **Config_Error_Code**: Config_Error 的稳定枚举标识，用于程序化区分错误类别。
- **Default_Config**: 由 `defaultConfig(nodeType)` 为某 NodeType 产出的、保证通过 Config_Validation 的默认 Typed_Node_Config 与默认端口集合。
- **Config_Normalizer**: 执行 Config_Normalization 的纯函数组件，对外暴露 `normalizeNodeConfig(nodeType, config)`。
- **Config_Normalization**: 将一个 Typed_Node_Config 转换为其规范形式 (Canonical_Config) 的过程，使语义等价的配置具有唯一表示。
- **Canonical_Config**: Typed_Node_Config 的规范形式，键顺序与集合顺序确定。
- **Expression**: Condition_Expression 或 Transform_Expression 的统称，一个不含运行时副作用的纯表达式抽象语法。
- **Condition_Expression**: 在输入上求值得到布尔结果的表达式，用于 `condition` 节点与 `loop` 节点的 Break_Condition。
- **Transform_Expression**: 将输入映射为输出值的表达式，用于 `transform` 节点。
- **Expression_Typer**: 执行 Expression 静态类型推导的纯函数组件，对外暴露 `typeOfExpression(expr, inputTypes)`。
- **Expression_Type_Result**: Expression_Typer 的输出，或为成功（携带推导出的输出 PortType），或为失败（携带一个 Config_Error_Code 为类型相关码的 Config_Error）。
- **Input_Type_Environment**: 从输入端口 Port_Id 到其 PortType 的映射，作为 Expression_Typer 静态类型推导的环境。
- **Type_System**: 基础子规格定义的端口类型系统，提供 `isAssignable(from, to)`、`formatPortType(t)`、`parsePortType(s)`。本子规格复用之，不重新定义。
- **isAssignable(from, to)**: 基础子规格 Type_System 提供的可赋值关系判定，本子规格在端口契约与表达式类型推导中复用。
- **Graph_Serializer**: 基础子规格定义的图序列化器，提供 `serialize`/`deserialize` 并保证规范化 JSON 往返恒等。
- **Round_Trip**: 一个操作与其逆操作复合后回到等价起点的往返性质。
- **Determinism**: 纯函数对相同输入恒产出相同输出的确定性性质。

## Requirements

### Requirement 1: 模块范围与带类型节点配置联合

**User Story:** 作为编排引擎开发者，我想要一个以 NodeType 为判别标签的带类型配置联合，以便每个节点的配置结构在编译期与运行期都与其类型严格对应。

#### Acceptance Criteria

1. THE Workflow_Node_Types SHALL 将 Typed_Node_Config 定义为以 NodeType 为判别标签的可辨识联合，其分支恰好覆盖 `{ llm, condition, tool, transform, human_input, loop }` 六种 NodeType，且每种 NodeType 对应唯一一个配置分支。
2. THE Workflow_Node_Types SHALL 复用基础子规格 (workflow-graph-model) 中的 `WorkflowNode`、`Port`、`PortType`、`NodeType`、`Endpoint` 类型，而不重新定义这些类型。
3. THE Workflow_Node_Types SHALL 使每个 Typed_Node_Config 分支携带一个与其所属 WorkflowNode 的 NodeType 取值相等的判别标签字段。
4. THE Workflow_Node_Types SHALL 仅由纯函数与不可变类型构成，不包含 I/O、可变全局状态、时间或随机依赖。
5. WHERE 一个 Typed_Node_Config 的判别标签与其所属 WorkflowNode 的 NodeType 不相等，THE Config_Validator SHALL 产出一条 Config_Error_Code 为 `CONFIG_TYPE_MISMATCH` 的 Config_Error。

### Requirement 2: llm 节点配置 schema

**User Story:** 作为编排引擎开发者，我想要 `llm` 节点有明确的配置字段与端口契约，以便配置语言模型调用并连接其输入输出。

#### Acceptance Criteria

1. THE Workflow_Node_Types SHALL 为 Llm_Config 定义 Model_Id、System_Prompt、Temperature 与 Max_Tokens 四个字段，其中 Model_Id 与 System_Prompt 为字符串、Temperature 为数值、Max_Tokens 为整数。
2. THE Workflow_Node_Types SHALL 规定 `llm` 节点的 Port_Contract 至少含一个名为 `prompt`、PortType 为 `string` 的必需输入端口与一个名为 `context`、PortType 为 `optional<message>` 的非必需输入端口。
3. THE Workflow_Node_Types SHALL 规定 `llm` 节点的 Port_Contract 含一个名为 `completion`、PortType 为 `string` 的输出端口与一个名为 `message`、PortType 为 `message` 的输出端口。
4. IF 一个 `llm` 节点的 Llm_Config 缺少 Model_Id 字段或其 Model_Id 为空字符串，THEN THE Config_Validator SHALL 产出一条 Config_Error_Code 为 `MISSING_REQUIRED_FIELD` 的 Config_Error，并定位字段名 `modelId`。
5. IF 一个 `llm` 节点的 Llm_Config 的 Temperature 不在闭区间 [0, 2] 内，THEN THE Config_Validator SHALL 产出一条 Config_Error_Code 为 `NUMERIC_OUT_OF_RANGE` 的 Config_Error，并定位字段名 `temperature`。
6. IF 一个 `llm` 节点的 Llm_Config 的 Max_Tokens 不是大于等于 1 的整数，THEN THE Config_Validator SHALL 产出一条 Config_Error_Code 为 `NUMERIC_OUT_OF_RANGE` 的 Config_Error，并定位字段名 `maxTokens`。

### Requirement 3: condition 节点配置 schema

**User Story:** 作为编排引擎开发者，我想要 `condition` 节点持有一个布尔判定表达式并恰好暴露真/假两个分支，以便实现基于条件的分支控制。

#### Acceptance Criteria

1. THE Workflow_Node_Types SHALL 为 Condition_Config 定义一个 Condition_Expression 字段，表示在输入上求值得到布尔结果的表达式。
2. THE Workflow_Node_Types SHALL 规定 `condition` 节点的 Port_Contract 恰好含两个输出端口：一个 True_Branch_Port（名为 `true`）与一个 False_Branch_Port（名为 `false`），二者 PortType 均为 `boolean`。
3. IF 一个 `condition` 节点声明的输出端口数量不等于 2，THEN THE Config_Validator SHALL 产出一条 Config_Error_Code 为 `PORT_ARITY_MISMATCH` 的 Config_Error，并定位该 Node_Id。
4. IF 一个 `condition` 节点声明的输出端口集合不恰好为 `{ true, false }` 两个 Port_Id，THEN THE Config_Validator SHALL 产出一条 Config_Error_Code 为 `PORT_CONTRACT_MISMATCH` 的 Config_Error。
5. WHEN Config_Validator 校验一个 `condition` 节点，THE Config_Validator SHALL 调用 Expression_Typer 对 Condition_Expression 推导输出 PortType，并要求该 PortType 为 `boolean`。
6. IF 一个 `condition` 节点的 Condition_Expression 经 Expression_Typer 推导的输出 PortType 不可赋值给 `boolean`，THEN THE Config_Validator SHALL 产出一条 Config_Error_Code 为 `EXPRESSION_TYPE_ERROR` 的 Config_Error。

### Requirement 4: tool 节点配置 schema

**User Story:** 作为编排引擎开发者，我想要 `tool` 节点持有工具名与参数绑定，以便将节点输入映射到工具参数并取回结果。

#### Acceptance Criteria

1. THE Workflow_Node_Types SHALL 为 Tool_Config 定义 Tool_Name 字段（非空字符串）与 Argument_Bindings 字段（从输入端口 Port_Id 到工具参数名的键值映射）。
2. THE Workflow_Node_Types SHALL 规定 `tool` 节点的 Port_Contract 含一个名为 `result`、PortType 为 `json` 的输出端口。
3. THE Workflow_Node_Types SHALL 规定 `tool` 节点的输入端口集合由 Argument_Bindings 的键集合确定，即每个被绑定的输入参数对应一个输入端口。
4. IF 一个 `tool` 节点的 Tool_Config 缺少 Tool_Name 字段或其 Tool_Name 为空字符串，THEN THE Config_Validator SHALL 产出一条 Config_Error_Code 为 `MISSING_REQUIRED_FIELD` 的 Config_Error，并定位字段名 `toolName`。
5. IF 一个 `tool` 节点的 Argument_Bindings 含一个其 Port_Id 不在该节点已声明输入端口集合中的绑定，THEN THE Config_Validator SHALL 产出一条 Config_Error_Code 为 `PORT_CONTRACT_MISMATCH` 的 Config_Error，并定位该 Port_Id。
6. IF 一个 `tool` 节点的 Argument_Bindings 含重复的工具参数名，THEN THE Config_Validator SHALL 产出一条 Config_Error_Code 为 `DUPLICATE_ARGUMENT_BINDING` 的 Config_Error。

### Requirement 5: transform 节点配置 schema

**User Story:** 作为编排引擎开发者，我想要 `transform` 节点持有一个纯映射表达式，以便在不调用外部服务的情况下重塑数据。

#### Acceptance Criteria

1. THE Workflow_Node_Types SHALL 为 Transform_Config 定义一个 Transform_Expression 字段，表示将输入映射为输出值的纯表达式。
2. THE Workflow_Node_Types SHALL 规定 `transform` 节点的 Port_Contract 含至少一个输入端口与恰好一个名为 `output` 的输出端口，且该输出端口的 PortType 由 Expression_Typer 对 Transform_Expression 的推导结果确定。
3. WHEN Config_Validator 校验一个 `transform` 节点，THE Config_Validator SHALL 以该节点输入端口构成的 Input_Type_Environment 调用 Expression_Typer 对 Transform_Expression 推导输出 PortType。
4. IF 一个 `transform` 节点声明的 `output` 输出端口的 PortType 与 Expression_Typer 推导出的输出 PortType 经 `isAssignable` 判定不兼容，THEN THE Config_Validator SHALL 产出一条 Config_Error_Code 为 `EXPRESSION_TYPE_ERROR` 的 Config_Error。
5. IF 一个 `transform` 节点的 Transform_Expression 引用了不存在于该节点输入端口集合中的 Port_Id，THEN THE Config_Validator SHALL 产出一条 Config_Error_Code 为 `EXPRESSION_UNKNOWN_INPUT` 的 Config_Error，并定位被引用的 Port_Id。

### Requirement 6: human_input 节点配置 schema

**User Story:** 作为编排引擎开发者，我想要 `human_input` 节点持有面向人的提示与期望响应类型，以便在工作流中插入人工输入步骤。

#### Acceptance Criteria

1. THE Workflow_Node_Types SHALL 为 Human_Input_Config 定义 Human_Prompt 字段（字符串）与 Response_Type 字段（一个 PortType）。
2. THE Workflow_Node_Types SHALL 规定 `human_input` 节点的 Port_Contract 含一个名为 `response` 的输出端口，且该输出端口的 PortType 等于 Response_Type。
3. THE Workflow_Node_Types SHALL 规定 `human_input` 节点的 Port_Contract 不含必需输入端口。
4. IF 一个 `human_input` 节点缺少 Human_Prompt 字段或其 Human_Prompt 为空字符串，THEN THE Config_Validator SHALL 产出一条 Config_Error_Code 为 `MISSING_REQUIRED_FIELD` 的 Config_Error，并定位字段名 `prompt`。
5. IF 一个 `human_input` 节点声明的 `response` 输出端口的 PortType 与 Response_Type 不相等，THEN THE Config_Validator SHALL 产出一条 Config_Error_Code 为 `PORT_CONTRACT_MISMATCH` 的 Config_Error。

### Requirement 7: loop 节点配置 schema

**User Story:** 作为编排引擎开发者，我想要 `loop` 节点持有迭代上限与中止条件并暴露循环体进入/退出端口，以便表达受控的迭代结构。

#### Acceptance Criteria

1. THE Workflow_Node_Types SHALL 为 Loop_Config 定义 Max_Iterations 字段（大于等于 1 的整数）与 Break_Condition 字段（一个 Condition_Expression）。
2. THE Workflow_Node_Types SHALL 规定 `loop` 节点的 Port_Contract 含一个名为 `body_in` 的输出端口（循环体进入）与一个名为 `exit` 的输出端口（循环退出），以及一个名为 `body_back` 的输入端口（循环体回边汇入）。
3. IF 一个 `loop` 节点的 Loop_Config 的 Max_Iterations 不是大于等于 1 的整数，THEN THE Config_Validator SHALL 产出一条 Config_Error_Code 为 `NUMERIC_OUT_OF_RANGE` 的 Config_Error，并定位字段名 `maxIterations`。
4. WHEN Config_Validator 校验一个 `loop` 节点，THE Config_Validator SHALL 调用 Expression_Typer 对 Break_Condition 推导输出 PortType，并要求该 PortType 可赋值给 `boolean`。
5. IF 一个 `loop` 节点的 Break_Condition 经 Expression_Typer 推导的输出 PortType 不可赋值给 `boolean`，THEN THE Config_Validator SHALL 产出一条 Config_Error_Code 为 `EXPRESSION_TYPE_ERROR` 的 Config_Error。

### Requirement 8: 配置校验通用契约与确定性

**User Story:** 作为编排引擎开发者，我想要 `validateNodeConfig` 输出确定且可程序化处理，以便上层稳定地展示与处置全部配置错误。

#### Acceptance Criteria

1. THE Config_Validator SHALL 提供纯函数 `validateNodeConfig(node)`，输入一个 WorkflowNode，输出一个 Config_Validation_Result（含布尔 `valid` 与一组 Config_Error）。
2. WHEN 一个 WorkflowNode 不违反任何配置校验规则，THE Config_Validator SHALL 返回 `valid` 为真且 Config_Error 组为空的 Config_Validation_Result。
3. WHEN 一个 WorkflowNode 违反一条或多条配置校验规则，THE Config_Validator SHALL 返回 `valid` 为假且 Config_Error 组非空的 Config_Validation_Result。
4. FOR ALL WorkflowNode，THE Config_Validator SHALL 对相同输入返回相同的 Config_Validation_Result（校验为纯函数，结果确定）。
5. THE Config_Validator SHALL 以确定且稳定的顺序排列 Config_Validation_Result 中的 Config_Error。
6. THE Config_Validator SHALL 在单次校验中报告全部被违反规则的 Config_Error，而非在首条错误处停止。
7. THE Config_Validator SHALL 使每条 Config_Error 携带一个取值于 Config_Error_Code 枚举的稳定错误码，且枚举至少包含 `CONFIG_TYPE_MISMATCH`、`MISSING_REQUIRED_FIELD`、`NUMERIC_OUT_OF_RANGE`、`PORT_ARITY_MISMATCH`、`PORT_CONTRACT_MISMATCH`、`DUPLICATE_ARGUMENT_BINDING`、`EXPRESSION_TYPE_ERROR`、`EXPRESSION_UNKNOWN_INPUT`。

### Requirement 9: 数值范围校验与区间收敛幂等性

**User Story:** 作为编排引擎开发者，我想要数值配置项被限制在合法区间并可被规范地收敛，以便配置始终处于可执行的取值范围。

#### Acceptance Criteria

1. THE Config_Validator SHALL 将 Temperature 的合法区间定义为闭区间 [0, 2]，将 Max_Tokens 与 Max_Iterations 的合法区间定义为大于等于 1 的整数。
2. THE Config_Normalizer SHALL 提供纯函数 `clampNumericFields(nodeType, config)`，将越界数值字段收敛 (clamp) 到其合法区间的最近端点，并保留区间内数值不变。
3. FOR ALL Typed_Node_Config `c`，THE Config_Normalizer SHALL 使 `clampNumericFields(t, clampNumericFields(t, c))` 等于 `clampNumericFields(t, c)`（区间收敛幂等性）。
4. FOR ALL Typed_Node_Config `c`，WHEN `c` 的全部数值字段均在合法区间内，THE Config_Normalizer SHALL 使 `clampNumericFields(t, c)` 在数值字段上与 `c` 等价（区间内取值不被改动）。
5. FOR ALL Typed_Node_Config `c`，THE Config_Validator SHALL 使 `clampNumericFields(t, c)` 的结果不触发任何 `NUMERIC_OUT_OF_RANGE` 的 Config_Error（收敛后数值恒落在合法区间）。

### Requirement 10: 默认配置工厂与往返合法性

**User Story:** 作为编排引擎开发者，我想要为每种节点类型生成合法的默认配置与默认端口，以便快速创建可直接通过校验的新节点。

#### Acceptance Criteria

1. THE Workflow_Node_Types SHALL 提供纯函数 `defaultConfig(nodeType)`，为给定 NodeType 产出一个 Default_Config，含一个 Typed_Node_Config 与一组默认输入端口与默认输出端口。
2. FOR ALL NodeType `t`，THE Workflow_Node_Types SHALL 使由 `defaultConfig(t)` 构造的 WorkflowNode 通过 `validateNodeConfig` 校验（`valid` 为真，往返合法性）。
3. FOR ALL NodeType `t`，THE Workflow_Node_Types SHALL 使 `defaultConfig(t)` 产出的 Typed_Node_Config 的判别标签等于 `t`。
4. FOR ALL NodeType `t`，THE Workflow_Node_Types SHALL 使 `defaultConfig(t)` 产出的默认端口集合等于 `expectedPorts(t, defaultConfig(t) 的配置)` 推导出的 Expected_Ports（默认端口满足 Port_Contract）。
5. FOR ALL NodeType `t`，THE Workflow_Node_Types SHALL 对相同 NodeType 输入返回相同的 Default_Config（确定性）。

### Requirement 11: 端口契约推导

**User Story:** 作为编排引擎开发者，我想要根据节点类型与配置推导其规范端口集合，以便核对节点已声明端口是否与类型契约相符。

#### Acceptance Criteria

1. THE Workflow_Node_Types SHALL 提供纯函数 `expectedPorts(nodeType, config)`，根据 NodeType 与其 Typed_Node_Config 推导一组 Expected_Ports（含输入端口集合与输出端口集合）。
2. FOR ALL Condition_Config `c`，THE Workflow_Node_Types SHALL 使 `expectedPorts('condition', c)` 的输出端口集合恰好含两个端口（True_Branch_Port 与 False_Branch_Port）。
3. FOR ALL Tool_Config `c`，THE Workflow_Node_Types SHALL 使 `expectedPorts('tool', c)` 的输出端口集合恰好含一个名为 `result` 的端口，且其输入端口集合的 Port_Id 等于 `c` 的 Argument_Bindings 的键集合。
4. FOR ALL Human_Input_Config `c`，THE Workflow_Node_Types SHALL 使 `expectedPorts('human_input', c)` 的输出端口集合恰好含一个名为 `response` 的端口，且该端口 PortType 等于 `c` 的 Response_Type。
5. FOR ALL Transform_Config `c` 且其 Transform_Expression 能被 Expression_Typer 成功定型，THE Workflow_Node_Types SHALL 使 `expectedPorts('transform', c)` 的输出端口集合恰好含一个名为 `output` 的端口，且该端口 PortType 等于 Expression_Typer 推导出的输出 PortType。
6. FOR ALL NodeType `t` 与配置 `c`，THE Workflow_Node_Types SHALL 对相同 (t, c) 输入返回相同的 Expected_Ports（确定性）。
7. WHEN 一个 WorkflowNode 已声明的端口集合（按方向与 Port_Id 比较）等于 `expectedPorts(node.type, node.config)`，THE Config_Validator SHALL 不就端口契约产出 `PORT_CONTRACT_MISMATCH` 或 `PORT_ARITY_MISMATCH` 的 Config_Error。

### Requirement 12: 配置规范化与往返一致

**User Story:** 作为编排引擎开发者，我想要每种配置有唯一的规范形式并能与图序列化器无损往返，以便配置可被存储、比较并稳定还原。

#### Acceptance Criteria

1. THE Config_Normalizer SHALL 提供纯函数 `normalizeNodeConfig(nodeType, config)`，将一个 Typed_Node_Config 转换为其 Canonical_Config 形式。
2. FOR ALL Typed_Node_Config `c`，THE Config_Normalizer SHALL 使 `normalizeNodeConfig(t, normalizeNodeConfig(t, c))` 等于 `normalizeNodeConfig(t, c)`（规范化幂等性）。
3. FOR ALL 两个语义等价的 Typed_Node_Config，THE Config_Normalizer SHALL 使 `normalizeNodeConfig` 对二者产出相等的 Canonical_Config（规范形式唯一）。
4. FOR ALL 通过 `validateNodeConfig` 的 WorkflowNode `n`，THE Config_Normalizer SHALL 使先经 Config_Normalizer 规范化其配置、再经 Graph_Serializer `serialize` 与 `deserialize` 往返后所得节点的配置，与 `normalizeNodeConfig(n.type, n.config)` 相等（与图序列化器往返一致）。
5. FOR ALL Typed_Node_Config `c`，WHEN `c` 已为 Canonical_Config 形式，THE Config_Normalizer SHALL 使 `normalizeNodeConfig(t, c)` 等于 `c`（规范形式为规范化的不动点）。
6. FOR ALL NodeType `t` 与配置 `c`，THE Config_Normalizer SHALL 对相同输入返回相同的 Canonical_Config（确定性）。

### Requirement 13: 表达式静态类型推导——总性与确定性

**User Story:** 作为编排引擎开发者，我想要一个全函数的纯表达式类型检查器，以便仅凭输入类型在不运行表达式的前提下推导输出类型。

#### Acceptance Criteria

1. THE Expression_Typer SHALL 提供纯函数 `typeOfExpression(expr, inputTypes)`，输入一个 Expression 与一个 Input_Type_Environment，输出一个 Expression_Type_Result。
2. FOR ALL Expression `e` 与 Input_Type_Environment `env`，THE Expression_Typer SHALL 终止并返回一个 Expression_Type_Result，既不抛出异常也不进入非终止状态（总性）。
3. FOR ALL Expression `e` 与 Input_Type_Environment `env`，THE Expression_Typer SHALL 对相同输入返回相同的 Expression_Type_Result（确定性）。
4. WHEN `typeOfExpression(e, env)` 成功，THE Expression_Typer SHALL 返回一个携带单一输出 PortType 的成功结果。
5. IF 一个 Expression 引用了不在 Input_Type_Environment 中的 Port_Id，THEN THE Expression_Typer SHALL 返回一个携带 Config_Error_Code 为 `EXPRESSION_UNKNOWN_INPUT` 的 Config_Error 的失败结果。
6. IF 一个 Expression 的子表达式类型不满足该表达式算子的类型要求，THEN THE Expression_Typer SHALL 返回一个携带 Config_Error_Code 为 `EXPRESSION_TYPE_ERROR` 的 Config_Error 的失败结果。

### Requirement 14: 表达式静态类型推导——可靠性

**User Story:** 作为编排引擎开发者，我想要表达式定型与端口类型系统一致，以便条件分支与转换输出能与下游端口安全连接。

#### Acceptance Criteria

1. WHEN Expression_Typer 对一个 Condition_Expression 成功定型，THE Expression_Typer SHALL 使其输出 PortType 可赋值给 `boolean`（条件表达式产出布尔类型）。
2. WHEN Expression_Typer 对一个 Transform_Expression 成功定型，THE Expression_Typer SHALL 使其输出 PortType 为基础子规格 Type_System 中合法的 PortType。
3. FOR ALL 成功定型的 Expression `e`，IF Input_Type_Environment `env1` 与 `env2` 对 `e` 所引用的每个 Port_Id 都给出 `isAssignable` 兼容的类型，THEN THE Expression_Typer SHALL 使在 `env1` 与 `env2` 下推导出的输出 PortType 之间保持 `isAssignable` 兼容关系（类型推导对输入加宽的单调可靠性）。
4. THE Expression_Typer SHALL 在推导各算子输出类型时复用基础子规格 Type_System 的 `isAssignable`，而不引入与之不一致的独立类型兼容规则。
5. WHEN Config_Validator 依据 Expression_Typer 的成功结果接受一个 `transform` 节点，THE Config_Validator SHALL 使该节点声明的 `output` 端口 PortType 与推导出的输出 PortType 之间满足 `isAssignable`（校验与定型一致）。

### Requirement 15: 与图模型集成的一致性

**User Story:** 作为编排引擎开发者，我想要配置层校验与基础图模型层校验协同而不冲突，以便整张图既满足拓扑约束又满足每节点的类型契约。

#### Acceptance Criteria

1. THE Workflow_Node_Types SHALL 仅消费基础子规格暴露的类型与纯函数，而不修改基础子规格中 `WorkflowGraph`、`WorkflowNode`、`Port` 的结构定义。
2. WHEN 一个 WorkflowNode 的已声明端口集合等于 `expectedPorts(node.type, node.config)`，THE Workflow_Node_Types SHALL 使该节点提供给基础子规格 Graph_Validation 的端口集合（用于端口类型兼容性与必需输入校验）与 Expected_Ports 一致。
3. FOR ALL NodeType `t`，THE Workflow_Node_Types SHALL 使由 `defaultConfig(t)` 构造的 WorkflowNode 通过 `validateNodeConfig` 校验（配置层合法，往返合法性）。
4. FOR ALL NodeType `t` 且 `defaultConfig(t)` 的默认输入端口集合不含必需输入端口，THE Workflow_Node_Types SHALL 使由 `defaultConfig(t)` 构造的单节点图在标记该节点为入口节点后，完整通过基础子规格的 Graph_Validation（含 `MISSING_REQUIRED_INPUT` 规则）。
5. FOR ALL NodeType `t` 且 `defaultConfig(t)` 的默认输入端口集合含一个或多个必需输入端口，THE Workflow_Node_Types SHALL 使由 `defaultConfig(t)` 构造的单节点入口图通过基础子规格 Graph_Validation 中除 `MISSING_REQUIRED_INPUT` 以外的全部规则；该孤立节点自身未连接的必需输入端口触发 `MISSING_REQUIRED_INPUT` 属预期，WHEN 该节点的全部必需输入端口均被连接，THE Workflow_Node_Types SHALL 使该图同时完整通过 `validateNodeConfig` 与基础子规格的 Graph_Validation。
6. THE Workflow_Node_Types SHALL 使 Config_Error_Code 的取值集合与基础子规格的 `ErrorCode` 取值集合不相交（两层错误码互不冲突，便于聚合区分）。

### Requirement 16: 错误定位与可程序化处置

**User Story:** 作为编排引擎开发者，我想要每条配置错误携带精确定位信息，以便在编辑器中将错误指向具体节点、端口或字段。

#### Acceptance Criteria

1. THE Config_Validator SHALL 使每条 Config_Error 携带其所属 WorkflowNode 的 Node_Id。
2. WHERE 一条 Config_Error 与某具体端口相关，THE Config_Validator SHALL 在该 Config_Error 的定位信息中记录涉及的 Port_Id。
3. WHERE 一条 Config_Error 与某具体配置字段相关，THE Config_Validator SHALL 在该 Config_Error 的定位信息中记录涉及的字段名。
4. WHERE 一条 Config_Error 由表达式定型失败引发，THE Config_Validator SHALL 在该 Config_Error 中保留 Expression_Typer 返回的 Config_Error_Code 与相关 Port_Id。
5. THE Config_Validator SHALL 使每条 Config_Error 携带一条人类可读的描述字符串。
