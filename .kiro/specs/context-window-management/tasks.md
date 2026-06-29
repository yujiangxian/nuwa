# Implementation Plan: context-window-management（上下文窗口与 Token 预算管理）

## Overview

把女娲对话页改造为对模型上下文窗口「可见 + 可控」。按「纯函数库先行 → Chat_Store 展示态 → UsageIndicator 组件 → ChatPage 集成（预算派生 / 告警 / Trim_Notice / 外发裁剪）→ 集成与回归」的依赖顺序推进，保证任意阶段均可编译。

四个纯函数库依次落地：`tokenEstimate.ts`（Token_Estimator）→ `contextWindow.ts`（Context_Resolver）→ `contextBudget.ts`（Context_Budget，依赖前两者）→ `contextTrim.ts`（Context_Trimmer，依赖 tokenEstimate）。13 条 Correctness Property 各对应一个 fast-check 属性测试子任务（与纯逻辑共置 `*.test.ts`，≥100 迭代，建议 `numRuns: 200`）。UI/集成/回归用示例级与集成测试覆盖。

实现指导：将设计转换为一系列可由代码生成 LLM 逐步实现的提示，每一步都建立在前一步之上，并以「接线整合」收尾，不留悬空/孤立代码。仅包含编写、修改、测试代码的任务。

语言/技术栈：TypeScript + React 19（沿用既有 Vite + Vitest + fast-check 约定）。纯逻辑放 `app/web/src/lib`，状态放 `app/web/src/store/uiStore.ts`，组件放 `app/web/src/components`，集成在 `app/web/src/components/ChatPage.tsx`。

## Tasks

- [x] 1. 实现 Token_Estimator 纯函数库（`lib/tokenEstimate.ts`）
  - [x] 1.1 创建 `app/web/src/lib/tokenEstimate.ts`
    - 导出常量 `MESSAGE_OVERHEAD_TOKENS = 4`
    - 实现 `charWeight(codePoint: number): number`：CJK/假名/谚文/全角等「重」字符权重 `1.0`，ASCII/拉丁/数字/空白/标点权重 `0.25`，其余（其它脚本、emoji 等）权重 `0.5`；所有权重非负
    - 实现 `estimateText(text: string): number`：用 `for...of` 按码点遍历（避免代理对被拆成两半），对各字符 `charWeight` 求和后 `Math.ceil`；空串返回 `0`，输出恒为非负整数
    - 实现 `estimateMessages(messages: ChatMessage[]): number`：`Σ(estimateText(m.content) + MESSAGE_OVERHEAD_TOKENS)`；空列表返回 `0`
    - 从 `@/store/uiStore` 导入 `ChatMessage` 类型
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [x]* 1.2 编写 `estimateText` 属性测试（fast-check，`app/web/src/lib/tokenEstimate.test.ts`，≥100 迭代）
    - **Property 1: Token 估算非负、确定且单调**
    - **Validates: Requirements 1.1, 1.3, 1.4**
    - 用 `fc.string()` 叠加 `fc.fullUnicodeString()` 覆盖 ASCII/CJK/emoji/代理对/空串/超长串；断言 `estimateText(A)` 为非负整数、重复调用结果相同、`estimateText(A+B) >= estimateText(A)` 且 `>= estimateText(B)`
    - 注释标签：`// Feature: context-window-management, Property 1: ...`

  - [x]* 1.3 编写 `estimateMessages` 属性测试（fast-check，`tokenEstimate.test.ts`，≥100 迭代）
    - **Property 2: 消息列表估算等于各消息估算之和**
    - **Validates: Requirements 1.5, 1.6**
    - 用 `fc.array(fc.record({ id, role: fc.constantFrom('user','assistant'), content }))` 断言 `estimateMessages(list) === Σ(estimateText(m.content)+MESSAGE_OVERHEAD_TOKENS)`，并验证追加任意一条消息不减少估算值

  - [x]* 1.4 编写 Token 估算边界示例单元测试（`tokenEstimate.test.ts`）
    - 显式断言 `estimateText('') === 0`（Req 1.2）与 `estimateMessages([]) === 0`（Req 1.6）
    - _Requirements: 1.2, 1.6_

- [x] 2. 实现 Context_Resolver 纯函数库（`lib/contextWindow.ts`）
  - [x] 2.1 创建 `app/web/src/lib/contextWindow.ts`
    - 导出常量 `DEFAULT_CONTEXT_LENGTH = 4096`
    - 导出接口 `ContextLengthResolution { contextLength: number; isEstimated: boolean }`
    - 实现 `resolveContextLength(candidate: number | null | undefined): ContextLengthResolution`：`Number.isInteger(candidate) && candidate > 0` → `{ contextLength: candidate, isEstimated: false }`；否则（undefined/null/NaN/Infinity/0/负数/小数）→ `{ contextLength: 4096, isEstimated: true }`；返回 `contextLength` 恒 `> 0`
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x]* 2.2 编写 `resolveContextLength` 属性测试（fast-check，`app/web/src/lib/contextWindow.test.ts`，≥100 迭代）
    - **Property 3: 上下文长度解析与回退**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4**
    - 覆盖正整数、`undefined`/`null`、非正、非整、非有限（NaN/Infinity）各类候选；断言正整数原样返回且 `isEstimated=false`，其余回退 `4096` 且 `isEstimated=true`，且任何情形 `contextLength > 0`

- [x] 3. 实现 Context_Budget 纯函数库（`lib/contextBudget.ts`）
  - [x] 3.1 创建 `app/web/src/lib/contextBudget.ts`
    - 导出常量 `DEFAULT_RESERVED_TOKENS = 512`、`WARNING_THRESHOLD = 0.8`
    - 导出类型 `UsageState = 'normal' | 'warning' | 'over'` 与接口 `ContextBudget { usedTokens, reservedTokens, remainingTokens, usageRatio, usageState, contextLength, isEstimated }`
    - 实现 `resolveReservedTokens(params: ChatGenParams): number`：`numPredict` 为 Active 且其值为正整数时取该值，否则（Inactive、`-1`、非正、非整）取 `512`
    - 实现 `computeBudget(input)`：`usedTokens = estimateText(systemPrompt) + estimateMessages(messages)`（systemPrompt 缺省按空串）；`remainingTokens = contextLength - usedTokens - reservedTokens`（可为负）；`usageRatio = clamp((usedTokens+reservedTokens)/contextLength, 0, 1)`；`usageState` 顺序判定：`used+reserved > contextLength` → `'over'`，否则 `usageRatio >= 0.8` → `'warning'`，否则 `'normal'`
    - 从 `@/lib/tokenEstimate` 导入 `estimateText`/`estimateMessages`，从 `@/lib/generationParams` 导入 `ChatGenParams` 类型，从 `@/store/uiStore` 导入 `ChatMessage`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3_

  - [x]* 3.2 编写 `computeBudget` 的 Used_Tokens 属性测试（fast-check，`app/web/src/lib/contextBudget.test.ts`，≥100 迭代）
    - **Property 4: Used_Tokens 等于系统提示与全部消息估算之和**
    - **Validates: Requirements 3.1**
    - 对任意 systemPrompt 字符串与 ChatMessage 列表断言 `usedTokens === estimateText(systemPrompt) + estimateMessages(messages)`

  - [x]* 3.3 编写 `resolveReservedTokens` 属性测试（fast-check，`contextBudget.test.ts`，≥100 迭代）
    - **Property 5: Reserved_Response_Tokens 由 Num_Predict 决定**
    - **Validates: Requirements 3.2**
    - 复用 `generationParams.test.ts` 的 `chatGenParamsArb` 思路，重点覆盖 `numPredict` 的 Active 正整数 / Inactive / `-1` / 非正 / 非整；Active 正整数返回该值，否则返回 `512`

  - [x]* 3.4 编写 Remaining_Tokens 与 Usage_Ratio 钳制属性测试（fast-check，`contextBudget.test.ts`，≥100 迭代）
    - **Property 6: Remaining_Tokens 等式与 Usage_Ratio 钳制**
    - **Validates: Requirements 3.3, 3.4**
    - `contextLength` 用 `fc.integer({min:1})`；断言 `remainingTokens === contextLength - usedTokens - reservedTokens`（允许为负），`usageRatio === clamp((usedTokens+reservedTokens)/contextLength,0,1)` 且恒落在 `[0,1]`

  - [x]* 3.5 编写 `computeBudget` 确定性属性测试（fast-check，`contextBudget.test.ts`，≥100 迭代）
    - **Property 7: 预算计算确定性**
    - **Validates: Requirements 3.5**
    - 相同 `contextLength`/`systemPrompt`/消息列表/`reservedTokens` 两次调用产生深度相等的 `ContextBudget`

  - [x]* 3.6 编写 Usage_State 三态分类属性测试（fast-check，`contextBudget.test.ts`，≥100 迭代）
    - **Property 8: Usage_State 三态分类正确**
    - **Validates: Requirements 4.1, 4.2, 4.3**
    - 混合极小/极大 `contextLength` 触发各分支；断言 `used+reserved > contextLength` → `'over'`，否则 `usageRatio >= 0.8` → `'warning'`，否则 `'normal'`

- [x] 4. 实现 Context_Trimmer 纯函数库（`lib/contextTrim.ts`）
  - [x] 4.1 创建 `app/web/src/lib/contextTrim.ts`
    - 导出接口 `TrimResult { messages: ChatMessage[]; trimmedCount: number }`
    - 实现 `trimMessages(input: { messages, systemPromptTokens, contextLength, reservedTokens }): TrimResult`：记 `fixed = systemPromptTokens + reservedTokens`、`fits(list) = fixed + estimateMessages(list) <= contextLength`；若 `fits(messages)` 直接返回 `{ messages, trimmedCount: 0 }`；否则从后向前定位 Latest_User_Message 索引 `keepIdx`，构造除 `keepIdx` 外的可裁剪索引队列（按出现顺序由旧到新），逐条标记删除并复算 `fits`，满足即停止，队列耗尽仍不满足也停止；用未删除原索引升序重组得到输入的保序子序列，`trimmedCount = 输入.length - 输出.length`
    - 处理边界：空消息列表 → `{ messages: [], trimmedCount: 0 }`；无任何 user 消息 → 无受保护项，按最旧优先正常裁剪；仅剩 Latest_User_Message 仍超预算 → 停止裁剪不丢弃受保护消息
    - 从 `@/lib/tokenEstimate` 导入 `estimateMessages`，从 `@/store/uiStore` 导入 `ChatMessage`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

  - [x]* 4.2 编写未超预算恒等且幂等属性测试（fast-check，`app/web/src/lib/contextTrim.test.ts`，≥100 迭代）
    - **Property 9: 未超预算时裁剪为恒等且幂等**
    - **Validates: Requirements 6.1**
    - 构造满足 `systemPromptTokens + reservedTokens + estimateMessages(messages) <= contextLength` 的输入断言返回 `messages` 与输入相等且 `trimmedCount === 0`；对任意输入断言 `trim(trim(x)) == trim(x)`（幂等）

  - [x]* 4.3 编写保留 System_Prompt 与 Latest_User_Message 属性测试（fast-check，`contextTrim.test.ts`，≥100 迭代）
    - **Property 10: 裁剪始终保留 System_Prompt 与 Latest_User_Message**
    - **Validates: Requirements 6.3, 6.4**
    - 断言输出从不包含/依赖 System_Prompt 文本（系统提示仅经 `systemPromptTokens` 计入预算）；当输入存在 `role==='user'` 消息时，Latest_User_Message 必定出现在输出中；覆盖「无 user 消息」「user 在中间/末尾」「全 assistant」形态

  - [x]* 4.4 编写保序子序列与最旧优先属性测试（fast-check，`contextTrim.test.ts`，≥100 迭代）
    - **Property 11: 裁剪输出为输入的保序子序列且优先丢弃最旧消息**
    - **Validates: Requirements 6.2, 6.5**
    - 用唯一 id 断言输出 id 序列是输入 id 序列的保序子序列；超预算且存在可裁剪消息时，保留的非 Latest_User_Message 消息均比被丢弃的更新（最旧优先丢弃）

  - [x]* 4.5 编写 trimmedCount 等式属性测试（fast-check，`contextTrim.test.ts`，≥100 迭代）
    - **Property 12: trimmedCount 等于输入与输出条数之差**
    - **Validates: Requirements 6.6**
    - 断言 `trimmedCount === 输入.length - 输出.length` 且为非负整数

  - [x]* 4.6 编写裁剪确定性属性测试（fast-check，`contextTrim.test.ts`，≥100 迭代）
    - **Property 13: 裁剪确定性**
    - **Validates: Requirements 6.7**
    - 相同输入消息/`systemPromptTokens`/`contextLength`/`reservedTokens` 两次调用产生相同 `TrimResult`

- [x] 5. 检查点（纯函数层）— 确保库与属性测试通过
  - 运行 `tsc --noEmit` 与 `vitest --run`（含 Property 1–13，≥100 迭代）。Ensure all tests pass, ask the user if questions arise.

- [x] 6. 扩展 Chat_Store 展示态（`store/uiStore.ts`）
  - [x] 6.1 在 `app/web/src/store/uiStore.ts` 新增裁剪展示态
    - 在 `UIState` 增加 `lastTrimmedCount: number`（初值 `0`）与 `setLastTrimmedCount: (n: number) => void`
    - `setLastTrimmedCount` 仅更新内存展示态，不触碰既有字段/持久化结构，保持既有导出签名不变（无回归）
    - _Requirements: 7.3, 8.1, 8.3_

  - [x]* 6.2 编写 `setLastTrimmedCount` 单元测试（`app/web/src/store/uiStore.contextTrim.test.ts`）
    - 断言初值为 `0`、`setLastTrimmedCount(n)` 后状态更新为 `n`，且不影响 `messages`/`settings`/`chatGenParams` 等既有字段
    - _Requirements: 7.3, 8.1, 8.3_

- [x] 7. 实现 Usage_Indicator 组件（`components/UsageIndicator.tsx`）
  - [x] 7.1 创建 `app/web/src/components/UsageIndicator.tsx`
    - 定义 `interface UsageIndicatorProps { budget: ContextBudget }`，无状态展示组件
    - 占用条：宽度按 `usageRatio` 呈现，并以文本展示 `usedTokens / contextLength` 占比；同时展示 `remainingTokens`
    - 状态样式：依 `usageState` 映射颜色（normal=中性、warning=琥珀、over=红）
    - 估算标记：`isEstimated` 为真时显示「估算」徽标 / `~` 前缀 + tooltip 说明为默认估算值
    - 从 `@/lib/contextBudget` 导入 `ContextBudget` 类型
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x]* 7.2 编写 `UsageIndicator` 示例测试（Vitest + Testing Library，`app/web/src/components/UsageIndicator.test.tsx`）
    - 占比文本/进度宽度存在（Req 5.1）；`normal`/`warning`/`over` 三态对应样式/类名（Req 5.2）；`isEstimated=true` 显示估算标记（Req 5.3）；改变 budget props 重渲染呈现更新后的 `usedTokens`/`remainingTokens`/`usageState`（Req 5.4）
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [x] 8. ChatPage 集成：预算派生与告警 / Trim_Notice 渲染
  - [x] 8.1 在 `app/web/src/components/ChatPage.tsx` 派生预算并渲染 UsageIndicator
    - 用 `useMemo` 派生 `budget`：`resolveContextLength(activeModelContextLength)` → `resolveReservedTokens(chatGenParams)` → `computeBudget({ contextLength, isEstimated, systemPrompt: currentCharacter?.systemPrompt ?? '', messages, reservedTokens })`；依赖项 `[messages, currentCharacter, chatGenParams, activeModelContextLength]`
    - `activeModelContextLength` 由 Active_Model 元数据候选值取得（当前多为 `undefined`，经 Resolver 走估算分支）
    - 在对话页头部渲染 `<UsageIndicator budget={budget} />`
    - _Requirements: 5.1, 5.4_

  - [x] 8.2 在 ChatPage 渲染告警与 Trim_Notice
    - `usageState === 'warning'` → 临近上下文上限告警条（Req 7.1）
    - `usageState === 'over'` → 已超出上下文上限告警条（Req 7.2）
    - `lastTrimmedCount > 0` → Trim_Notice：「已裁剪 N 条历史消息」（Req 7.3）
    - `usageState === 'normal' && lastTrimmedCount === 0` → 不渲染任何告警 / Trim_Notice（Req 7.4）
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [x]* 8.3 编写 ChatPage 告警 / Trim_Notice 示例测试（Vitest + Testing Library，`app/web/src/components/ChatPage.contextWindow.test.tsx`）
    - `warning` → 临近告警（7.1）；`over` → 超限告警（7.2）；`lastTrimmedCount > 0` → 「已裁剪 N 条」（7.3）；`normal` 且 `lastTrimmedCount === 0` → 无告警/Notice（7.4）
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [x] 9. ChatPage 集成：外发请求接入裁剪
  - [x] 9.1 在 `runAssistantStream` 构造 `payloadMessages` 处接入 `trimMessages`
    - 在构造下发 `messages` 之前：取 `systemPrompt = currentCharacter?.systemPrompt ?? ''`、`{ contextLength } = resolveContextLength(activeModelContextLength)`、`reservedTokens = resolveReservedTokens(chatGenParams)`
    - 调用 `trimMessages({ messages: payloadMessagesAsChatMessages, systemPromptTokens: estimateText(systemPrompt), contextLength, reservedTokens })`，得到 `{ messages: sendMessages, trimmedCount }`；把 `{ role, content }[]` 适配为 ChatMessage（必要时补稳定 `id`，仅用于裁剪内部保序）
    - 调用 `useUIStore.getState().setLastTrimmedCount(trimmedCount)`
    - 流式 `/api/chat/stream` 与降级 `/api/chat` 两条链路均使用同一 `sendMessages`；下发体保持既有形状 `{ messages: sendMessages.map(m=>({role:m.role,content:m.content})), system: systemPrompt, ...genFragment }`，不新增任何后端字段
    - _Requirements: 6.8, 8.5_

  - [x]* 9.2 编写裁剪接入与契约不变集成测试（Vitest，`app/web/src/components/ChatPage.contextTrim.integration.test.tsx`，mock `fetch`）
    - 发送使会话超预算的消息，断言请求体 `messages` 等于 `trimMessages` 输出（条数减少、保序）；请求体键集合恰为 `{ messages, system, ...genFragment }`，不含任何新增后端字段；降级到 `/api/chat` 时使用同一裁剪结果
    - _Requirements: 6.8, 8.5_

- [x] 10. 无回归测试套件
  - [x]* 10.1 运行并确保既有特性测试套件全绿
    - Session_Persistence 会话新建/切换/删除/重命名/历史恢复（8.1）、Streaming_Output 流式渲染/停止/降级（8.2）、Generation_Params 参数调节/持久化/下发（8.3）、Voice_Loop 麦克风输入/TTS（8.4）相关测试套件保持通过；确认本特性仅新增 lib 纯函数、uiStore 展示态与组件，未修改既有模块导出签名
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

- [x] 11. 最终检查点 — 整体验证
  - 运行 `tsc --noEmit`、`vitest --run`（含 Property 1–13 ≥100 迭代）、`vite build` 全部通过。Ensure all tests pass, ask the user if questions arise.

## Notes

- 标记 `*` 的子任务为可选（属性测试 / 单元 / 示例 / 集成 / 回归测试），可为更快 MVP 跳过；顶层任务与检查点不带 `*`。
- 13 条属性测试任务一一对应设计的 Property 1–13，均标注 Validates 与 ≥100 迭代要求，统一用 fast-check 并与纯逻辑共置 `*.test.ts`；注释标签格式 `// Feature: context-window-management, Property {n}: ...`。
- 依赖顺序保证任意时刻均可编译：纯函数库先行（`tokenEstimate` → `contextWindow` → `contextBudget` → `contextTrim`），其后是 store 展示态、UsageIndicator 组件，最后才是 ChatPage 集成与集成/回归测试。
- 本特性为纯增量增强：不改 `/api/chat/stream` → `/api/chat` 契约与请求体形状，不新增后端字段；裁剪只减少随请求下发的历史消息条数。
- 长时进程（`vite`/`vitest --watch`）请勿在自动化中启动；测试统一用 `vitest --run` 单次执行。

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4", "2.2", "3.1", "4.1"] },
    { "id": 2, "tasks": ["3.2", "3.3", "3.4", "3.5", "3.6", "4.2", "4.3", "4.4", "4.5", "4.6", "6.1", "7.1"] },
    { "id": 3, "tasks": ["6.2", "7.2", "8.1"] },
    { "id": 4, "tasks": ["8.2", "9.1"] },
    { "id": 5, "tasks": ["8.3", "9.2", "10.1"] }
  ]
}
```
