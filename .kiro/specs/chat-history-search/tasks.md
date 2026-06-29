# Implementation Plan: 聊天记录全局搜索 (chat-history-search)

## Overview

按"纯逻辑层 → 状态层 → UI 层 → 构建验证"的依赖顺序实现，保证任意一个任务完成后 `app/web` 仍可 `npx tsc --noEmit` 通过、应用可编译。

实现语言：**TypeScript**（沿用 `app/web` 的 React 19 + Vite 技术栈，设计文档未使用伪代码）。本特性为**纯前端**增强，不修改后端及 `POST /api/chat` 等契约。

依赖顺序与编译安全策略：
- **纯逻辑层** `lib/chatSearch.ts`（新增）仅依赖 `@/store/uiStore` 已导出的 `ChatSession` / `ChatMessage` 类型，可独立先行实现而不破坏现有编译。
- **状态层** `store/uiStore.ts` 扩展时，仅**新增** `searchQuery` / `searchResults` / `isSearching` 状态与 `setSearchQuery` / `runSearch` / `clearSearch` action 及私有 `assembleSearchCorpus` helper，不改既有字段与 action，故扩展前后既有 `ChatPage.tsx` 持续编译。
- **UI 层** `components/ChatPage.tsx` 扩展拆为三个**编辑同一文件**的子任务（输入与防抖 → 结果列表与高亮 → 导航与滚动定位），每个子任务结束时组件仍能编译；它们在依赖图中被排入不同 wave 以避免写冲突。

测试约定：
- 属性测试使用 **fast-check 3**（已装，不自行实现 PBT），每个属性独立一个 property-based 测试、`fc.assert(fc.property(...), { numRuns: 100 })`（最少 100 次迭代），并以注释标注 `// Feature: chat-history-search, Property {n}: {property_text}`。
- 全部 8 条属性测试均针对 `lib/chatSearch.ts` 纯函数，写入 `app/web/src/lib/chatSearch.test.ts`；因共享同一测试文件，各属性子任务在依赖图中被排入不同 wave。
- Chat_Store 语料组装集成测试使用既有 **fake-indexeddb**，经 `setChatDbForTesting` 注入，验证持久模式跨会话组装、降级模式与读取失败降级。
- 带 `*` 的子任务为可选测试任务（可跳过以加速 MVP），但仍纳入依赖图。

## Tasks

- [x] 1. 纯逻辑层 Chat_Search（`lib/chatSearch.ts`）
  - [x] 1.1 实现 `app/web/src/lib/chatSearch.ts`
    - 从 `@/store/uiStore` 复用 `ChatSession` / `ChatMessage` 类型
    - 导出常量 `SNIPPET_MAX_LENGTH = 100`、`DEBOUNCE_INTERVAL = 200`
    - 导出类型 `MatchType`、`HighlightRange`、`SearchCorpusEntry`、`SearchCorpus`、`SearchResult`
    - 实现 `normalizeQuery(query)`：去除首尾空白
    - 实现 `matchesQuery(text, normalizedQuery)`：以逐码点（`Array.from`）折叠大小写后做子串判定，`normalizedQuery` 为空返回 `false`
    - 实现 `buildSnippet(text, normalizedQuery, maxLength = SNIPPET_MAX_LENGTH)`：码点为单位；`n <= m` 返回整段；超长时按设计窗口算法（`q >= m` 取 `matchStart`，否则居中并 `clamp(0, n-m)`）保证 `q <= m` 时窗口完整包含首个匹配；未命中返回前缀
    - 实现 `computeHighlights(snippet, normalizedQuery)`：从左到右扫描、匹配后跳过整段，输出升序、互不重叠、每段落在边界内且与 query 折叠相等的区间；空 query 返回 `[]`
    - 实现 `searchCorpus(corpus, query)`：`nq` 为空返回 `[]`；对每会话标题产生至多一条 Title_Match、每条命中消息至多一条 Message_Match；按会话 `updatedAt` 降序，同会话内 Title 先于 Message、Message 按追加顺序（依赖稳定排序）
    - 全部为无副作用纯函数，不依赖 DOM / store / IndexedDB
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 5.1, 5.2, 5.3, 5.4, 5.5, 9.1_

  - [x]* 1.2 为 `normalizeQuery` 编写属性测试 `app/web/src/lib/chatSearch.test.ts`
    - **Property 1: 查询规范化等价 trim**
    - **Validates: Requirements 2.1**
    - 生成任意（含首尾空白 / 多字节）字符串 `query`；断言 `normalizeQuery(query)` 等于去首尾空白结果，且不以空白开头或结尾
    - `fc.assert(fc.property(...), { numRuns: 100 })`

  - [x]* 1.3 为 `matchesQuery` 编写属性测试（追加到 `app/web/src/lib/chatSearch.test.ts`）
    - **Property 2: 大小写不敏感匹配不变性**
    - **Validates: Requirements 2.3, 2.4**
    - 生成文本 `text`、非空 `nq`，并对 `text` 各字符随机翻转大小写得 `text'`；断言 `matchesQuery(text, nq)` 与 `matchesQuery(text', nq)` 一致，且等价于"`nq` 折叠后是 `text` 折叠后子串"；生成器避免改变码点数的特殊大小写字符（如 'İ'）
    - `numRuns: 100`

  - [x]* 1.4 为 `buildSnippet` 编写属性测试（追加到 `app/web/src/lib/chatSearch.test.ts`）
    - **Property 7: 片段包含首个匹配且截断到上限**
    - **Validates: Requirements 5.1, 5.3**
    - 生成文本 `text`、非空 `nq`（`nq` 码点数 `<= SNIPPET_MAX_LENGTH`，可由"先生成 q 再嵌入随机文本"制造命中正例）；断言结果码点数 `<= SNIPPET_MAX_LENGTH`，且 `nq` 为 `text` 子串时结果以大小写不敏感方式包含 `nq`
    - `numRuns: 100`

  - [x]* 1.5 为 `computeHighlights` 编写属性测试（追加到 `app/web/src/lib/chatSearch.test.ts`）
    - **Property 6: 高亮区间合法性（数量 / 边界 / 等值 / 升序不重叠）**
    - **Validates: Requirements 5.2, 5.4, 5.5**
    - 生成 `snippet` 与非空 `nq`；断言每区间 `0 <= start` 且 `start + length <= snippet 码点数`、对应子串与 `nq` 折叠相等且 `length == nq 码点数`、按 `start` 严格升序互不重叠、数量等于从左到右跳过整段的不重叠出现次数
    - `numRuns: 100`

  - [x]* 1.6 为 `searchCorpus` 空查询编写属性测试（追加到 `app/web/src/lib/chatSearch.test.ts`）
    - **Property 3: 空查询返回空结果**
    - **Validates: Requirements 2.2**
    - 生成任意 Search_Corpus 与仅由空白组成（或为空）的 `query`；断言 `searchCorpus(corpus, query)` 返回 `[]`
    - `numRuns: 100`

  - [x]* 1.7 为 `searchCorpus` 覆盖与唯一性编写属性测试（追加到 `app/web/src/lib/chatSearch.test.ts`）
    - **Property 4: 匹配覆盖、归属与每消息至多一条**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
    - 生成多会话语料与非空 `nq`（混合命中正例与不含 `nq` 的负例）；断言结果集合恰等于命中集合：(a) 标题命中会话恰一条 `title` 结果且 `sessionId` 正确；(b) 命中消息恰一条 `message` 结果且 `messageId` 与归属正确；(c) 全不含的会话无结果；(d) 任一 `messageId` 至多出现一次
    - `numRuns: 100`

  - [x]* 1.8 为 `searchCorpus` 排序编写属性测试（追加到 `app/web/src/lib/chatSearch.test.ts`）
    - **Property 5: 结果排序确定性**
    - **Validates: Requirements 3.6**
    - 生成多会话（含相等 `updatedAt`）、可变长消息序列与非空 `nq`；断言结果按会话 `updatedAt` 降序、同会话内 Title 先于全部 Message、Message 间按追加顺序，相等 `updatedAt` 的会话保持语料内相对次序（稳定）
    - `numRuns: 100`

  - [x]* 1.9 为 `searchCorpus` 只读编写属性测试（追加到 `app/web/src/lib/chatSearch.test.ts`）
    - **Property 8: 检索只读**
    - **Validates: Requirements 9.1**
    - 生成任意语料与任意 `query`；调用前 `structuredClone(corpus)`，调用 `searchCorpus` 后深相等比较，断言 `corpus` 及内部每个 `session` / `message` 不变
    - `numRuns: 100`

  - [x]* 1.10 为纯函数边界编写单元测试（追加到 `app/web/src/lib/chatSearch.test.ts`）
    - 覆盖：空串 / 纯空白 query、无匹配、相邻匹配、匹配跨截断边界、多字节（emoji / 代理对）切片不破坏字符
    - _Requirements: 2.1, 2.2, 5.3, 5.4_

- [x] 2. 检查点 - 确保纯逻辑层测试通过
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. 状态层 Chat_Store 扩展（`store/uiStore.ts`）
  - [x] 3.1 在 `app/web/src/store/uiStore.ts` 新增搜索状态与 action
    - 从 `@/lib/chatSearch` 引入 `searchCorpus` / `normalizeQuery` 及 `SearchResult` / `SearchCorpus` 类型
    - `UIState` 新增字段：`searchQuery: string`（初始 `''`）、`searchResults: SearchResult[]`（初始 `[]`）、`isSearching: boolean`（初始 `false`）
    - 实现 `setSearchQuery(query)`：仅 `set({ searchQuery: query })`
    - 实现 `clearSearch()`：`set({ searchQuery: '', searchResults: [], isSearching: false })`
    - 实现 `runSearch()`（async）：`nq = normalizeQuery(searchQuery)`，为空则 `set({ searchResults: [], isSearching: false })` 返回；否则置 `isSearching=true`，`await assembleSearchCorpus()`，`searchCorpus(corpus, searchQuery)`，写回 `searchResults` 并 `isSearching=false`
    - 实现模块内私有 `assembleSearchCorpus()`：持久模式经既有 `chatDb` 的 `getAllSessions` + 逐会话 `getMessages` 跨会话组装；`try/catch` 捕获读取失败降级到内存语料；Memory_Fallback_Mode（`isPersistent===false`）直接走内存语料（全部会话标题 + 当前会话已加载消息，其余 `[]`）
    - 只调用 Chat_DB 读取接口，不写入；导航复用既有 `switchSession`，不新增导航逻辑
    - _Requirements: 1.2, 4.1, 4.2, 4.3, 4.4, 9.1, 9.2_

  - [x]* 3.2 为语料组装与检索编写集成测试 `app/web/src/store/uiStore.search.test.ts`
    - 使用既有 **fake-indexeddb**，经 `setChatDbForTesting` 注入
    - 持久模式：跨会话写入会话与消息后 `runSearch` 返回正确结果（Req 4.1, 4.3, 4.4）
    - 降级模式：`isPersistent=false` 走内存语料组装（Req 4.2）
    - 读取失败：注入会 reject 的 `getAllSessions` / `getMessages`，断言降级到内存语料、不抛出、`runSearch` 正常返回（Req 9.2）
    - 空查询：`searchQuery` 为纯空白时 `runSearch` 置 `searchResults=[]`、`isSearching=false`（Req 2.2）
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 9.2_

- [x] 4. 检查点 - 确保 Chat_Store 测试通过
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. UI 层 Chat_Page 扩展（`components/ChatPage.tsx`）
  - [x] 5.1 接入搜索订阅、Search_Input 与防抖触发
    - 订阅 store 的 `searchQuery` / `searchResults` / `isSearching` 及 `setSearchQuery` / `runSearch` / `clearSearch`
    - 派生 `showSearch = normalizeQuery(searchQuery) !== ''`（从 `@/lib/chatSearch` 引入 `normalizeQuery`）
    - 在会话侧边栏会话列表区上方插入受控 Search_Input：`value={searchQuery}`、`onChange` 调 `setSearchQuery`、附清除按钮调 `clearSearch`
    - 防抖 effect：`normalizeQuery(searchQuery) === ''` 时不触发；否则 `setTimeout(() => void runSearch(), DEBOUNCE_INTERVAL)`，清理函数 `clearTimeout` 取消上一次计时
    - 此子任务结束时组件仍可编译（结果列表暂可沿用占位渲染或仅切换显隐）
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 8.1, 8.2_

  - [x] 5.2 实现 Search_Result_List 与高亮片段渲染
    - `showSearch` 为真时以 Search_Result_List 取代会话列表渲染
    - 每条结果展示所属会话标题 `result.sessionTitle`（Req 6.1）、`formatRelativeTime(result.updatedAt)`（复用 `@/lib/chatSession`，Req 6.2）、高亮片段（Req 6.3）
    - 实现 `renderHighlightedSnippet(snippet, highlights)`：以 `Array.from` 按码点切片，依 `HighlightRange[]` 切成普通段与 `<mark>` 高亮段
    - 空状态：`showSearch && !isSearching && searchResults.length === 0` 渲染「未找到匹配结果」提示（Req 6.4）
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [x] 5.3 实现点击结果导航与消息滚动定位
    - 新增 `messageRefs = useRef<Map<string, HTMLDivElement>>` 与 `pendingScrollId` 本地态；在每条消息容器挂 `ref` 收集 / 清理 DOM 引用
    - `handleResultClick(result)`：`await switchSession(result.sessionId)`（Req 7.1）→ `clearSearch()`（Req 7.4）→ Message_Match 且有 `messageId` 时 `setPendingScrollId(result.messageId)`
    - 新增 effect：`messages` 变更后若 `pendingScrollId` 命中 ref 则 `scrollIntoView`（Req 7.2），ref 缺失则不滚动并清空 `pendingScrollId`（Req 7.3）
    - 保留既有 `messagesEndRef` 自动滚底 effect 与发送 / 流式 / Voice_Loop 行为不回归
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 9.3, 9.4, 9.5_

  - [x]* 5.4 为搜索交互编写组件测试（追加/修改 `app/web/src/components/ChatPage.test.tsx`）
    - 覆盖：搜索框存在（1.1）、输入更新查询（1.2）、非空展示结果列表 / 清空恢复会话列表（1.3, 1.4, 7.4）、结果显示标题 + 相对时间 + `<mark>` 高亮（6.1, 6.2, 6.3）、空状态（6.4）、点击调用 `switchSession`（7.1）、Message_Match 触发 `scrollIntoView`（7.2）、不可定位时不滚动（7.3）、防抖以 `vi.useFakeTimers()` 验证仅触发一次最新查询（8.1, 8.2）
    - 通过 mock 网络与既有 `src/test/setup.ts` 验证，确认 Voice_Loop 无回归
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 6.1, 6.2, 6.3, 6.4, 7.1, 7.2, 7.3, 7.4, 8.1, 8.2_

- [x] 6. 最终检查点与构建验证
  - [x] 6.1 运行类型检查、测试与构建
    - 在 `app/web` 执行 `npx tsc --noEmit` 确认无类型错误
    - 执行 `npm test`（`vitest --run`）确认全部属性 / 集成 / 组件测试通过，且既有 `ChatPage` / `uiStore` / voice 等测试无回归（Req 9.3, 9.4, 9.5）
    - 执行 `npm run build`（`tsc && vite build`）确认构建通过
    - 确认未改动后端及 `POST /api/chat` / `GET /api/models` / `/api/downloads/*` 契约（Req 9.6）
    - _Requirements: 9.3, 9.4, 9.5, 9.6_

  - [x] 6.2 检查点 - 确保所有测试与构建通过
    - Ensure all tests pass, ask the user if questions arise.

## Notes

- 带 `*` 的子任务为可选测试任务，可跳过以加速 MVP；核心实现任务不可跳过。
- 每个任务标注对应 Requirements 子句以保证可追溯；每个属性测试显式引用设计文档中的 Property 编号与 Validates 子句。
- 8 条属性（Property 1–8）均针对 `lib/chatSearch.ts` 纯函数，使用 fast-check（`numRuns: 100`）并以注释标注 `// Feature: chat-history-search, Property {n}: {property_text}`；因共享 `chatSearch.test.ts`，依赖图中各属性子任务被排入不同 wave 以避免写冲突。
- Chat_Store 语料组装集成测试使用 `fake-indexeddb`，经 `setChatDbForTesting` 注入，覆盖持久 / 降级 / 读取失败降级。
- 编译安全：纯逻辑层先行且仅依赖既有导出类型；`uiStore` 仅新增搜索状态与 action 不改既有逻辑；`ChatPage` 三个编辑子任务（5.1/5.2/5.3）各自结束时组件仍可编译，确保任意时刻 `npx tsc --noEmit` 通过。
- 检查点用于增量验证；属性测试验证通用正确性，单元 / 集成 / 组件测试覆盖边界、语料组装降级与 UI 交互。

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "3.1"] },
    { "id": 2, "tasks": ["1.3", "3.2", "5.1"] },
    { "id": 3, "tasks": ["1.4", "5.2"] },
    { "id": 4, "tasks": ["1.5", "5.3"] },
    { "id": 5, "tasks": ["1.6", "5.4"] },
    { "id": 6, "tasks": ["1.7"] },
    { "id": 7, "tasks": ["1.8"] },
    { "id": 8, "tasks": ["1.9"] },
    { "id": 9, "tasks": ["1.10"] },
    { "id": 10, "tasks": ["6.1"] }
  ]
}
```
