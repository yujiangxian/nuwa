# Requirements Document

## Introduction

「集成路线图」(integration-roadmap) 特性是一份**主集成路线图规格**，把女娲 Nuwa 项目中已存在的 18 个子规格（每个均已含 `requirements.md`、`design.md`、`tasks.md`）编排为一条**依赖有序的构建流水线**。本特性的最终目的是支撑**长时间、基本无人值守的自主执行**：用户希望把整条流水线排入队列，由 Kiro 通过「Run All Tasks」在较长的时间窗口内端到端地构建整个应用。

因此本路线图规格强调以下要点，并作为一个整体交付：

1. **清晰的模块范围（Module_Scope）**：为 18 个 Module_Unit 中的每一个标定边界、引用其既有子规格，避免范围漂移与重复实现。
2. **显式的模块间依赖排序（Dependency_Graph）**：依据各子规格自述的「在已交付的 X 之上」关系，固化一张无环依赖图与一套构建相位（Build_Phase）。
3. **每模块的验收/验证标准（Definition_Of_Done）**：每个 Module_Unit 完成的判据可独立验证（构建通过、单元/属性测试通过、无回归），无需依赖后续模块即可判定。
4. **对长时间自主运行的韧性**：每个 Module_Unit 可独立验证、人工介入需求最小化、对阻塞（Blocker）优雅处理且可在中断后恢复。

本特性是一份**编排层规格**：它**不重写**任何既有子规格，只**引用**它们并定义其交付次序、集成点（Integration_Point）、完成判据与执行规则。本特性不修改任何子规格的 `requirements.md` / `design.md` / `tasks.md`，也不改变后端契约。

被编排的 18 个 Module_Unit（按子规格目录名）：`appearance-theme-mode`、`character-persona-management`、`chat-generation-parameters`、`chat-history-search`、`chat-input-slash-commands`、`chat-message-actions`、`chat-session-organization`、`chat-session-persistence`、`command-palette`、`context-window-management`、`conversation-export-import`、`markdown-message-rendering`、`model-management`、`prompt-preset-management`、`streaming-chat-output`、`ui-internationalization`、`voice-interaction-loop`、`voice-library-management`。

## Glossary

- **Nuwa_Web**: 前端 React 19 + TypeScript + Vite 应用，源码位于 `app/web/src`。
- **Voxcpm_Server**: 后端 Rust + Axum 服务（crate `voxcpm-server`），监听 `http://localhost:8080`，源码位于 `backend/server/src`。
- **Integration_Roadmap**: 本特性所定义的主集成路线图规格本体，承载 Module_Unit 清单、Dependency_Graph、Build_Phase 序列、各模块 Definition_Of_Done、Integration_Point 与执行规则。
- **Module_Unit**: 被本路线图编排的单个既有子规格，由其子规格目录名唯一标识（如 `chat-session-persistence`），其完整需求/设计/任务由该子规格自身的文档承载。
- **Module_Scope**: 单个 Module_Unit 的边界描述，含其负责的能力、对应子规格目录引用，以及明确排除项（不属于该模块的内容）。
- **Sub_Spec_Reference**: Module_Unit 指向其既有子规格文档（`.kiro/specs/<module>/requirements.md`、`design.md`、`tasks.md`）的引用，路线图通过该引用而非内联复制来描述模块细节。
- **Dependency_Graph**: 由全部 Module_Unit 作为节点、由 Dependency_Edge 作为有向边构成的有向无环图（DAG），表示模块间的构建先后约束。
- **Dependency_Edge**: 一条由 Module_Unit A 指向 Module_Unit B 的有向边，表示 B 是 A 的 Upstream_Dependency，即必须先完成 B 再构建 A。
- **Upstream_Dependency**: 对某个 Module_Unit 而言，其在 Dependency_Graph 中所有必须先完成的前置 Module_Unit 集合。
- **Build_Phase**: Dependency_Graph 的一个拓扑分层；同一 Build_Phase 内的 Module_Unit 之间无 Dependency_Edge，可按任意次序构建。
- **Phase_Order**: Build_Phase 之间的固定先后次序，编号自 0 起递增。
- **Foundation_Module**: 不依赖任何其他 Module_Unit 的 Module_Unit，位于编号最小的 Build_Phase。
- **Milestone**: 一个 Build_Phase 全部 Module_Unit 达到 Done_Status 时所对应的可交付节点。
- **Integration_Point**: 两个或多个 Module_Unit 之间共享的契约或集成边界（如 `uiStore` 状态切片、`Chat_DB` 数据层接口、`POST /api/chat/stream` 流式链路、`GET /api/voices` 音色列表、TTS 自动朗读规则）。
- **Definition_Of_Done**: 单个 Module_Unit 的完成判据集合（含其子规格任务全部完成、所属构建通过、单元与属性测试通过、声明的 Integration_Point 不破坏、无回归），满足后该模块进入 Done_Status。
- **Verification_Gate**: 在某个 Module_Unit 标记为 Done_Status 之前必须通过的一组自动化检查（构建/编译、测试、无回归校验），是 Definition_Of_Done 的可执行部分。
- **Module_Status**: 单个 Module_Unit 的执行状态，取值为 Pending_Status、In_Progress_Status、Done_Status 或 Blocked_Status 之一。
- **Pending_Status**: Module_Unit 尚未开始构建的状态。
- **In_Progress_Status**: Module_Unit 正在构建的状态。
- **Done_Status**: Module_Unit 已满足其 Definition_Of_Done 的状态。
- **Blocked_Status**: Module_Unit 因 Blocker 而无法继续构建的状态。
- **Blocker**: 阻止某个 Module_Unit 推进的具体障碍（如 Upstream_Dependency 未完成、Verification_Gate 失败、缺失外部前置条件）。
- **Build_Agent**: 执行本路线图的自主执行体（Kiro 经「Run All Tasks」驱动），按 Dependency_Graph 与执行规则依次构建各 Module_Unit。
- **Autonomous_Run**: Build_Agent 在最小人工干预下连续构建多个 Module_Unit 的一次长时运行过程。
- **Roadmap_State**: 记录每个 Module_Unit 当前 Module_Status 与各 Verification_Gate 结果的可持久化进度信息，用于在 Autonomous_Run 中断后恢复。
- **Integration_Test**: 跨 Module_Unit 验证 Integration_Point 行为的测试，区别于单个 Module_Unit 内部的单元/属性测试。
- **Regression_Suite**: 用于确认既有已完成 Module_Unit 行为未被后续模块破坏的测试集合。
- **Global_Invariant**: 在整条流水线任意时点都必须成立的项目级约束（如后端既有 API 契约不变、`npm run build` 可通过、已完成模块的测试持续通过）。

## Requirements

### Requirement 1: 模块清单与范围界定

**User Story:** 作为路线图维护者，我想让每个被编排的模块都有清晰的范围与对既有子规格的引用，以便自主执行时不偏离边界、不重复实现。

#### Acceptance Criteria

1. THE Integration_Roadmap SHALL 将 18 个既有子规格各登记为恰好一个 Module_Unit，使 Module_Unit 集合与子规格目录集合一一对应。
2. THE Integration_Roadmap SHALL 为每个 Module_Unit 提供一个 Module_Scope，描述该模块负责的能力与明确排除项。
3. THE Integration_Roadmap SHALL 为每个 Module_Unit 提供指向其子规格 `requirements.md`、`design.md` 与 `tasks.md` 的 Sub_Spec_Reference。
4. THE Integration_Roadmap SHALL 通过 Sub_Spec_Reference 引用各 Module_Unit 的需求与设计细节，且不在本路线图内复制或改写各子规格的验收标准。
5. WHERE 某个 Module_Unit 的能力与另一个 Module_Unit 的能力在边界上相邻，THE Integration_Roadmap SHALL 在二者的 Module_Scope 中标明该边界归属，使每项能力仅归属于一个 Module_Unit。

### Requirement 2: 依赖图与无环约束

**User Story:** 作为路线图维护者，我想用一张显式的有向无环依赖图固化模块间先后关系，以便构建次序可被确定性地推导。

#### Acceptance Criteria

1. THE Integration_Roadmap SHALL 定义一个 Dependency_Graph，其节点为全部 Module_Unit，其有向边为 Dependency_Edge。
2. WHERE 某子规格在其文档中声明「在已交付/已完成的 X 之上」构建，THE Integration_Roadmap SHALL 为该模块到模块 X 建立一条 Dependency_Edge（被依赖者为 Upstream_Dependency）。
3. THE Integration_Roadmap SHALL 使 Dependency_Graph 为有向无环图，不包含任何依赖环。
4. THE Integration_Roadmap SHALL 为每个 Module_Unit 显式列出其全部直接 Upstream_Dependency。
5. THE Integration_Roadmap SHALL 将 `voice-interaction-loop`、`model-management`、`ui-internationalization`、`appearance-theme-mode` 标识为 Foundation_Module，即不含任何 Upstream_Dependency 的 Module_Unit。
6. THE Integration_Roadmap SHALL 至少登记以下 Dependency_Edge：`chat-session-persistence` → `voice-interaction-loop`；`streaming-chat-output` → `chat-session-persistence`；`voice-library-management` → `voice-interaction-loop`；`character-persona-management` → `voice-library-management`；`chat-history-search` → `chat-session-persistence`；`chat-session-organization` → `chat-history-search`；`conversation-export-import` → `chat-session-persistence`；`chat-message-actions` → `streaming-chat-output`；`markdown-message-rendering` → `chat-message-actions`；`chat-generation-parameters` → `model-management`；`chat-generation-parameters` → `streaming-chat-output`；`context-window-management` → `model-management`；`context-window-management` → `chat-generation-parameters`；`prompt-preset-management` → `character-persona-management`；`chat-input-slash-commands` → `prompt-preset-management`；`chat-input-slash-commands` → `chat-message-actions`；`command-palette` → `appearance-theme-mode`；`command-palette` → `ui-internationalization`。

### Requirement 3: 构建相位与里程碑

**User Story:** 作为路线图执行者，我想把依赖图分层为有序的构建相位与里程碑，以便长时运行按可交付节点推进并便于检查进度。

#### Acceptance Criteria

1. THE Integration_Roadmap SHALL 将 Dependency_Graph 拓扑分层为若干 Build_Phase，并赋予每个 Build_Phase 唯一的 Phase_Order 编号。
2. THE Integration_Roadmap SHALL 使每个 Module_Unit 恰好归属于一个 Build_Phase。
3. THE Integration_Roadmap SHALL 使任一 Module_Unit 所属 Build_Phase 的 Phase_Order 严格大于其每个 Upstream_Dependency 所属 Build_Phase 的 Phase_Order。
4. THE Integration_Roadmap SHALL 使同一 Build_Phase 内的任意两个 Module_Unit 之间不存在 Dependency_Edge。
5. THE Integration_Roadmap SHALL 将全部 Foundation_Module 归入 Phase_Order 最小的 Build_Phase。
6. THE Integration_Roadmap SHALL 为每个 Build_Phase 定义一个 Milestone，该 Milestone 在该 Build_Phase 全部 Module_Unit 达到 Done_Status 时达成。

### Requirement 4: 跨模块集成点

**User Story:** 作为路线图执行者，我想识别模块间共享的契约与集成边界，以便在构建后续模块时复用而非破坏既有集成。

#### Acceptance Criteria

1. THE Integration_Roadmap SHALL 为每条 Dependency_Edge 标注其所依赖的一个或多个 Integration_Point。
2. THE Integration_Roadmap SHALL 至少登记以下 Integration_Point：`uiStore`（Zustand 全局状态切片）、`Chat_DB`（IndexedDB 数据层接口）、`POST /api/chat` 与 `POST /api/chat/stream`（对话与流式契约）、`GET /api/voices`（音色列表）、`/api/inference/*`（ASR/TTS 推理）、`/api/config` 与 `/api/config/set-model`（模型选择）、TTS 自动朗读（autoPlay）规则。
3. WHERE 某个 Module_Unit 扩展某个 Integration_Point（如向 `uiStore` 新增状态切片或向 `Chat_Session` 新增字段），THE Integration_Roadmap SHALL 要求该扩展以向后兼容方式进行，使依赖同一 Integration_Point 的既有 Module_Unit 行为不变。
4. WHERE 多个 Module_Unit 复用同一 Integration_Point，THE Integration_Roadmap SHALL 指明该 Integration_Point 的归属来源 Module_Unit（首次建立该契约的模块）。

### Requirement 5: 每模块的完成定义与验证门禁

**User Story:** 作为路线图执行者，我想为每个模块定义可独立验证的完成判据，以便在无人值守时确定性地判断模块是否真正完成。

#### Acceptance Criteria

1. THE Integration_Roadmap SHALL 为每个 Module_Unit 定义一个 Definition_Of_Done。
2. THE Integration_Roadmap SHALL 使每个 Module_Unit 的 Definition_Of_Done 包含：该模块子规格 `tasks.md` 中的全部任务被标记完成、所属项目构建（编译）通过、该模块的单元测试与属性测试通过、以及该模块声明的无回归约束被满足。
3. WHEN 某个 Module_Unit 的全部 Verification_Gate 通过，THE Integration_Roadmap SHALL 允许该 Module_Unit 进入 Done_Status。
4. IF 某个 Module_Unit 的任一 Verification_Gate 未通过，THEN THE Integration_Roadmap SHALL 阻止该 Module_Unit 进入 Done_Status。
5. THE Integration_Roadmap SHALL 使每个 Module_Unit 的 Definition_Of_Done 仅依赖该模块自身与其 Upstream_Dependency，不依赖任何下游（依赖于该模块的）Module_Unit。
6. THE Integration_Roadmap SHALL 使每个 Verification_Gate 以可自动执行的检查（构建命令、测试命令）表述，使其结果可在无人工判断下确定为通过或失败。

### Requirement 6: 集成测试要求

**User Story:** 作为路线图执行者，我想在模块完成时验证其与上游模块的集成行为，以便尽早发现跨模块回归。

#### Acceptance Criteria

1. WHERE 某个 Module_Unit 含至少一个 Upstream_Dependency，THE Integration_Roadmap SHALL 为该模块定义至少一个覆盖其与上游 Integration_Point 交互的 Integration_Test。
2. WHEN 某个 Module_Unit 进入 Verification_Gate 评估，THE Integration_Roadmap SHALL 要求该模块的 Integration_Test 与其单元/属性测试一并通过方可进入 Done_Status。
3. WHERE 某个 Integration_Point 涉及解析或序列化（如对话导出/导入 JSON、斜杠命令解析、按键组合解析），THE Integration_Roadmap SHALL 要求对应 Module_Unit 包含一个往返（round-trip）属性测试。
4. WHERE 某个 Integration_Point 为外部服务或基础设施行为（如 Ollama 流式响应、ASR/TTS Python 子进程），THE Integration_Roadmap SHALL 要求以少量（1 至 3 个）代表性用例的集成测试或 mock 验证，而非对外部服务做属性测试。

### Requirement 7: 依赖门控的执行排序

**User Story:** 作为路线图执行者，我想让构建严格按依赖就绪推进，以便自主运行不会在前置未完成时启动某模块。

#### Acceptance Criteria

1. WHEN Build_Agent 选择下一个待构建的 Module_Unit，THE Integration_Roadmap SHALL 仅允许选择其全部 Upstream_Dependency 均处于 Done_Status 的 Module_Unit。
2. IF 某个 Module_Unit 存在尚未处于 Done_Status 的 Upstream_Dependency，THEN THE Integration_Roadmap SHALL 阻止 Build_Agent 开始该 Module_Unit 的构建。
3. WHEN 同一 Build_Phase 内存在多个就绪的 Module_Unit，THE Integration_Roadmap SHALL 允许 Build_Agent 以任意次序逐个构建它们。
4. THE Integration_Roadmap SHALL 要求 Build_Agent 按 Phase_Order 升序推进，在低 Phase_Order 的 Build_Phase 全部达到 Done_Status 后再开始更高 Phase_Order 的 Module_Unit。
5. WHEN 一个 Build_Phase 的全部 Module_Unit 达到 Done_Status，THE Integration_Roadmap SHALL 将该 Build_Phase 对应的 Milestone 记为达成。

### Requirement 8: 无人值守长时运行的自主性

**User Story:** 作为发起长时构建的用户，我想让流水线在最小人工干预下连续执行，以便排队后由 Kiro 端到端构建整个应用。

#### Acceptance Criteria

1. WHEN 一个 Module_Unit 达到 Done_Status 且仍存在就绪的后续 Module_Unit，THE Build_Agent SHALL 自动继续构建下一个就绪的 Module_Unit 而不要求人工确认。
2. THE Integration_Roadmap SHALL 使每个 Module_Unit 的构建被组织为可由「Run All Tasks」连续执行的任务序列。
3. WHERE 某个步骤为长时运行进程（开发服务器、监视构建、交互式命令），THE Integration_Roadmap SHALL 要求以单次执行模式运行验证（如测试以单次运行模式而非监视模式），使 Autonomous_Run 不被阻塞进程挂起。
4. THE Integration_Roadmap SHALL 使每个 Module_Unit 的 Verification_Gate 可在不依赖人工输入的情况下自动判定通过或失败。
5. WHERE 某操作具破坏性或不可逆（删除数据、修改后端契约、生产环境变更），THE Integration_Roadmap SHALL 要求在 Autonomous_Run 中暂停并请求人工确认，而非自动执行。

### Requirement 9: 阻塞处理与韧性

**User Story:** 作为发起长时构建的用户，我想让流水线在遇到阻塞时优雅处理而非整体失败，以便单个模块的问题不会浪费整段无人值守时间。

#### Acceptance Criteria

1. IF 某个 Module_Unit 的 Verification_Gate 失败，THEN THE Integration_Roadmap SHALL 将该 Module_Unit 置为 Blocked_Status 并记录对应 Blocker。
2. WHEN 一个 Module_Unit 处于 Blocked_Status，THE Build_Agent SHALL 继续构建其依赖链不经过该被阻塞模块的其他就绪 Module_Unit。
3. IF 某个 Module_Unit 处于 Blocked_Status，THEN THE Integration_Roadmap SHALL 将其全部下游（直接或间接依赖该模块的）Module_Unit 保持在 Pending_Status 且不进入 In_Progress_Status。
4. WHEN 某个 Module_Unit 的构建连续两次因同一 Blocker 失败，THE Build_Agent SHALL 停止对该模块的重复尝试并记录该 Blocker 供人工处理。
5. WHEN 一个先前处于 Blocked_Status 的 Module_Unit 的 Blocker 被解除且其 Verification_Gate 通过，THE Integration_Roadmap SHALL 允许该 Module_Unit 及其下游 Module_Unit 恢复推进。

### Requirement 10: 进度跟踪与可恢复性

**User Story:** 作为发起长时构建的用户，我想让流水线进度被持续记录且可在中断后恢复，以便长时运行被打断后无需从头开始。

#### Acceptance Criteria

1. WHEN 任一 Module_Unit 的 Module_Status 发生变化，THE Integration_Roadmap SHALL 在 Roadmap_State 中更新该 Module_Unit 的 Module_Status。
2. THE Roadmap_State SHALL 在任意时点记录每个 Module_Unit 当前的 Module_Status。
3. WHEN Autonomous_Run 在中断后重新开始，THE Build_Agent SHALL 依据 Roadmap_State 跳过已处于 Done_Status 的 Module_Unit 并从下一个就绪的 Module_Unit 继续。
4. THE Integration_Roadmap SHALL 使 Roadmap_State 与依赖门控规则一致，即任一 Done_Status 的 Module_Unit 的全部 Upstream_Dependency 也处于 Done_Status。

### Requirement 11: 全局不变量与无回归约束

**User Story:** 作为路线图维护者，我想在整条流水线推进期间始终保持项目级约束，以便后续模块不破坏既有已完成模块与后端契约。

#### Acceptance Criteria

1. THE Integration_Roadmap SHALL 在每个 Module_Unit 进入 Done_Status 前要求 Nuwa_Web 的项目构建可通过。
2. WHEN 某个 Module_Unit 达到 Done_Status，THE Integration_Roadmap SHALL 要求全部先前已达 Done_Status 的 Module_Unit 的测试在 Regression_Suite 中仍然通过。
3. THE Integration_Roadmap SHALL 要求任一 Module_Unit 的构建不修改 Voxcpm_Server 既有 API 的请求与响应契约，除非该 Module_Unit 的子规格显式声明新增接口。
4. WHERE 某个 Module_Unit 的子规格声明了自身的无回归约束，THE Integration_Roadmap SHALL 将这些约束纳入该 Module_Unit 的 Definition_Of_Done。
5. THE Integration_Roadmap SHALL 在 Autonomous_Run 期间保持 Global_Invariant 成立，使任一时点已完成部分均处于构建可通过且测试通过的状态。
