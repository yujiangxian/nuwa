# Implementation Plan: chat-session-organization（会话置顶与按时间分组）

## Overview

为女娲对话页（Chat_Page）的会话侧边栏新增「置顶 + 按时间分组」的纯前端组织能力。按「纯逻辑层 `sessionOrganize.ts` → 状态层 `uiStore.ts` 扩展 → UI 层 `ChatPage.tsx` 分组渲染」的依赖顺序推进，保证任意阶段前端均可通过类型检查与构建。纯逻辑层先行（被 store 与 UI 复用），状态层接入置顶字段与 action，UI 层最后接线整合，不留悬空 / 孤立代码。

实现语言为 TypeScript + React。8 条 Correctness Property 各对应一个属性测试任务（fast-check，最少 100 次迭代）；置顶持久化 / 归一 / 降级 / 失败（Req 3.*）以 fake-indexeddb 集成测试覆盖；侧边栏分组渲染与置顶交互（Req 7.*）以 @testing-library/react 组件测试覆盖；无回归（Req 8.*）由既有测试套件与构建验证覆盖。

实现指导：将设计转换为一系列可由代码生成 LLM 逐步实现的提示，每一步都建立在前一步之上，并以「接线整合」收尾，不留悬空 / 孤立代码。仅包含编写、修改、测试代码的任务。

## Tasks

- [x] 1. 纯逻辑层：实现 `lib/sessionOrganize.ts` 与属性测试
  - [x] 1.1 实现 `app/web/src/lib/sessionOrganize.ts` 全部纯函数与类型
    - 定义 `GroupKind`、`GROUP_ORDER`、`GROUP_TITLES`、`SessionGroup` 类型与常量
    - 从 `@/store/uiStore` 引入 `ChatSession` 类型
    - 实现 `isPinned(session)`：仅 `pinned===true` 视为置顶，缺失 / 非 true 一律未置顶（Req 1.4）
    - 实现 `normalizePinned(session)`：返回 `pinned` 归一为布尔的新会话，其余字段原样保留，纯函数不改入参、对布尔 `pinned` 幂等（Req 1.3）
    - 实现 `togglePinnedIn(sessions, id)` / `setPinnedIn(sessions, id, pinned)`：返回新数组，仅改命中会话的 `pinned`、其余会话同引用保留，不改入参（Req 2.1–2.4）
    - 实现 `dayDiff(updatedAt, currentTime)`：本地日历日零点之差，`Math.round` 抵消夏令时；`updatedAt` 不可解析返回 `+Infinity`，不抛出
    - 实现 `bucketOf(d)`：`d<=0→'today'`、`d===1→'yesterday'`、`2..6→'last7'`、`7..29→'last30'`、`d>=30→'earlier'`（Req 5.1–5.6）
    - 实现 `organizeSessions(sessions, currentTime)`：先按输入顺序分区到六个桶（置顶 → `'pinned'`，未置顶 → `bucketOf(dayDiff(...))`），各桶按 `updatedAt` 降序稳定排序，按 `GROUP_ORDER` 输出并省略空组，全程只读、确定性（Req 4.1–4.6, 6.1–6.5）
    - _Requirements: 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x]* 1.2 编写 `normalizePinned` 属性测试（fast-check，`app/web/src/lib/sessionOrganize.test.ts`，≥100 迭代）
    - **Property 1: 缺省归一**
    - **Validates: Requirements 1.3**
    - 注释标签：`// Feature: chat-session-organization, Property 1: ...`
    - 生成 `pinned` 为 `true` / `false` / 省略的会话，断言归一后 `pinned` 为布尔、其余字段不变、幂等

  - [x]* 1.3 编写 `togglePinnedIn` / `setPinnedIn` 属性测试（fast-check，`sessionOrganize.test.ts`，≥100 迭代）
    - **Property 2: 置顶切换局部性**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4**
    - 随机数组 + 命中 / 未命中 `id`，断言命中会话 `pinned` 取反 / 置位、其余字段不变，非命中会话深相等，入参不被修改

  - [x]* 1.4 编写 `organizeSessions` 划分唯一性属性测试（fast-check，`sessionOrganize.test.ts`，≥100 迭代）
    - **Property 3: 划分唯一性与归属**
    - **Validates: Requirements 1.4, 4.2, 4.3, 4.4**
    - 以会话 `id` 多重集合比较输入与输出展开相等；Pinned_Group 恰含全部 `pinned===true` 会话；未置顶会话恰在某一 Time_Bucket

  - [x]* 1.5 编写 `bucketOf` / 归桶一致性属性测试（fast-check，`sessionOrganize.test.ts`，≥100 迭代）
    - **Property 4: 分桶边界**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6**
    - 整数 `d` 生成器覆盖 `…,-3,0,1,2,6,7,29,30,31,…` 边界；由 Current_Time 反推 `updatedAt` 构造已知 Day_Diff 会话，断言 `organizeSessions` 归桶等于 `bucketOf(dayDiff(...))`

  - [x]* 1.6 编写 `organizeSessions` 组内降序与稳定属性测试（fast-check，`sessionOrganize.test.ts`，≥100 迭代）
    - **Property 5: 组内降序与稳定**
    - **Validates: Requirements 6.1, 6.5**
    - 生成含相等 `updatedAt` 的会话，断言各组内 `updatedAt` 非递增且相等者保持输入相对次序

  - [x]* 1.7 编写 `organizeSessions` 组间顺序与无空组属性测试（fast-check，`sessionOrganize.test.ts`，≥100 迭代）
    - **Property 6: 组间顺序与无空组**
    - **Validates: Requirements 6.2, 6.3, 6.4**
    - 断言输出 `kind` 序列是 `GROUP_ORDER` 的子序列，且每组 `sessions` 非空

  - [x]* 1.8 编写 `organizeSessions` 只读属性测试（fast-check，`sessionOrganize.test.ts`，≥100 迭代）
    - **Property 7: 只读**
    - **Validates: Requirements 4.5**
    - 调用前 `structuredClone` 输入，调用后与克隆深相等，断言入参数组与各会话未被修改

  - [x]* 1.9 编写 `organizeSessions` 确定性属性测试（fast-check，`sessionOrganize.test.ts`，≥100 迭代）
    - **Property 8: 确定性**
    - **Validates: Requirements 4.6**
    - 同 `sessions` 与同 `currentTime` 两次调用，断言输出深相等（分组数量、各组 `kind`、组内顺序一致）

  - [x]* 1.10 编写边界单元测试（Vitest，`sessionOrganize.test.ts`）
    - `dayDiff` 同日 / 昨日 / 跨夏令时日 / 非法 ISO（返回 `+Infinity`）
    - `bucketOf` 具体边界值（0,1,2,6,7,29,30）
    - `organizeSessions` 空数组返回 `[]`、全置顶、全未置顶、未来时间戳归入 `'today'`
    - _Requirements: 5.5, 5.6, 4.1, 6.4_

- [x] 2. 检查点（纯逻辑层）— 确保类型检查与属性测试通过
  - 运行 `tsc --noEmit` 与 `vitest --run`（含属性测试 ≥100 迭代）。Ensure all tests pass, ask the user if questions arise.

- [x] 3. 状态层：扩展 `store/uiStore.ts`
  - [x] 3.1 在 `ChatSession` 新增 `pinned: boolean` 字段并使 `createSession` 默认置 `false`
    - 在 `ChatSession` 接口加 `pinned: boolean`（带注释说明 Pinned_Flag）
    - `createSession` 构造的新会话设 `pinned: false`（Req 1.2）
    - 修正因新增必填字段导致的类型错误（其他构造 / 透传会话对象处自然携带既有 `pinned`）
    - _Requirements: 1.1, 1.2_

  - [x] 3.2 在 `loadSessions` 读取后做缺省归一
    - 从 `@/lib/sessionOrganize` 引入 `normalizePinned`
    - `getAllSessions()` 读回后对每条 `normalizePinned`，后续 `pickLatestSession` / `set` 使用归一结果（Req 1.3）
    - _Requirements: 1.3_

  - [x] 3.3 新增 `togglePin` / `setPinned` action
    - 在 `UIState` 声明 `togglePin(sessionId): Promise<void>` 与 `setPinned(sessionId, pinned): Promise<void>`
    - 从 `@/lib/sessionOrganize` 引入 `togglePinnedIn` / `setPinnedIn`
    - 实现「先改内存（`set({ sessions })`）→ 持久模式 `chatDb.saveSession(updated)` → 失败 `toastSaveFailed()`」范式（Req 2.1, 2.2, 3.1, 3.4）
    - 降级模式（`isPersistent===false`）仅改内存、跳过持久化（Req 3.2）；命中 `id` 为空（`updated` undefined）时跳过持久化、不抛出（Req 2.4）
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.4_

  - [x]* 3.4 编写置顶持久化 / 归一 / 恢复 / 降级 / 失败集成测试（Vitest + fake-indexeddb，`app/web/src/store/uiStore.pin.test.ts`，经 `setChatDbForTesting` 注入）
    - `createSession` 新会话 `pinned===false`（Req 1.2）
    - 持久模式 `togglePin` / `setPinned` 经 `saveSession` 落库，重新 `getAllSessions` 读回 `pinned` 已更新（Req 3.1）
    - `loadSessions` 对预置缺 `pinned` 记录归一为 `false`、含 `pinned` 记录恢复置顶（Req 1.3, 3.3）
    - 注入 `isPersistent=false` 验证仅改内存、不调 `saveSession`（Req 3.2）
    - 注入 reject 的 `saveSession` stub，验证失败保留内存新 `pinned` 且触发一次 toast（Req 3.4）
    - `togglePin` 不改 `updatedAt` / `title` / `characterId` / `voiceId` 及其他会话（Req 2.3, 2.4）
    - _Requirements: 1.2, 1.3, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4_

- [x] 4. UI 层：`ChatPage.tsx` 侧边栏分组渲染与置顶交互
  - [x] 4.1 将侧边栏会话列表由平铺改为按 `organizeSessions` 分组渲染
    - 从 `@/lib/sessionOrganize` 引入 `organizeSessions`、`isPinned`
    - 在渲染期取一次 `const now = new Date()`，派生 `const sessionGroups = organizeSessions(sessions, now)`（Req 7.1）
    - 把「Session List」分支（非搜索、非加载态）的 `sessions.map(...)` 改为遍历 `sessionGroups`：每组渲染组标题（`group.title`，Req 7.2）与组内会话项
    - 会话项沿用既有结构（图标、标题、相对时间 `formatRelativeTime`、双击重命名、删除二次确认）；以 `s.id === currentSessionId` 标记选中态（Req 7.5）；点击项调既有 `switchSession(s.id)`（Req 7.6）
    - 搜索视图（`showSearch`）与加载态分支保持不变（Req 8.2）
    - _Requirements: 7.1, 7.2, 7.5, 7.6_

  - [x] 4.2 新增置顶 / 取消置顶交互入口
    - 订阅 `const togglePin = useUIStore((s) => s.togglePin)`
    - 在每个会话项操作区（与既有删除按钮并列）新增置顶按钮，图标用 lucide 的 `Pin` / `PinOff`，`aria-label` 随 `isPinned(s)` 在「置顶」/「取消置顶」间切换
    - `onClick` 内 `e.stopPropagation()` 后调 `void togglePin(s.id)`，避免触发会话切换；切换后 store 更新 `sessions`，组件重渲染重新调用 `organizeSessions` 使会话在置顶组与时间桶间迁移（Req 7.3, 7.4）
    - _Requirements: 7.3, 7.4_

  - [x]* 4.3 编写 `ChatPage` 分组渲染与置顶交互组件测试（Vitest + @testing-library/react，`app/web/src/components/ChatPage.test.tsx`）
    - 按分组渲染会话与组标题、空组不渲染标题（Req 7.1, 7.2）
    - 每个会话项存在置顶 / 取消置顶入口（Req 7.3）
    - 点击置顶入口后会话迁移到置顶组并重渲染（Req 7.4）
    - Active_Session 选中态正确标记（Req 7.5）
    - 点击会话项调既有 `switchSession`（Req 7.6）
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

- [x] 5. 检查点（无回归）— 复用既有测试套件验证不回归
  - [x]* 5.1 运行既有无回归测试套件
    - 既有 `ChatPage.test.tsx`、`uiStore` 会话 / 消息 / 搜索测试、Voice_Loop（ASR / TTS）相关测试全部保持通过（Req 8.1, 8.2, 8.3）
    - 确认未新增后端调用、`POST /api/chat` 等契约不变（Req 8.4, 8.5）
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

- [x] 6. 最终检查点 — 整体类型检查、测试与构建通过
  - 运行 `tsc --noEmit`、`vitest --run`（含属性测试 ≥100 迭代）、`npm run build`（`tsc && vite build`）全部通过。Ensure all tests pass, ask the user if questions arise.

## Notes

- 标记 `*` 的子任务为可选（属性测试 / 单元 / 集成 / 组件 / 回归测试），可为更快 MVP 跳过；顶层任务与检查点不带 `*`。
- 每个任务标注对应 Requirements 子条款以保证可追溯。
- 8 条属性测试任务（1.2–1.9）一一对应设计的 Property 1–8，并标注 Validates 与 ≥100 迭代要求；均用 fast-check。
- 依赖顺序保证任意时刻前端均可编译：纯函数先行（被 store 与 UI 复用），状态层接入置顶字段与 action，UI 层最后接线。
- 本特性为纯前端增量增强：不改后端及 `POST /api/chat` / `GET /api/models` / `/api/downloads/*` 契约；Chat_DB 以 `id` 为 keyPath 整条 `put`，新增 `pinned` 字段无需 `DB_VERSION` 升级或迁移。
- 长时进程（`vite` / `vitest --watch`）请勿在自动化中启动；测试统一用 `--run` 单次执行。

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "3.1"] },
    { "id": 2, "tasks": ["1.3", "3.2"] },
    { "id": 3, "tasks": ["1.4", "3.3"] },
    { "id": 4, "tasks": ["1.5", "3.4", "4.1"] },
    { "id": 5, "tasks": ["1.6", "4.2"] },
    { "id": 6, "tasks": ["1.7", "4.3"] },
    { "id": 7, "tasks": ["1.8"] },
    { "id": 8, "tasks": ["1.9"] },
    { "id": 9, "tasks": ["1.10", "5.1"] }
  ]
}
```
