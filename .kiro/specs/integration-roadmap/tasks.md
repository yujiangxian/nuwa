# Implementation Plan: integration-roadmap（集成路线图）

## Overview

本实现计划把「集成路线图」落地为一条**可由单次「Run All Tasks」端到端驱动**的构建流水线，分两大部分：

- **PART A — 构建路线图机制本体**：在 `app/web/src/lib/roadmap/` 下实现设计文档 Data Models 所列的纯结构与纯函数（`graph.ts`、`state.ts`、固定 18 节点图），并为 Correctness Properties（Property 1–9）各实现一个属性测试（fast-check + `vitest --run`，每个 ≥100 numRuns），最后生成初始 `ROADMAP.md`（Roadmap_State）并跑机制门禁。
- **PART B — 按相位/依赖严格顺序驱动 18 个 Module_Unit**：Phase 0 → Phase 4，逐模块「执行其子规格 tasks.md → 通过 Verification_Gate → 更新 ROADMAP.md」。

**执行约束（务必遵守）：**

- 所有构建/测试命令均为**单次执行**：构建用 `npm run build`（= `tsc && vite build`），测试用 `npm run test`（= `vitest --run`，单次模式）。**严禁** `npm run dev`、`vitest`(watch)、`vite preview` 等长时进程进入门禁（满足 R8.3）。
- 全部命令在 `app/web` 目录下执行。
- **不重写**任何子规格，PART B 通过引用其 `tasks.md` 实现模块（R1.4）。
- **依赖门控（R7.1/R7.2/R7.4）**：必须按下方「执行顺序与依赖图」严格推进——只有当某模块全部 Upstream_Dependency 处于 Done 时才开始该模块；低相位全部 Done 后才进入更高相位。
- **无回归（R11.1/R11.2）**：`vitest --run` 默认运行整个 `app/web` 测试目录，单次 `npm run test` 同时覆盖「本模块测试 + 既有模块回归」。
- **破坏性/不可逆操作（R8.5）**：若某模块步骤涉及删数据 / 改后端契约 / 生产变更，暂停并请求人工确认，不自动执行。

## 执行顺序与依赖图（Run All Tasks 推进序）

PART A 必须最先完成（先有机制与状态文件），随后 PART B 按相位升序、相位内任意序推进：

```
PART A: 机制纯函数 → 属性测试 → 生成 ROADMAP.md → 机制门禁
PART B:
  Phase 0 (Foundation, 无上游): voice-interaction-loop, model-management, ui-internationalization, appearance-theme-mode
  Phase 1: chat-session-persistence, voice-library-management, command-palette
  Phase 2: streaming-chat-output, chat-history-search, conversation-export-import, character-persona-management
  Phase 3: chat-session-organization, chat-message-actions, chat-generation-parameters, prompt-preset-management
  Phase 4: markdown-message-rendering, context-window-management, chat-input-slash-commands
```

每个模块的 ROADMAP.md 更新均写同一文件，故在依赖图中彼此置于不同 wave（强制串行，避免状态文件写冲突），这也与「相位升序 + 依赖就绪」的门控语义一致。

---

## Tasks

### PART A — 构建路线图机制本体（编排层自身代码 + 测试）

- [x] 1. 实现路线图机制纯结构与纯函数（`app/web/src/lib/roadmap/`）
  - [x] 1.1 定义固定 18 节点依赖图 `modules.ts`
    - 创建 `app/web/src/lib/roadmap/modules.ts`，导出 `ROADMAP_GRAPH: DependencyGraph`，按 design.md「依赖图」与「直接 Upstream_Dependency」表登记全部 18 个 `ModuleNode`（`id` = 子规格目录名、`upstreams`、`phaseOrder` 0..4）
    - 4 个 Foundation_Module（voice-interaction-loop / model-management / ui-internationalization / appearance-theme-mode）的 `upstreams` 为空、`phaseOrder=0`
    - 完整登记 R2.6 全部依赖边；导出 `ModuleStatus` / `GateResult` / `ModuleNode` / `ModuleState` / `DependencyGraph` / `RoadmapState` 类型（依 design.md Data Models）
    - _Requirements: 1.1, 2.1, 2.4, 2.5, 2.6, 3.2, 3.5_
  - [x] 1.2 实现依赖图纯函数 `graph.ts`
    - 创建 `app/web/src/lib/roadmap/graph.ts`，实现 `isAcyclic(g)`、`topoPhases(g)`（按 `phase = max(上游 phase)+1`，Foundation=0）、`readyModules(g, s)`（仅返回全部上游为 Done、自身 Pending 且无上游 Blocked 的模块，按 phaseOrder 升序）
    - 提供 `anyUpstreamBlocked(g, s, id)` 与传递闭包下游计算辅助
    - _Requirements: 2.3, 3.1, 3.3, 3.4, 7.1, 7.2, 7.4, 9.3_
  - [x] 1.3 实现状态判定与序列化 `state.ts`
    - 创建 `app/web/src/lib/roadmap/state.ts`，实现 `canMarkDone(g, s, id)`（仅依赖自身与上游状态，不读取下游）、`isStateConsistent(g, s)`（任一 Done 模块的全部上游也为 Done）
    - 实现 `serializeRoadmap(g, s): string`（生成 design.md 指定的 `ROADMAP.md` 复选框格式：每模块一节，含 status/upstreams/gate.*/blocker/attempts/updatedAt，复选框 `[x]` 当且仅当 status=Done）与 `parseRoadmap(text): RoadmapState`
    - _Requirements: 5.5, 10.1, 10.2, 10.4_

- [x] 2. 实现 Correctness Properties 1–9 的属性测试（fast-check，单文件单属性，≥100 numRuns）
  - [x] 2.1 Property 1 属性测试：依赖图无环
    - 在 `app/web/src/lib/roadmap/graph.acyclic.property.test.ts`，用自定义 `arbitraryDag` 验证 `isAcyclic` 对合法 DAG 返回真、对注入回边返回假；固定 18 节点图可被 `topoPhases` 成功分层
    - `// Feature: integration-roadmap, Property 1: 依赖图无环`；`fc.assert(..., { numRuns: 100 })`
    - _Requirements: 2.3_
  - [x] 2.2 Property 2 属性测试：相位严格单调（含同相位无边）
    - 在 `graph.phaseMonotonic.property.test.ts`，验证每条边 `A->B` 满足 `phase(A) > phase(B)`，同相位无边
    - `// Feature: integration-roadmap, Property 2: 相位严格单调（含同相位无边）`
    - _Requirements: 3.3, 3.4_
  - [x] 2.3 Property 3 属性测试：门控就绪只选上游全完成者
    - 在 `graph.ready.property.test.ts`，验证 `readyModules` 返回项的全部上游均为 Done，存在未 Done 上游者不出现
    - `// Feature: integration-roadmap, Property 3: 门控就绪只选上游全完成者`
    - _Requirements: 7.1, 7.2_
  - [x] 2.4 Property 4 属性测试：相位升序优先
    - 在 `graph.phaseFirst.property.test.ts`，验证首选就绪模块的 `phaseOrder` 不大于任何其它就绪模块
    - `// Feature: integration-roadmap, Property 4: 相位升序优先`
    - _Requirements: 7.4_
  - [x] 2.5 Property 5 属性测试：完成判定仅依赖自身与上游
    - 在 `state.canMarkDoneLocal.property.test.ts`，验证任意改变模块 m 的下游状态时 `canMarkDone(m)` 结果不变
    - `// Feature: integration-roadmap, Property 5: 完成判定仅依赖自身与上游`
    - _Requirements: 5.5_
  - [x] 2.6 Property 6 属性测试：被阻塞模块下游冻结且不被重试
    - 在 `graph.blockedFreeze.property.test.ts`，验证 Blocked 模块的传递闭包下游不出现在 `readyModules`；连续两次同因失败（attempts>=2 同因）后该模块本身不再被选取
    - `// Feature: integration-roadmap, Property 6: 被阻塞模块的下游冻结且不被重试选取`
    - _Requirements: 9.3, 9.4_
  - [x] 2.7 Property 7 属性测试：状态一致性不变量保持
    - 在 `state.consistency.property.test.ts`，用 `arbitraryConsistentState`（从一致初态做合法转移）验证每步后 `isStateConsistent` 仍为真
    - `// Feature: integration-roadmap, Property 7: 状态一致性不变量保持`
    - _Requirements: 10.4_
  - [x] 2.8 Property 8 属性测试：中断恢复等价（model-based）
    - 在 `state.resume.property.test.ts`，验证从任意一致中间状态恢复 `runAll` 不重复构建已 Done 模块，最终 Done 集合与从空白完整运行一致
    - `// Feature: integration-roadmap, Property 8: 中断恢复等价（model-based）`
    - _Requirements: 10.3_
  - [x] 2.9 Property 9 属性测试：Roadmap_State 序列化往返
    - 在 `state.serialize.property.test.ts`，用 `arbitraryRoadmapState` 验证 `parseRoadmap(serializeRoadmap(s))` 与 s 等价（status/gates/blocker/attempts/upstreams 一致）
    - `// Feature: integration-roadmap, Property 9: Roadmap_State 序列化往返`
    - _Requirements: 10.1, 10.2_

- [x] 3. 生成初始 Roadmap_State 并验证机制
  - [x] 3.1 生成初始 `ROADMAP.md`（Roadmap_State 文件）
    - 用 `serializeRoadmap` 在 `.kiro/specs/integration-roadmap/ROADMAP.md` 生成全部 18 个模块、按 Phase 0..4 分节、全部 `status: Pending`、`upstreams` 按 design.md 依赖表填入、gate.* 为 `-`、attempts=0、并标注 5 个 Milestone 标题（M0..M4）
    - _Requirements: 10.1, 10.2, 3.6_
  - [x] 3.2 机制门禁验证（build + test）
    - 在 `app/web` 下依次执行 `npm run build` 与 `npm run test`，确认机制纯函数编译通过且 Property 1–9 属性测试全部通过、无既有测试回归
    - _Requirements: 5.6, 8.3, 8.4, 11.1, 11.5_

### PART B — 按相位/依赖顺序驱动 18 个 Module_Unit

> 每个模块的 `.2` 验证门禁子任务统一执行：先 `npm run build`（exit=0），再 `npm run test`（`vitest --run`，全绿，覆盖本模块测试 + 全量回归），并确认该模块所需集成测试通过；任一失败则按 R9 置 Blocked、记录 Blocker、`attempts++`，不得进入 Done。

#### Phase 0 — Foundation（M0 基座就绪，无上游）

- [x] 4. [Phase 0] 模块 voice-interaction-loop（上游：无 / Foundation_Module）
  - [x] 4.1 执行子规格任务
    - 实现 voice-interaction-loop 子规格全部任务：#[[file:.kiro/specs/voice-interaction-loop/tasks.md]]
    - _Requirements: 1.3, 5.2, 8.2_
  - [x] 4.2 Verification_Gate（build + test）
    - `npm run build` 通过；`npm run test` 全绿（含本模块单元/属性测试）；ASR/TTS 等外部服务用 mock/代表用例（1–3）验证（R6.4）；Foundation 无上游，gate.integration 记 n/a
    - _Requirements: 5.2, 5.3, 5.4, 6.4, 11.1, 11.2_
  - [x] 4.3 更新 ROADMAP.md
    - 将 voice-interaction-loop 标记为 Done（`[x]` + status: Done + gate.* 结果 + updatedAt）
    - _Requirements: 10.1_

- [x] 5. [Phase 0] 模块 model-management（上游：无 / Foundation_Module）
  - [x] 5.1 执行子规格任务
    - 实现 model-management 子规格全部任务：#[[file:.kiro/specs/model-management/tasks.md]]
    - _Requirements: 1.3, 5.2, 8.2_
  - [x] 5.2 Verification_Gate（build + test）
    - `npm run build` 通过；`npm run test` 全绿；Foundation 无上游，gate.integration 记 n/a
    - _Requirements: 5.2, 5.3, 5.4, 11.1, 11.2_
  - [x] 5.3 更新 ROADMAP.md
    - 将 model-management 标记为 Done
    - _Requirements: 10.1_

- [x] 6. [Phase 0] 模块 ui-internationalization（上游：无 / Foundation_Module）
  - [x] 6.1 执行子规格任务
    - 实现 ui-internationalization 子规格全部任务：#[[file:.kiro/specs/ui-internationalization/tasks.md]]
    - _Requirements: 1.3, 5.2, 8.2_
  - [x] 6.2 Verification_Gate（build + test）
    - `npm run build` 通过；`npm run test` 全绿；Foundation 无上游，gate.integration 记 n/a
    - _Requirements: 5.2, 5.3, 5.4, 11.1, 11.2_
  - [x] 6.3 更新 ROADMAP.md
    - 将 ui-internationalization 标记为 Done
    - _Requirements: 10.1_

- [x] 7. [Phase 0] 模块 appearance-theme-mode（上游：无 / Foundation_Module）
  - [x] 7.1 执行子规格任务
    - 实现 appearance-theme-mode 子规格全部任务：#[[file:.kiro/specs/appearance-theme-mode/tasks.md]]
    - _Requirements: 1.3, 5.2, 8.2_
  - [x] 7.2 Verification_Gate（build + test）
    - `npm run build` 通过；`npm run test` 全绿；Foundation 无上游，gate.integration 记 n/a
    - _Requirements: 5.2, 5.3, 5.4, 11.1, 11.2_
  - [x] 7.3 更新 ROADMAP.md
    - 将 appearance-theme-mode 标记为 Done
    - _Requirements: 10.1_

- [x] 8. Checkpoint — Milestone M0 基座就绪
  - 确认 Phase 0 四个模块均为 Done、`npm run build` 与 `npm run test` 全绿，在 ROADMAP.md 标记 M0 达成；如出现问题请向用户确认。
  - _Requirements: 3.6, 7.5, 11.5_

#### Phase 1 — M1 持久化与库基座

- [x] 9. [Phase 1] 模块 chat-session-persistence（上游：voice-interaction-loop）
  - 门控：仅当 voice-interaction-loop 为 Done 时开始（R7.1/R7.2）
  - [x] 9.1 执行子规格任务
    - 实现 chat-session-persistence 子规格全部任务：#[[file:.kiro/specs/chat-session-persistence/tasks.md]]
    - _Requirements: 1.3, 5.2, 8.2_
  - [x] 9.2 Verification_Gate（build + test + 集成测试）
    - `npm run build`、`npm run test` 全绿；集成测试覆盖上游 Integration_Point `uiStore`/`Chat_DB`：Chat_DB ↔ Chat_Store 写入后重载恢复（fake-indexeddb），并含会话/消息 save→load **往返属性测试**（R6.3）
    - _Requirements: 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 11.1, 11.2_
  - [x] 9.3 更新 ROADMAP.md
    - 将 chat-session-persistence 标记为 Done
    - _Requirements: 10.1_

- [x] 10. [Phase 1] 模块 voice-library-management（上游：voice-interaction-loop）
  - 门控：仅当 voice-interaction-loop 为 Done 时开始
  - [x] 10.1 执行子规格任务
    - 实现 voice-library-management 子规格全部任务：#[[file:.kiro/specs/voice-library-management/tasks.md]]
    - _Requirements: 1.3, 5.2, 8.2_
  - [x] 10.2 Verification_Gate（build + test + 集成测试）
    - `npm run build`、`npm run test` 全绿；集成测试覆盖上游 `/api/voices` 与 `/api/inference/*`：音色列表加载 + 预览合成，用 1–3 个代表用例 / mock 验证外部服务（R6.4）
    - _Requirements: 5.2, 5.3, 5.4, 6.1, 6.2, 6.4, 11.1, 11.2_
  - [x] 10.3 更新 ROADMAP.md
    - 将 voice-library-management 标记为 Done
    - _Requirements: 10.1_

- [x] 11. [Phase 1] 模块 command-palette（上游：appearance-theme-mode, ui-internationalization）
  - 门控：仅当 appearance-theme-mode 与 ui-internationalization 均为 Done 时开始
  - [x] 11.1 执行子规格任务
    - 实现 command-palette 子规格全部任务：#[[file:.kiro/specs/command-palette/tasks.md]]
    - _Requirements: 1.3, 5.2, 8.2_
  - [x] 11.2 Verification_Gate（build + test + 集成测试）
    - `npm run build`、`npm run test` 全绿；集成测试覆盖上游 `uiStore`(主题/i18n)：面板命令触发主题切换 / 语言切换
    - _Requirements: 5.2, 5.3, 5.4, 6.1, 6.2, 11.1, 11.2_
  - [x] 11.3 更新 ROADMAP.md
    - 将 command-palette 标记为 Done
    - _Requirements: 10.1_

- [x] 12. Checkpoint — Milestone M1 持久化与库基座
  - 确认 Phase 1 三个模块均为 Done、build/test 全绿、Phase 0 无回归，在 ROADMAP.md 标记 M1 达成；如出现问题请向用户确认。
  - _Requirements: 3.6, 7.5, 11.2, 11.5_

#### Phase 2 — M2 对话核心增强

- [x] 13. [Phase 2] 模块 streaming-chat-output（上游：chat-session-persistence）
  - 门控：仅当 chat-session-persistence 为 Done 时开始
  - [x] 13.1 执行子规格任务
    - 实现 streaming-chat-output 子规格全部任务：#[[file:.kiro/specs/streaming-chat-output/tasks.md]]
    - _Requirements: 1.3, 5.2, 8.2_
  - [x] 13.2 Verification_Gate（build + test + 集成测试）
    - `npm run build`、`npm run test` 全绿；集成测试覆盖上游 `Chat_DB`/`POST /api/chat(/stream)`：NDJSON 流解析 + 定型后单次 appendMessage 持久化，并含 NDJSON 行解析 **往返属性测试**（R6.3）；外部流式用代表用例 / mock（R6.4）
    - _Requirements: 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 6.4, 11.1, 11.2_
  - [x] 13.3 更新 ROADMAP.md
    - 将 streaming-chat-output 标记为 Done
    - _Requirements: 10.1_

- [x] 14. [Phase 2] 模块 chat-history-search（上游：chat-session-persistence）
  - 门控：仅当 chat-session-persistence 为 Done 时开始
  - [x] 14.1 执行子规格任务
    - 实现 chat-history-search 子规格全部任务：#[[file:.kiro/specs/chat-history-search/tasks.md]]
    - _Requirements: 1.3, 5.2, 8.2_
  - [x] 14.2 Verification_Gate（build + test + 集成测试）
    - `npm run build`、`npm run test` 全绿；集成测试覆盖上游 `Chat_DB`：跨会话语料检索命中
    - _Requirements: 5.2, 5.3, 5.4, 6.1, 6.2, 11.1, 11.2_
  - [x] 14.3 更新 ROADMAP.md
    - 将 chat-history-search 标记为 Done
    - _Requirements: 10.1_

- [x] 15. [Phase 2] 模块 conversation-export-import（上游：chat-session-persistence）
  - 门控：仅当 chat-session-persistence 为 Done 时开始
  - [x] 15.1 执行子规格任务
    - 实现 conversation-export-import 子规格全部任务：#[[file:.kiro/specs/conversation-export-import/tasks.md]]
    - _Requirements: 1.3, 5.2, 8.2_
  - [x] 15.2 Verification_Gate（build + test + 集成测试）
    - `npm run build`、`npm run test` 全绿；集成测试覆盖上游 `Chat_DB`：导出→导入新建会话不覆盖既有，并含 **JSON 无损往返属性测试**（`parseImportBundle(JSON.stringify(buildExportBundle(x)))` 还原核心字段，R6.3）
    - _Requirements: 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 11.1, 11.2_
  - [x] 15.3 更新 ROADMAP.md
    - 将 conversation-export-import 标记为 Done
    - _Requirements: 10.1_

- [x] 16. [Phase 2] 模块 character-persona-management（上游：voice-library-management）
  - 门控：仅当 voice-library-management 为 Done 时开始
  - [x] 16.1 执行子规格任务
    - 实现 character-persona-management 子规格全部任务：#[[file:.kiro/specs/character-persona-management/tasks.md]]
    - _Requirements: 1.3, 5.2, 8.2_
  - [x] 16.2 Verification_Gate（build + test + 集成测试）
    - `npm run build`、`npm run test` 全绿；集成测试覆盖上游 `/api/voices`(音色绑定)：角色绑定音色后对话页生效，绑定试听用 mock（R6.4）
    - _Requirements: 5.2, 5.3, 5.4, 6.1, 6.2, 6.4, 11.1, 11.2_
  - [x] 16.3 更新 ROADMAP.md
    - 将 character-persona-management 标记为 Done
    - _Requirements: 10.1_

- [x] 17. Checkpoint — Milestone M2 对话核心增强
  - 确认 Phase 2 四个模块均为 Done、build/test 全绿、Phase 0–1 无回归，在 ROADMAP.md 标记 M2 达成；如出现问题请向用户确认。
  - _Requirements: 3.6, 7.5, 11.2, 11.5_

#### Phase 3 — M3 交互与参数

- [x] 18. [Phase 3] 模块 chat-session-organization（上游：chat-history-search）
  - 门控：仅当 chat-history-search 为 Done 时开始
  - [x] 18.1 执行子规格任务
    - 实现 chat-session-organization 子规格全部任务：#[[file:.kiro/specs/chat-session-organization/tasks.md]]
    - _Requirements: 1.3, 5.2, 8.2_
  - [x] 18.2 Verification_Gate（build + test + 集成测试）
    - `npm run build`、`npm run test` 全绿；集成测试覆盖上游 `Chat_DB`(搜索语料)：分组/置顶与检索联动
    - _Requirements: 5.2, 5.3, 5.4, 6.1, 6.2, 11.1, 11.2_
  - [x] 18.3 更新 ROADMAP.md
    - 将 chat-session-organization 标记为 Done
    - _Requirements: 10.1_

- [x] 19. [Phase 3] 模块 chat-message-actions（上游：streaming-chat-output）
  - 门控：仅当 streaming-chat-output 为 Done 时开始
  - [x] 19.1 执行子规格任务
    - 实现 chat-message-actions 子规格全部任务：#[[file:.kiro/specs/chat-message-actions/tasks.md]]
    - _Requirements: 1.3, 5.2, 8.2_
  - [x] 19.2 Verification_Gate（build + test + 集成测试）
    - `npm run build`、`npm run test` 全绿；集成测试覆盖上游 `POST /api/chat/stream`：重生成走流式链路；手动重放遵循 autoPlay 规则不重复朗读
    - _Requirements: 5.2, 5.3, 5.4, 6.1, 6.2, 11.1, 11.2_
  - [x] 19.3 更新 ROADMAP.md
    - 将 chat-message-actions 标记为 Done
    - _Requirements: 10.1_

- [x] 20. [Phase 3] 模块 chat-generation-parameters（上游：model-management, streaming-chat-output）
  - 门控：仅当 model-management 与 streaming-chat-output 均为 Done 时开始
  - [x] 20.1 执行子规格任务
    - 实现 chat-generation-parameters 子规格全部任务：#[[file:.kiro/specs/chat-generation-parameters/tasks.md]]
    - _Requirements: 1.3, 5.2, 8.2_
  - [x] 20.2 Verification_Gate（build + test + 集成测试）
    - `npm run build`、`npm run test` 全绿；集成测试覆盖上游 `/api/config` 与 `/api/chat/stream`：带参数的流式请求向后兼容透传；如涉及参数序列化则含参数序列化往返属性（R6.3）
    - _Requirements: 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 11.1, 11.2_
  - [x] 20.3 更新 ROADMAP.md
    - 将 chat-generation-parameters 标记为 Done
    - _Requirements: 10.1_

- [x] 21. [Phase 3] 模块 prompt-preset-management（上游：character-persona-management）
  - 门控：仅当 character-persona-management 为 Done 时开始
  - [x] 21.1 执行子规格任务
    - 实现 prompt-preset-management 子规格全部任务：#[[file:.kiro/specs/prompt-preset-management/tasks.md]]
    - _Requirements: 1.3, 5.2, 8.2_
  - [x] 21.2 Verification_Gate（build + test + 集成测试）
    - `npm run build`、`npm run test` 全绿；集成测试覆盖上游 `uiStore`(角色)：预设应用到角色系统提示；如涉及预设序列化则含预设 JSON 往返属性（R6.3）
    - _Requirements: 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 11.1, 11.2_
  - [x] 21.3 更新 ROADMAP.md
    - 将 prompt-preset-management 标记为 Done
    - _Requirements: 10.1_

- [x] 22. Checkpoint — Milestone M3 交互与参数
  - 确认 Phase 3 四个模块均为 Done、build/test 全绿、Phase 0–2 无回归，在 ROADMAP.md 标记 M3 达成；如出现问题请向用户确认。
  - _Requirements: 3.6, 7.5, 11.2, 11.5_

#### Phase 4 — M4 全功能完成

- [x] 23. [Phase 4] 模块 markdown-message-rendering（上游：chat-message-actions）
  - 门控：仅当 chat-message-actions 为 Done 时开始
  - [x] 23.1 执行子规格任务
    - 实现 markdown-message-rendering 子规格全部任务：#[[file:.kiro/specs/markdown-message-rendering/tasks.md]]
    - _Requirements: 1.3, 5.2, 8.2_
  - [x] 23.2 Verification_Gate（build + test + 集成测试）
    - `npm run build`、`npm run test` 全绿；集成测试覆盖上游消息体：渲染含代码块/链接的消息且安全净化生效
    - _Requirements: 5.2, 5.3, 5.4, 6.1, 6.2, 11.1, 11.2_
  - [x] 23.3 更新 ROADMAP.md
    - 将 markdown-message-rendering 标记为 Done
    - _Requirements: 10.1_

- [x] 24. [Phase 4] 模块 context-window-management（上游：model-management, chat-generation-parameters）
  - 门控：仅当 model-management 与 chat-generation-parameters 均为 Done 时开始
  - [x] 24.1 执行子规格任务
    - 实现 context-window-management 子规格全部任务：#[[file:.kiro/specs/context-window-management/tasks.md]]
    - _Requirements: 1.3, 5.2, 8.2_
  - [x] 24.2 Verification_Gate（build + test + 集成测试）
    - `npm run build`、`npm run test` 全绿；集成测试覆盖上游 `/api/config` 与生成参数：裁剪后历史长度受限，并含裁剪幂等/不变量属性测试（R6.3）
    - _Requirements: 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 11.1, 11.2_
  - [x] 24.3 更新 ROADMAP.md
    - 将 context-window-management 标记为 Done
    - _Requirements: 10.1_

- [x] 25. [Phase 4] 模块 chat-input-slash-commands（上游：prompt-preset-management, chat-message-actions）
  - 门控：仅当 prompt-preset-management 与 chat-message-actions 均为 Done 时开始
  - [x] 25.1 执行子规格任务
    - 实现 chat-input-slash-commands 子规格全部任务：#[[file:.kiro/specs/chat-input-slash-commands/tasks.md]]
    - _Requirements: 1.3, 5.2, 8.2_
  - [x] 25.2 Verification_Gate（build + test + 集成测试）
    - `npm run build`、`npm run test` 全绿；集成测试覆盖上游预设与消息操作：斜杠命令解析并执行，并含 **斜杠命令解析往返属性测试**（R6.3）
    - _Requirements: 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 11.1, 11.2_
  - [x] 25.3 更新 ROADMAP.md
    - 将 chat-input-slash-commands 标记为 Done
    - _Requirements: 10.1_

- [x] 26. Checkpoint — Milestone M4 全功能完成（流水线终点）
  - 确认全部 18 个模块均为 Done、`npm run build` 与 `npm run test` 全绿、全量回归通过，在 ROADMAP.md 标记 M4 达成且 Roadmap_State 一致（任一 Done 模块上游均 Done）；如出现问题请向用户确认。
  - _Requirements: 3.6, 7.5, 10.4, 11.2, 11.5_

## Notes

- 任务 2.1–2.9（Correctness Properties 1–9 属性测试）为**强制核心任务**，验证路线图机制本体的正确性，不得跳过；全部任务均须实现。
- PART A 先建立机制与状态文件，是 PART B 门控、恢复与进度跟踪的前提。
- PART B 各模块通过引用其子规格 `tasks.md` 实现，不重写子规格（R1.4）。
- 每个模块进入 Done 前必须通过其 Verification_Gate（build → test → 回归 → 集成），任一失败按 R9 置 Blocked、记录 Blocker、`attempts++`；连续两次同因失败则停止重试留待人工。
- 所有命令均为单次执行（`npm run build`、`vitest --run`），绝不启动 `dev`/watch/`preview` 等长时进程（R8.3）。
- Checkpoint 与顶层父任务不纳入下方依赖图；依赖图仅含叶子子任务，且共享 `ROADMAP.md` 的更新任务彼此置于不同 wave（强制串行）。

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["2.1", "2.2", "2.3", "2.4", "2.5", "2.6", "2.7", "2.8", "2.9", "3.1"] },
    { "id": 3, "tasks": ["3.2"] },
    { "id": 4, "tasks": ["4.1"] },
    { "id": 5, "tasks": ["4.2"] },
    { "id": 6, "tasks": ["4.3"] },
    { "id": 7, "tasks": ["5.1"] },
    { "id": 8, "tasks": ["5.2"] },
    { "id": 9, "tasks": ["5.3"] },
    { "id": 10, "tasks": ["6.1"] },
    { "id": 11, "tasks": ["6.2"] },
    { "id": 12, "tasks": ["6.3"] },
    { "id": 13, "tasks": ["7.1"] },
    { "id": 14, "tasks": ["7.2"] },
    { "id": 15, "tasks": ["7.3"] },
    { "id": 16, "tasks": ["9.1"] },
    { "id": 17, "tasks": ["9.2"] },
    { "id": 18, "tasks": ["9.3"] },
    { "id": 19, "tasks": ["10.1"] },
    { "id": 20, "tasks": ["10.2"] },
    { "id": 21, "tasks": ["10.3"] },
    { "id": 22, "tasks": ["11.1"] },
    { "id": 23, "tasks": ["11.2"] },
    { "id": 24, "tasks": ["11.3"] },
    { "id": 25, "tasks": ["13.1"] },
    { "id": 26, "tasks": ["13.2"] },
    { "id": 27, "tasks": ["13.3"] },
    { "id": 28, "tasks": ["14.1"] },
    { "id": 29, "tasks": ["14.2"] },
    { "id": 30, "tasks": ["14.3"] },
    { "id": 31, "tasks": ["15.1"] },
    { "id": 32, "tasks": ["15.2"] },
    { "id": 33, "tasks": ["15.3"] },
    { "id": 34, "tasks": ["16.1"] },
    { "id": 35, "tasks": ["16.2"] },
    { "id": 36, "tasks": ["16.3"] },
    { "id": 37, "tasks": ["18.1"] },
    { "id": 38, "tasks": ["18.2"] },
    { "id": 39, "tasks": ["18.3"] },
    { "id": 40, "tasks": ["19.1"] },
    { "id": 41, "tasks": ["19.2"] },
    { "id": 42, "tasks": ["19.3"] },
    { "id": 43, "tasks": ["20.1"] },
    { "id": 44, "tasks": ["20.2"] },
    { "id": 45, "tasks": ["20.3"] },
    { "id": 46, "tasks": ["21.1"] },
    { "id": 47, "tasks": ["21.2"] },
    { "id": 48, "tasks": ["21.3"] },
    { "id": 49, "tasks": ["23.1"] },
    { "id": 50, "tasks": ["23.2"] },
    { "id": 51, "tasks": ["23.3"] },
    { "id": 52, "tasks": ["24.1"] },
    { "id": 53, "tasks": ["24.2"] },
    { "id": 54, "tasks": ["24.3"] },
    { "id": 55, "tasks": ["25.1"] },
    { "id": 56, "tasks": ["25.2"] },
    { "id": 57, "tasks": ["25.3"] }
  ]
}
```
