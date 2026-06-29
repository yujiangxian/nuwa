# 设计文档：工作流图模型 (workflow-graph-model)

## Overview

「工作流图模型」是女娲 Nuwa「多智能体工作流编排引擎」的**基础数据模型层与纯函数层**。它只负责工作流图的几何/拓扑层，不涉及执行、调度、持久化、UI 或任何外部副作用。

本设计的核心目标与约束：

- **纯库 (pure library)**：仅包含不可变数据结构 + 纯函数。无 I/O、无 React、无网络、无全局可变状态、无时间/随机依赖。所有导出函数对相同输入返回相同输出。
- **实现语言与位置**：TypeScript，位于 `app/web/src/lib/workflow/`。复用现有工具链（React 19 + TS 5.6 + Vite 6 + Vitest 3 + fast-check 3 已在 `app/web` 配置完毕）。
- **可属性测试性 (property-based-testing-first)**：本层几乎全部能力都可表述为「对所有合法输入，性质 P 成立」的全称命题（类型系统的代数律、校验的确定性与完备性、拓扑分析的不变量、变更操作的不可变性与往返性、序列化的往返恒等与唯一性），因此 PBT 是本层的首选验证手段。
- **不可变性**：所有数据结构在概念上是只读的（TypeScript 层面用 `readonly` 标注）；所有"变更"操作返回新对象，绝不修改输入。

设计将整个库拆分为 7 个高内聚、可独立测试的模块：`types.ts`、`portType.ts`、`graph.ts`、`validate.ts`、`analyze.ts`、`mutate.ts`、`serialize.ts`。

### 与需求的对应关系（总览）

| 需求 | 主要承载模块 |
| --- | --- |
| R1 图数据模型结构 | `types.ts`, `graph.ts` |
| R2 端口模型 | `types.ts`, `graph.ts` |
| R3 端口类型系统与可赋值关系 | `portType.ts` |
| R4–R11 各类校验规则 | `validate.ts`（依赖 `graph.ts`, `portType.ts`） |
| R12 校验结果聚合与确定性 | `validate.ts` |
| R13–R16 拓扑分析 | `analyze.ts` |
| R17 图变更操作 | `mutate.ts` |
| R18 序列化与往返 | `serialize.ts` |

## Architecture

### 模块依赖关系

各模块构成单向无环依赖（自身亦是一个 DAG），便于独立测试与替换：

```mermaid
graph TD
    types["types.ts<br/>(全部数据类型 + Error_Code 枚举)"]
    portType["portType.ts<br/>(PortType 模型 + isAssignable + format/parse)"]
    graph["graph.ts<br/>(空图构造 / 访问器 / 索引 / 子图)"]
    validate["validate.ts<br/>(Graph_Validator, R4–R12)"]
    analyze["analyze.ts<br/>(Graph_Analyzer, R13–R16)"]
    mutate["mutate.ts<br/>(Graph_Mutator, R17)"]
    serialize["serialize.ts<br/>(Graph_Serializer, R18)"]

    portType --> types
    graph --> types
    validate --> types
    validate --> graph
    validate --> portType
    analyze --> types
    analyze --> graph
    mutate --> types
    mutate --> graph
    serialize --> types
    serialize --> graph
    serialize --> portType
```

### 设计原则

1. **数据与行为分离**：`types.ts` 只声明数据形状；所有逻辑由纯函数实现，输入图、输出新值。
2. **确定性优先**：任何涉及"集合"的输出（错误列表、拓扑序、环、关键路径、序列化字符串）都使用稳定的定序规则（一般以 `id` 字典序为主键），以满足 R12.4–12.6、R13.6、R18.5。
3. **不可变 + 结构共享**：变更操作通过浅拷贝顶层数组并替换被改动元素实现，不修改输入（R17.1）。
4. **类型系统是校验的基石**：`isAssignable` 被设计为同时满足自反、传递、`json` 顶类型、`optional`/`list` 协变及 R3.9 限制的可靠递归定义（见下文算法节）。
5. **规范形 (canonical form) 驱动相等性**：图的"语义等价"通过比较规范化后的结构定义；序列化建立在同一规范化之上，从而保证序列化输出对语义相等的图唯一。

## Components and Interfaces

下列签名为各模块对外导出的纯函数契约。实现阶段据此拆解为大量实现任务与属性测试任务。

### 模块 `types.ts`

声明全部数据模型类型与枚举（详见「Data Models」节）。不含逻辑，仅含类型与少量字面量常量（如 `NODE_TYPES` 数组、`ErrorCode` 枚举）。

### 模块 `portType.ts`（类型系统，R3）

```ts
// 构造器（便于测试与上层使用）
export const T_STRING: PortType;
export const T_NUMBER: PortType;
export const T_BOOLEAN: PortType;
export const T_JSON: PortType;
export const T_MESSAGE: PortType;
export function listOf(element: PortType): PortType;
export function optionalOf(inner: PortType): PortType;

// 结构相等（深比较）
export function portTypeEquals(a: PortType, b: PortType): boolean;

// 可赋值关系（R3.2–R3.9）
export function isAssignable(from: PortType, to: PortType): boolean;

// 规范字符串表示与往返（R3.10–R3.12）
export function formatPortType(t: PortType): string;
export function parsePortType(s: string): PortType | null; // 非法输入返回 null
```

### 模块 `graph.ts`（结构构造、访问器、索引、子图，R1/R2 支撑 + 子图构造）

```ts
// R1.6 空图构造
export function emptyGraph(): WorkflowGraph;

// 基础访问器
export function getNode(g: WorkflowGraph, nodeId: string): WorkflowNode | undefined;
export function getEdge(g: WorkflowGraph, edgeId: string): WorkflowEdge | undefined;
export function getInputPort(node: WorkflowNode, portId: string): Port | undefined;
export function getOutputPort(node: WorkflowNode, portId: string): Port | undefined;

// 索引（用于校验与分析的高效查询；纯函数，构造只读映射）
export function buildNodeIndex(g: WorkflowGraph): ReadonlyMap<string, WorkflowNode>;
export function incomingEdges(g: WorkflowGraph, nodeId: string, portId?: string): readonly WorkflowEdge[];
export function outgoingEdges(g: WorkflowGraph, nodeId: string, portId?: string): readonly WorkflowEdge[];

// 回边与前向子图（R10.1, R11.3）
export function backEdges(g: WorkflowGraph): readonly WorkflowEdge[];
export function forwardEdges(g: WorkflowGraph): readonly WorkflowEdge[];
export function forwardAdjacency(g: WorkflowGraph): ReadonlyMap<string, readonly string[]>;

// 语义等价（忽略节点/边/作用域/端口数组顺序的深比较；供 R17/R18 性质使用）
export function graphEquals(a: WorkflowGraph, b: WorkflowGraph): boolean;
```

### 模块 `validate.ts`（Graph_Validator，R4–R12）

```ts
// 顶层入口：聚合全部规则，返回确定性结果（R12）
export function validateGraph(g: WorkflowGraph): ValidationResult;

// 各规则子检查（内部导出，便于单元/属性测试单独驱动）
export function checkDuplicateNodeIds(g: WorkflowGraph): ValidationError[];   // R4.1–4.2
export function checkDuplicateEdgeIds(g: WorkflowGraph): ValidationError[];   // R4.3–4.4
export function checkEdgeReferences(g: WorkflowGraph): ValidationError[];     // R5
export function checkPortTypeCompatibility(g: WorkflowGraph): ValidationError[]; // R6
export function checkInputArity(g: WorkflowGraph): ValidationError[];         // R7
export function checkRequiredInputs(g: WorkflowGraph): ValidationError[];     // R8
export function checkEntryAndReachability(g: WorkflowGraph): ValidationError[]; // R9
export function checkForwardAcyclicity(g: WorkflowGraph): ValidationError[];  // R10
export function checkLoopScopes(g: WorkflowGraph): ValidationError[];         // R11
```

`validateGraph` 以固定顺序调用上述子检查，拼接其错误，再按稳定排序键统一排序后返回（见 R12 与错误排序节）。

### 模块 `analyze.ts`（Graph_Analyzer，R13–R16）

分析以 Forward_Subgraph 为对象。约定：分析函数对**通过校验的图 (Valid_Graph)** 给出语义良好的结果；对含环图，环相关函数仍可用于提取环（R15）。

```ts
export function topologicalOrder(g: WorkflowGraph): readonly string[];        // R13.1–13.3, 13.6
export function layering(g: WorkflowGraph): ReadonlyMap<string, number>;       // R13.4–13.5
export function reachableNodes(g: WorkflowGraph): ReadonlySet<string>;         // R14.1, 14.5
export function orphanNodes(g: WorkflowGraph): readonly string[];              // R14.2
export function unreachableNodes(g: WorkflowGraph): readonly string[];         // R14.3–14.4
export function detectCycles(g: WorkflowGraph): readonly (readonly string[])[]; // R15.1–15.4
export function criticalPath(g: WorkflowGraph): readonly string[];            // R16

// 聚合分析结果（便于上层一次取齐）
export function analyzeGraph(g: WorkflowGraph): AnalysisResult;
```

### 模块 `mutate.ts`（Graph_Mutator，R17）

```ts
export function addNode(g: WorkflowGraph, node: WorkflowNode): MutationResult;          // R17.2–17.3
export function removeNode(g: WorkflowGraph, nodeId: string): MutationResult;           // R17.4
export function addEdge(g: WorkflowGraph, edge: WorkflowEdge): MutationResult;          // R17.5
export function removeEdge(g: WorkflowGraph, edgeId: string): MutationResult;           // R17.6
export function replaceNodeConfig(g: WorkflowGraph, nodeId: string, config: NodeConfig): MutationResult; // R17.7
```

所有函数均不修改输入 `g`（R17.1），返回 `MutationResult` 区分成功/错误。

### 模块 `serialize.ts`（Graph_Serializer，R18）

```ts
export function serialize(g: WorkflowGraph): string;            // R18.1, 18.5（规范化）
export function deserialize(s: string): DeserializeResult;      // R18.2, 18.6
export function canonicalize(g: WorkflowGraph): WorkflowGraph;  // 内部规范化（排序节点/边/作用域/端口）
```

## Data Models

以下 TypeScript 类型集中声明于 `types.ts`（构造器与逻辑除外）。所有字段在概念上只读，实现时统一加 `readonly`。

### 基础与端口类型

```ts
/** 任意 JSON 值（用于不透明的 Node_Config 载荷）。 */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/** PortType：结构化端口值类型（R3.1）。判别联合，便于穷尽匹配。 */
export type PortType =
  | { readonly kind: 'string' }
  | { readonly kind: 'number' }
  | { readonly kind: 'boolean' }
  | { readonly kind: 'json' }
  | { readonly kind: 'message' }
  | { readonly kind: 'list'; readonly element: PortType }
  | { readonly kind: 'optional'; readonly inner: PortType };

/** 五种基础类型标签。 */
export type BasePortTypeKind = 'string' | 'number' | 'boolean' | 'json' | 'message';
```

### 节点、端口、边、作用域

```ts
/** 受支持的节点类型集合（R1.3）。 */
export const NODE_TYPES = ['llm', 'condition', 'tool', 'transform', 'human_input', 'loop'] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export type PortDirection = 'input' | 'output';

/** Port（R2.1）。required 仅对 input 有意义；output 上忽略（R2.3）。 */
export interface Port {
  readonly id: string;            // Port_Id（同节点同方向内唯一，R2.4）
  readonly direction: PortDirection;
  readonly portType: PortType;
  readonly required: boolean;     // 仅 input 有效
}

/**
 * Node_Config：带类型的配置载荷（R1.2）。
 * 本数据模型层将其保持为不透明的 JSON 值——每种 NodeType 的具体载荷结构
 * 由上层（执行层子规格）定义。此处仅约定它是可规范化序列化的 JsonValue，
 * 并可携带一个可选的 nodeType 判别字段供上层细化（本层不强制）。
 */
export type NodeConfig = JsonValue;

/** WorkflowNode（R1.2, R2）。inputs/outputs 为对应方向的端口集合。 */
export interface WorkflowNode {
  readonly id: string;            // Node_Id（图内唯一，R4.1）
  readonly type: NodeType;
  readonly config: NodeConfig;
  readonly inputs: readonly Port[];   // 全部 direction === 'input'
  readonly outputs: readonly Port[];  // 全部 direction === 'output'
}

/** Endpoint：(Node_Id, Port_Id) 二元组（R1.5）。 */
export interface Endpoint {
  readonly nodeId: string;
  readonly portId: string;
}

/** WorkflowEdge（R1.4）。source 指向 Output_Port，target 指向 Input_Port。 */
export interface WorkflowEdge {
  readonly id: string;            // Edge_Id（图内唯一，R4.3）
  readonly source: Endpoint;
  readonly target: Endpoint;
}

/** LoopScope：循环作用域声明（术语表）。 */
export interface LoopScope {
  readonly id: string;            // Loop_Scope_Id（唯一，R11.5）
  readonly headerNodeId: string;  // Loop_Header（NodeType 须为 'loop'，R11.1）
  readonly bodyNodeIds: readonly string[]; // Loop_Body
}

/** WorkflowGraph（R1.1）。entryNodeId 为标记的 EntryNode；空图时可为 null。 */
export interface WorkflowGraph {
  readonly nodes: readonly WorkflowNode[];
  readonly edges: readonly WorkflowEdge[];
  readonly loopScopes: readonly LoopScope[];
  readonly entryNodeId: string | null;
}
```

### 校验结果类型（R12）

```ts
/** 稳定枚举码，用于程序化区分错误类别（R4–R11 各规则各一码）。 */
export enum ErrorCode {
  DUPLICATE_NODE_ID = 'DUPLICATE_NODE_ID',                       // R4.2
  DUPLICATE_EDGE_ID = 'DUPLICATE_EDGE_ID',                       // R4.4
  EDGE_REFERENCES_MISSING_NODE = 'EDGE_REFERENCES_MISSING_NODE', // R5.2
  EDGE_REFERENCES_MISSING_PORT = 'EDGE_REFERENCES_MISSING_PORT', // R5.4, R5.5
  SELF_LOOP_EDGE = 'SELF_LOOP_EDGE',                             // R5.6
  INCOMPATIBLE_PORT_TYPES = 'INCOMPATIBLE_PORT_TYPES',           // R6.2
  INPUT_PORT_ARITY_EXCEEDED = 'INPUT_PORT_ARITY_EXCEEDED',       // R7.2
  MISSING_REQUIRED_INPUT = 'MISSING_REQUIRED_INPUT',             // R8.2
  ENTRY_NODE_NOT_FOUND = 'ENTRY_NODE_NOT_FOUND',                 // R9.2
  ENTRY_NODE_HAS_INCOMING_EDGE = 'ENTRY_NODE_HAS_INCOMING_EDGE', // R9.4
  UNREACHABLE_NODE = 'UNREACHABLE_NODE',                         // R9.6
  CYCLE_IN_FORWARD_SUBGRAPH = 'CYCLE_IN_FORWARD_SUBGRAPH',       // R10.3
  INVALID_LOOP_HEADER = 'INVALID_LOOP_HEADER',                   // R11.2
  MALFORMED_BACK_EDGE = 'MALFORMED_BACK_EDGE',                   // R11.4
  DUPLICATE_LOOP_SCOPE_ID = 'DUPLICATE_LOOP_SCOPE_ID',           // R11.6
  LOOP_BODY_REFERENCES_MISSING_NODE = 'LOOP_BODY_REFERENCES_MISSING_NODE', // R11.8
}

/** 错误定位信息：涉及的 id 与（如适用）类型字符串。各字段按需填充。 */
export interface ErrorLocation {
  readonly nodeIds?: readonly string[];
  readonly edgeIds?: readonly string[];
  readonly portIds?: readonly string[];
  readonly loopScopeIds?: readonly string[];
  readonly cycle?: readonly string[];         // CYCLE_IN_FORWARD_SUBGRAPH 的有序节点序列
  readonly fromType?: string;                 // INCOMPATIBLE_PORT_TYPES：源类型规范字符串
  readonly toType?: string;                   // INCOMPATIBLE_PORT_TYPES：目标类型规范字符串
}

export interface ValidationError {
  readonly code: ErrorCode;
  readonly message: string;        // 人类可读描述
  readonly location: ErrorLocation;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ValidationError[]; // valid===true 时为空
}
```

### 分析结果类型（R13–R16）

```ts
export type TopoOrder = readonly string[];          // R13
export type Layering = ReadonlyMap<string, number>; // R13.4
export type Cycle = readonly string[];              // R15：有序节点序列
export type CriticalPath = readonly string[];       // R16

export interface AnalysisResult {
  readonly topoOrder: TopoOrder;
  readonly layering: Layering;
  readonly reachable: ReadonlySet<string>;
  readonly orphans: readonly string[];
  readonly unreachable: readonly string[];
  readonly cycles: readonly Cycle[];
  readonly criticalPath: CriticalPath;
}
```

### 变更与序列化结果类型（R17, R18）

```ts
/** 变更错误。code 复用 ErrorCode（如 DUPLICATE_NODE_ID）或专用变更码。 */
export interface MutationError {
  readonly code: ErrorCode | 'NODE_NOT_FOUND' | 'EDGE_NOT_FOUND' | 'DUPLICATE_EDGE_ID';
  readonly message: string;
}

export type MutationResult =
  | { readonly ok: true; readonly graph: WorkflowGraph }
  | { readonly ok: false; readonly error: MutationError };

export interface DeserializeError {
  readonly message: string;
  readonly position?: number; // 解析失败位置（如可得）
}

export type DeserializeResult =
  | { readonly ok: true; readonly graph: WorkflowGraph }
  | { readonly ok: false; readonly error: DeserializeError };
```

## Key Algorithms（关键算法）

### 1. `isAssignable(from, to)` 的可靠递归定义（R3.2–R3.9）

目标：在同一定义下同时满足自反性 (R3.3)、传递性 (R3.4)、`json` 为全局顶类型 (R3.5)、`optional` 包裹 (R3.6)、`list` 协变 (R3.7)、`optional` 协变 (R3.8)，以及 R3.9（`optional<a>` 不可赋给非 `optional` 且非 `json` 的基础类型）。

定义（对 `to` 的结构归纳；记基础类型集 `Base = {string, number, boolean, json, message}`）：

```
isAssignable(from, to):
  1. 若 to.kind == 'json'                         → true            # 顶类型 (R3.5)，优先于一切，故 R3.9 不约束 json
  2. 若 to.kind == 'optional'(tb):
       若 from.kind == 'optional'(ta)             → isAssignable(ta, tb)   # optional 协变 (R3.8)
       否则                                        → isAssignable(from, tb) # 包裹+协变合一 (R3.6)
  3. 若 to.kind == 'list'(tb):
       若 from.kind == 'list'(ta)                 → isAssignable(ta, tb)   # list 协变 (R3.7)
       否则                                        → false
  4. 否则（to 为 string/number/boolean/message 之一）:
       若 from.kind == 'optional'                 → false           # R3.9：optional 不可解包到裸基础类型
       若 from.kind == 'list'                     → false
       否则                                        → from.kind == to.kind # 基础类型仅自反相等
```

**关键性质论证（设计意图，由属性测试最终验证）**：

- *自反性*：基础类型走规则 4 的 `from.kind == to.kind`；`list<a>`/`optional<a>` 走规则 3/2 归约到 `isAssignable(a, a)`，由结构归纳成立。
- *`json` 顶类型*：规则 1 对一切 `from`（含 `optional`）返回 true，确保 R3.9 不波及 `json`。
- *`optional` 包裹*：`isAssignable(t, optional<t>)` 中，非 `optional` 的 `t` 走规则 2 后半 `isAssignable(t, t)` 为真；`t` 本身为 `optional<u>` 时走规则 2 前半 `isAssignable(u, optional<u>)`，归纳为真。
- *协变*：规则 2 前半与规则 3 直接给出 `optional`/`list` 协变。
- *R3.9*：`from = optional<a>`、`to ∈ {string,number,boolean,message}` 命中规则 4 第一分支返回 false。
- *传递性*：定义对 `to` 结构单调递归，`optional` 仅"加宽"（接受其内层可接受者及其 `optional` 包装），`list` 严格协变，`json` 吸收一切；不存在"先放宽再收紧"的破坏路径。传递性由 R3.4 的属性测试在 100+ 随机三元组上强制验证（若实现偏离将立即被反例暴露）。

### 2. 规范字符串 `formatPortType` / `parsePortType`（R3.10–R3.12）

`formatPortType` 自底向上拼接：基础类型输出其 `kind`；`list<T>` 输出 `"list<" + format(T) + ">"`；`optional<T>` 输出 `"optional<" + format(T) + ">"`。该映射对每个 PortType 唯一。

`parsePortType` 为递归下降解析器：识别前缀 `list<…>` / `optional<…>`（按匹配的尖括号切分内层），否则按完整串匹配基础类型名。任何不符合文法的输入返回 `null`。`parsePortType(formatPortType(t))` 在结构相等意义下还原 `t`（R3.12）。

### 3. Forward_Subgraph 构造与回边分类（R10.1, R11.3）

- `backEdges(g)`：边 `e` 是良构回边当且仅当存在某 LoopScope `S`，使 `e.target.nodeId == S.headerNodeId` 且 `e.source.nodeId ∈ S.bodyNodeIds`。
- `forwardEdges(g) = edges \ backEdges(g)`；`forwardAdjacency` 在前向边上构造邻接表。
- Forward_Subgraph 即以全部节点 + `forwardEdges` 构成的有向图（R10.1）。

### 4. 拓扑排序与分层（R13）

- **拓扑序（Kahn + 确定性定序，R13.6）**：在 Forward_Subgraph 上计算入度；用一个以 Node_Id 字典序排序的就绪队列（每次取字典序最小的入度为 0 节点），逐个出队并递减后继入度。结果对每个图唯一。若中途无法清空（说明有环）则该函数仅作用于无环前向子图（校验已保证 Valid_Graph 无环）。
- **分层（最长路径，R13.4–13.5）**：按拓扑序遍历，`layer(entry) = 0`，`layer(v) = max(layer(u) over 前向前驱 u) + 1`。沿任意前向边 `u→v` 有 `layer(v) ≥ layer(u)+1 > layer(u)`，严格单调。仅对可达节点计算（不可达节点不在 EntryNode 的传播范围内）。

### 5. 环检测与提取（R15）

在 Forward_Subgraph 上做带颜色标记 (white/gray/black) 的 DFS（节点访问顺序按 Node_Id 字典序以保证确定性）。遇到指向 gray 节点的边即发现后向边，沿 DFS 栈从该 gray 节点回溯到当前节点得到一个环的有序 Node_Id 序列。相邻节点（含首尾相接）之间均存在前向边（R15.3）。无环时返回空集（R15.4）。

### 6. 关键路径（最长路径，R16）

在 Forward_Subgraph（DAG）上按拓扑序做 DP：`dist[entry] = 1`，`dist[v] = max(dist[u] + 1)`（u 为 v 的前向前驱，且 u 可达），并记录取得最大值的前驱指针（多个时取字典序最小 Node_Id，保证确定性）。关键路径 = 从 `dist` 最大的可达节点回溯前驱指针得到的序列，反转后从 EntryNode 起。仅含 EntryNode 时返回 `[entry]`（长度 1，R16.4）。其节点数不小于任意从 EntryNode 出发的前向路径（R16.3）。

### 7. 规范化 JSON 与往返（R18）

`canonicalize(g)` 产出排序后的图：
- `nodes` 按 `id` 字典序；每个节点的 `inputs`、`outputs` 各按 `id` 字典序；
- `edges` 按 `id` 字典序；
- `loopScopes` 按 `id` 字典序，其 `bodyNodeIds` 按字典序；
- `config`（JsonValue）递归规范化：对象键按字典序重排，数组保持原序（数组语义有序）。

`serialize(g)` = 先 `canonicalize`，再以**固定字段顺序**构造纯对象并 `JSON.stringify`（PortType 以 `formatPortType` 的规范字符串落盘）。由于一切顺序确定，语义等价的两图产出逐字符相同字符串（R18.5）。

`deserialize(s)`：`JSON.parse` 后做结构校验（字段存在性与基本形状、PortType 字符串经 `parsePortType` 还原），成功返回图，失败返回带位置/原因的错误结果（R18.6）。还原保留全部节点/边/作用域/EntryNode 标记及每个端口的 PortType 与 Required（R18.7）。

## Correctness Properties

*属性 (property) 是在系统所有合法执行中都应成立的特征或行为——本质上是关于系统应当做什么的形式化陈述。属性是连接人类可读规格与机器可验证正确性保证之间的桥梁。*

下列属性均为全称量化命题，每条对应一个 fast-check 属性测试（≥100 次随机迭代），并标注其验证的需求条款。除特别说明外，"语义等价"指 `graphEquals`，"图"指由自定义 arbitrary 生成的随机图。

### 类型系统（R3）

### Property 1: 可赋值关系自反性
*对任意* PortType `t`，`isAssignable(t, t)` 恒为真。
**Validates: Requirements 3.3**

### Property 2: 可赋值关系传递性
*对任意* PortType `a`、`b`、`c`，若 `isAssignable(a, b)` 且 `isAssignable(b, c)`，则 `isAssignable(a, c)`。
**Validates: Requirements 3.4**

### Property 3: json 为全局顶类型
*对任意* PortType `t`，`isAssignable(t, T_JSON)` 恒为真。
**Validates: Requirements 3.5**

### Property 4: optional 包裹可赋值
*对任意* PortType `t`，`isAssignable(t, optionalOf(t))` 恒为真。
**Validates: Requirements 3.6**

### Property 5: list 协变
*对任意* PortType `a`、`b`，若 `isAssignable(a, b)`，则 `isAssignable(listOf(a), listOf(b))`。
**Validates: Requirements 3.7**

### Property 6: optional 协变
*对任意* PortType `a`、`b`，若 `isAssignable(a, b)`，则 `isAssignable(optionalOf(a), optionalOf(b))`。
**Validates: Requirements 3.8**

### Property 7: optional 不可解包到裸基础类型
*对任意* PortType `a` 与任意非 `json` 的基础类型 `b ∈ {string, number, boolean, message}`，`isAssignable(optionalOf(a), b)` 恒为假。
**Validates: Requirements 3.9**

### Property 8: 类型表示往返恒等
*对任意* PortType `t`，`parsePortType(formatPortType(t))` 与 `t` 结构相等（`portTypeEquals` 为真）。
**Validates: Requirements 3.12**

### 校验：结构与引用（R2, R4, R5）

### Property 9: 输出端口 Required 不影响校验
*对任意* WorkflowGraph `g`，将其全部 Output_Port 的 `required` 标志任意翻转得到 `g'`，则 `validateGraph(g)` 与 `validateGraph(g')` 的错误集合相等。
**Validates: Requirements 2.3**

### Property 10: 跨方向同名端口被允许
*对任意* WorkflowGraph，使某节点同时拥有一个与某 Output_Port 同名的 Input_Port，不因此名称冲突产生任何 Validation_Error。
**Validates: Requirements 2.5**

### Property 11: 重复 id 必被检出
*对任意* WorkflowGraph，复制某个已存在的 Node_Id 形成重复，`validateGraph` 的错误集合必含 `DUPLICATE_NODE_ID`；对边同理，复制 Edge_Id 必含 `DUPLICATE_EDGE_ID`。
**Validates: Requirements 4.1, 4.2, 4.3, 4.4**

### Property 12: 悬空引用与自环必被检出
*对任意* WorkflowGraph：将某条边的某端点改为引用不存在的 Node_Id 必产生 `EDGE_REFERENCES_MISSING_NODE`；改为引用存在节点上不存在或方向错误的 Port_Id 必产生 `EDGE_REFERENCES_MISSING_PORT`；令某边 source 与 target 指向同一 Node_Id 必产生 `SELF_LOOP_EDGE`。
**Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6**

### 校验：类型兼容、数量、必填（R6, R7, R8）

### Property 13: 类型兼容性与 isAssignable 一致
*对任意* 引用合法的 WorkflowEdge，`validateGraph` 就该边产生 `INCOMPATIBLE_PORT_TYPES` 当且仅当 `isAssignable(源 Output_Port 类型, 目标 Input_Port 类型)` 为假。
**Validates: Requirements 6.1, 6.2, 6.3**

### Property 14: 输入端口入边数量约束
*对任意* WorkflowGraph，若某 Input_Port 被两条或更多边作为 Target_Endpoint，则必产生 `INPUT_PORT_ARITY_EXCEEDED`；而任意多条边共享同一 Output_Port 作为 Source_Endpoint 都不产生该错误（输出扇出不受限）。
**Validates: Requirements 7.1, 7.2, 7.3**

### Property 15: 必需输入悬空检出且非必需豁免
*对任意* WorkflowGraph，每个 `required` 为真且无任何入边的 Input_Port 必产生 `MISSING_REQUIRED_INPUT`；每个 `required` 为假且无入边的 Input_Port 都不产生该错误。
**Validates: Requirements 8.1, 8.2, 8.3**

### 校验：入口、可达性、环、循环作用域（R9, R10, R11）

### Property 16: 入口节点与可达性检出
*对任意* 非空 WorkflowGraph：若 EntryNode 不在节点集中必产生 `ENTRY_NODE_NOT_FOUND`；若为 EntryNode 添加一条前向入边必产生 `ENTRY_NODE_HAS_INCOMING_EDGE`；存在任一不可达节点必产生 `UNREACHABLE_NODE`。
**Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5, 9.6**

### Property 17: 前向子图有环必检出且环序列合法
*对任意* WorkflowGraph，若其 Forward_Subgraph 含环，则 `validateGraph` 产生 `CYCLE_IN_FORWARD_SUBGRAPH`，且其报告的有序 Node_Id 序列中相邻节点（含首尾相接）之间在 Forward_Subgraph 中均存在有向边。
**Validates: Requirements 10.1, 10.2, 10.3**

### Property 18: 循环作用域良构性检出
*对任意* WorkflowGraph：Loop_Header 对应节点 NodeType 不为 `loop` 必产生 `INVALID_LOOP_HEADER`；重复 Loop_Scope_Id 必产生 `DUPLICATE_LOOP_SCOPE_ID`；Loop_Body 含不存在节点必产生 `LOOP_BODY_REFERENCES_MISSING_NODE`；构成环却不满足良构回边条件的边必产生 `MALFORMED_BACK_EDGE`，而良构回边（目标为声明的 Loop_Header 且源属同作用域 Loop_Body）不产生该错误且不破坏前向子图无环性。
**Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8**

### 校验：聚合与确定性（R12）

### Property 19: valid 与错误集互斥一致
*对任意* WorkflowGraph，`validateGraph(g).valid` 为真当且仅当 `errors` 为空。
**Validates: Requirements 12.1, 12.2, 12.3**

### Property 20: 校验确定且对输入顺序稳定
*对任意* WorkflowGraph，对其 `nodes`/`edges`/`loopScopes` 数组任意重排得到 `g'`，则 `validateGraph(g')` 与 `validateGraph(g)` 返回逐项相等的 `ValidationResult`（含错误的相同稳定顺序）。
**Validates: Requirements 12.4, 12.5**

### Property 21: 一次报告全部违反规则
*对任意* WorkflowGraph，若同时注入 N 个不同类别的违规，则 `validateGraph` 的错误集合同时包含全部 N 类对应的 Error_Code（不在首条错误处停止）。
**Validates: Requirements 12.6**

### 拓扑分析（R13, R14, R15, R16）

### Property 22: 拓扑序覆盖且尊重边
*对任意* Valid_Graph，`topologicalOrder` 恰好包含 Forward_Subgraph 的每个节点一次，且对每条前向边 `u→v`，`u` 在序列中的位置严格先于 `v`。
**Validates: Requirements 13.1, 13.2, 13.3**

### Property 23: 分层单调递增
*对任意* Valid_Graph，`layering` 满足 `layer(EntryNode) === 0`，且对每条前向边 `u→v`（u、v 均可达），`layer(v) > layer(u)`。
**Validates: Requirements 13.4, 13.5**

### Property 24: 拓扑序确定唯一
*对任意* Valid_Graph，对其节点/边数组任意重排，`topologicalOrder` 产出完全相同的序列。
**Validates: Requirements 13.6**

### Property 25: 可达/不可达分区
*对任意* WorkflowGraph，当 EntryNode 存在时它属于 `reachableNodes`；`reachableNodes` 与 `unreachableNodes` 互斥，且二者之并等于全部 Node_Id；每个 `orphanNodes` 成员均非 EntryNode 且在 Forward_Subgraph 中无入边。
**Validates: Requirements 14.1, 14.2, 14.3, 14.4, 14.5**

### Property 26: 环提取序列相邻有边
*对任意* WorkflowGraph，`detectCycles` 返回的每个环序列中相邻 Node_Id（含首尾相接）之间在 Forward_Subgraph 均存在有向边；当 Forward_Subgraph 无环时返回空集。
**Validates: Requirements 15.1, 15.2, 15.3, 15.4**

### Property 27: 关键路径连通且最大
*对任意* Valid_Graph，`criticalPath` 中相邻 Node_Id 之间均存在 Forward_Subgraph 中的有向边，且其节点数不小于任意从 EntryNode 出发的前向有向路径的节点数。
**Validates: Requirements 16.1, 16.2, 16.3**

### 图变更（R17）

### Property 28: 变更不修改输入图
*对任意* WorkflowGraph `g` 与任意一项变更操作，操作执行后 `g` 与其执行前的深拷贝逐字段相等（输入不可变）。
**Validates: Requirements 17.1**

### Property 29: addNode 语义
*对任意* WorkflowGraph：以图中不存在的 Node_Id 添加节点返回成功且结果含该节点；以已存在的 Node_Id 添加返回 `ok=false` 且 `code === DUPLICATE_NODE_ID`。
**Validates: Requirements 17.2, 17.3**

### Property 30: removeNode 级联删除边
*对任意* WorkflowGraph 与其任一节点 `n`，`removeNode(g, n)` 成功后，结果图不含 `n`，且不含任何以 `n` 为 Source_Endpoint 或 Target_Endpoint 的边。
**Validates: Requirements 17.4**

### Property 31: replaceNodeConfig 仅替换配置
*对任意* WorkflowGraph 与其任一节点 `n` 及任意新配置 `c`，`replaceNodeConfig` 成功后，结果图中 `n` 的 `config` 等于 `c`，而其 `id`、`type`、`inputs`、`outputs` 及其余所有节点、边、作用域、EntryNode 均不变。
**Validates: Requirements 17.5, 17.6, 17.7**

### Property 32: 变更操作幂等性
*对任意* Valid_Graph：对同一目标连续两次 `replaceNodeConfig`（同一配置）或两次 `removeNode`/`removeEdge`（同一 id）所得结果图，与仅执行一次所得结果图语义等价。
**Validates: Requirements 17.8**

### Property 33: remove∘add 往返恒等
*对任意* Valid_Graph 与其任一节点 `n`，先 `removeNode(g, n)` 再 `addNode` 复原 `n` 并重新添加其原有关联边，所得图与原图 `g` 语义等价。
**Validates: Requirements 17.9**

### 序列化（R18）

### Property 34: 序列化往返语义恒等
*对任意* WorkflowGraph `g`，`deserialize(serialize(g))` 成功且其图与 `g` 语义等价，并保留全部节点、边、作用域、EntryNode 标记及每个端口的 PortType 与 Required。
**Validates: Requirements 18.3, 18.7**

### Property 35: 规范字符串往返恒等
*对任意* WorkflowGraph `g`，令 `j = serialize(g)`，则 `serialize(deserialize(j).graph)` 与 `j` 逐字符相等。
**Validates: Requirements 18.4**

### Property 36: 规范化输出唯一
*对任意* WorkflowGraph `g`，对其节点/边/作用域/端口数组顺序及 `config` 对象键序任意重排得到语义等价的 `g'`，`serialize(g')` 与 `serialize(g)` 逐字符相等。
**Validates: Requirements 18.5**

### Property 37: 非法输入返回错误结果
*对任意* 不符合 Canonical_Json 结构的字符串（畸形 JSON、缺失必需字段、非法 PortType 串等），`deserialize` 返回 `ok=false` 的错误结果，而非抛出异常或产出图。
**Validates: Requirements 18.6**

## Error Handling

本层为纯库，不抛出非受控异常用于业务流程，而以**结果类型**显式表达失败：

1. **校验失败**：`validateGraph` 永不抛错，恒返回 `ValidationResult`。每条 `ValidationError` 携带稳定的 `ErrorCode`、人类可读 `message` 与结构化 `ErrorLocation`（涉及的 id / 类型字符串 / 环序列），供上层精确定位与展示。
2. **校验聚合与排序**：单次校验收集全部被违反规则的错误（R12.6），不短路。返回前按稳定排序键排序：先按 `ErrorCode` 的固定枚举次序，再按定位信息（`nodeIds`→`edgeIds`→`portIds`→`loopScopeIds` 的字典序拼接）。这保证 R12.4/12.5 的确定性与稳定性，且对输入数组顺序不敏感。
3. **变更失败**：`Graph_Mutator` 以 `MutationResult` 区分成功/错误：`addNode` 重复 id → `DUPLICATE_NODE_ID`；`addEdge` 重复 edge id → `DUPLICATE_EDGE_ID`；对不存在目标的 `removeNode`/`removeEdge`/`replaceNodeConfig` 采取"安全无操作即成功返回等价图"策略以支持幂等性（R17.8）。变更操作本身**不做完整校验**（保持纯粹与可组合），完整校验由调用方按需调用 `validateGraph`。
4. **反序列化失败**：`deserialize` 以 `DeserializeResult` 返回；遇到 `JSON.parse` 失败、结构缺失、字段类型不符或非法 PortType 串，返回带 `message`（及尽可能的 `position`）的错误结果，绝不部分构造或抛出（R18.6）。
5. **分析的前置条件**：`Graph_Analyzer` 假定输入为 Valid_Graph 时给出语义良好的拓扑序/分层/关键路径；对含环图，拓扑相关函数以"仅处理前向可达 DAG 部分"的方式保持全函数性，而 `detectCycles` 始终可用于提取环。函数文档须明确这一前置条件契约。
6. **非受控异常边界**：仅当遭遇违反类型契约的输入（TypeScript 类型已排除的情形）时才允许快速失败；这类情形不计入业务错误处理。

## Testing Strategy

### 总体方针：单元测试 + 属性测试双轨

- **属性测试 (PBT)**：本层主力。上文 37 条 Correctness Property 各对应**恰好一个** fast-check 属性测试，覆盖类型系统代数律、校验确定性/完备性、拓扑不变量、变更不可变性/往返性、序列化往返/唯一性。
- **单元测试 (example-based)**：用于具体示例、边界与构造确定值：
  - `emptyGraph()` 的字段（R1.6，EXAMPLE）。
  - 仅含 EntryNode 时 `criticalPath` 返回 `[entry]`（R16.4，EXAMPLE）。
  - 每个 `ErrorCode` 的最小可复现图（便于回归定位）。
  - `parsePortType` 对若干畸形串返回 `null`（R3.11 边界）。
  - `deserialize` 对若干畸形 JSON 串的错误结果（R18.6 边界示例）。

### fast-check 配置与标注约定

- 每个属性测试设置 `{ numRuns: 100 }`（或更高），确保充分随机覆盖。
- 每个属性测试以注释标注其设计属性，格式：
  `// Feature: workflow-graph-model, Property N: <属性标题>`
- 测试文件与源文件同目录、`*.test.ts` 命名（与现有 `app/web/src/lib/**` 约定一致）。
- 使用单次运行：`npm run test`（即 `vitest --run`），**不使用 watch 模式**。

### 自定义 Arbitraries（生成器）

集中放置于 `app/web/src/lib/workflow/arbitraries.ts`（仅测试期使用）：

- `arbitraryPortType(maxDepth)`：递归生成 PortType；基础类型为叶，`list`/`optional` 为受深度限制的内部节点（防止无限递归），覆盖嵌套组合。
- `arbitraryPort(direction)`：生成带随机 PortType 与 `required` 的端口；保证同方向 Port_Id 唯一（R2.4 前置）。
- `arbitraryWorkflowNode()`：随机 NodeType、随机 `config`（用 fast-check 的 JSON arbitrary）、随机输入/输出端口集合。
- `arbitraryWorkflowGraph()`：生成可能非法的随机图（节点/边/作用域 id 唯一性不保证），用于驱动校验"检出"类属性（Property 11–18、20、21）。
- `arbitraryValidGraph()`：构造**保证通过校验**的随机图（先随机生成节点并取唯一 id，再仅在类型兼容、arity≤1、入口无入边、前向无环的约束下加边，循环以良构回边 + LoopScope 声明加入），用于驱动分析与变更/序列化的不变量属性（Property 22–24、27–36）。
- 针对"注入单点违规"的属性（如 Property 11、12、14–18），在 `arbitraryValidGraph()` 基础上施加一次受控变异（duplicate id / 改引用 / 加多入边 / 翻转 required / 加入口入边 / 引入非良构环等），断言对应 Error_Code 必然出现——这是高价值的"变异即检出"模式。

### 等价与重排辅助

- `graphEquals(a, b)`：语义等价判定（忽略数组顺序），属性 9、32、33、34、36 依赖它。
- 重排辅助（测试内）：对图的 `nodes`/`edges`/`loopScopes` 及端口数组、`config` 键序做随机置换，用于确定性/唯一性属性（Property 20、24、36）。

### 测试到需求的可追溯性

每条属性测试的标注同时承载"Property N"与其在设计文档中的 `Validates: Requirements X.Y`，形成 需求 → 属性 → 测试 的双向可追溯链，便于审计覆盖完整性。

### PBT 适用性结论

本特性是纯函数 + 不可变数据结构库，具备清晰的输入/输出与丰富的全称不变量（代数律、往返、幂等、分区、单调、最大性、确定性），是属性测试的理想对象——因此本设计将 PBT 作为主要验证手段，并辅以少量示例/边界单元测试。不涉及 IaC、UI 渲染、外部服务或副作用，故无需快照/集成/mock 类替代策略。
