# Implementation Plan: 会话历史持久化 (chat-session-persistence)

## Overview

按"纯逻辑层 → 持久化数据层 → 状态层 → UI 层 → 挂载与构建验证"的依赖顺序实现，保证任意一个任务完成后前端仍可 `tsc --noEmit` 通过。

实现语言：**TypeScript**（沿用 `app/web` 的 React 19 + Vite 技术栈，设计文档未使用伪代码）。

编译安全策略：
- 纯函数层（`chatTitle.ts`、`chatSession.ts`）与数据层（`chatDb.ts`）仅依赖 `uiStore.ts` 已导出的 `ChatSession`/`ChatMessage` 类型，可独立先行实现而不破坏现有编译。
- `uiStore.ts` 改造时**临时保留** `addMessage` 作为委托 `appendMessage` 的薄壳（shim），使现有 `ChatPage.tsx` 在迁移前持续编译；`addMessage` 的删除放在 `ChatPage.tsx` 迁移完成之后（任务 6.3）。
- `ChatSession`/`ChatMessage` 类型在改造后仍由 `uiStore.ts` 导出，保证 `chatTitle.ts`/`chatSession.ts`/`chatDb.ts` 持续编译。

测试约定：
- 属性测试使用 fast-check 3，每个属性独立一个测试、`{ numRuns: 100 }`（最少 100 次迭代），并以注释标注 `// Feature: chat-session-persistence, Property {n}: {property_text}`。
- Property 4 / 5 / 9 的 Chat_DB 往返测试使用 `fake-indexeddb`（注入 `createChatDb(fakeIndexedDB)` 或 `fake-indexeddb/auto`），每个用例独立数据库名并在 `afterEach` 清理。
- 带 `*` 的子任务为可选测试任务（可跳过以加速 MVP），但仍纳入依赖图。

## Tasks

- [x] 1. 测试依赖与纯逻辑层
  - [x] 1.1 在 `app/web/package.json` 新增 devDependency `fake-indexeddb`
    - 在 `devDependencies` 中加入 `fake-indexeddb`（用于 jsdom 下提供 IndexedDB 实现），生产依赖不变
    - 运行安装以更新 `package-lock.json`
    - _Requirements: 1.1_

  - [x] 1.2 实现 `app/web/src/lib/chatTitle.ts`
    - 导出常量 `DEFAULT_TITLE = '新对话'`、`TITLE_MAX_LENGTH = 20`
    - 实现纯函数 `deriveTitle(content: string, maxLen = TITLE_MAX_LENGTH): string`：去除首尾空白；按 Unicode 码点截断到 `maxLen`（不破坏多字节字符，使用 `Array.from`/扩展运算符按码点处理）；去空白后为空时返回 `DEFAULT_TITLE`
    - _Requirements: 6.2_

  - [x]* 1.3 为 `deriveTitle` 编写属性测试 `app/web/src/lib/chatTitle.test.ts`
    - **Property 1: 标题截断**
    - **Validates: Requirements 6.2**
    - 生成含多字节 / 纯空白 / 超长 / 长度 ∈ [1, maxLen] 的字符串与正整数 `maxLen`；断言：码点数 > maxLen 时结果恰为去空白内容前 maxLen 码点且是其前缀；∈ [1,maxLen] 时等于去空白内容；去空白为空时为 `DEFAULT_TITLE`；结果码点数恒 ≤ maxLen

  - [x] 1.4 实现 `app/web/src/lib/chatSession.ts`
    - 实现纯函数 `pickLatestSession(sessions: ChatSession[]): ChatSession | null`：从集合中选 `updatedAt`（ISO 字符串，字典序即时间序）最新者，空集合返回 `null`
    - 实现 `formatRelativeTime(iso: string): string`：把 ISO 时间戳格式化为"刚刚 / N 分钟前 / N 小时前 / 昨天 / 日期"等相对时间展示文本
    - 从 `@/store/uiStore` 复用 `ChatSession` 类型
    - _Requirements: 4.4, 7.1_

  - [x]* 1.5 为 `pickLatestSession` 编写属性测试 `app/web/src/lib/chatSession.test.ts`
    - **Property 6: 最新会话选取**
    - **Validates: Requirements 4.4, 7.1**
    - 生成非空会话集合（随机 ISO `updatedAt`）；断言返回值存在于集合中且其 `updatedAt` 不早于任意其他会话；对空集合断言返回 `null`

- [x] 2. 持久化数据层 Chat_DB
  - [x] 2.1 实现 `app/web/src/lib/chatDb.ts`
    - 导出 `interface PersistedMessage extends ChatMessage { sessionId: string; seq: number }`（从 `@/store/uiStore` 复用 `ChatSession`/`ChatMessage`）
    - 导出 `interface ChatDb`：`init()`、`getAllSessions()`、`getMessages(sessionId)`（按 `seq` 升序返回 `ChatMessage[]`）、`saveSession(session)`、`saveMessage(message: PersistedMessage)`、`deleteSession(sessionId)`，全部异步、失败 reject
    - 实现 `createChatDb(factory?: IDBFactory): ChatDb`，默认使用 `globalThis.indexedDB`；不在构造时抛错
    - IndexedDB 结构：库名 `nuwa-chat` 版本 `1`；object store `sessions`（keyPath `id`）；object store `messages`（keyPath `id`，索引 `by-session` = `sessionId` 非唯一）
    - `deleteSession` 在单个读写事务内删除会话记录并通过 `by-session` 游标删除其全部消息（原子）
    - `init()` 在 `globalThis.indexedDB` 缺失或 `open` 失败时 reject
    - _Requirements: 1.1, 1.6_

  - [x]* 2.2 为 Chat_DB 编写 schema 与接口存在性单元测试 `app/web/src/lib/chatDb.test.ts`
    - 使用 `fake-indexeddb` 注入；断言 `init()` 后 `sessions`/`messages` 两个 store 与 `by-session` 索引存在，且接口方法齐全
    - _Requirements: 1.1, 1.6_

  - [x]* 2.3 为会话往返编写属性测试（追加到 `app/web/src/lib/chatDb.test.ts`）
    - **Property 4: 会话持久化往返**
    - **Validates: Requirements 1.2, 1.4, 2.3, 5.2, 6.3**
    - 使用 `fake-indexeddb`；生成会话集合依次 `saveSession` 后 `getAllSessions` 按 `id` 等价（不丢不增、字段一致）；对同一 `id` 再次 `saveSession`（改 title/updatedAt）后读取得到最新值

  - [x]* 2.4 为消息往返与按序恢复编写属性测试（追加到 `app/web/src/lib/chatDb.test.ts`）
    - **Property 5: 消息往返与按序恢复**
    - **Validates: Requirements 1.3, 1.5, 3.2**
    - 使用 `fake-indexeddb`；生成会话 `id` 与可变长消息序列，按递增 `seq` `saveMessage` 后 `getMessages(id)` 在内容与顺序上等于追加序列，且每条 `sessionId` 等于该会话 `id`

  - [x]* 2.5 为删除会话编写数据层属性测试（追加到 `app/web/src/lib/chatDb.test.ts`）
    - **Property 9: 删除会话移除其消息且不影响其他会话（数据层部分）**
    - **Validates: Requirements 4.2, 4.6**
    - 使用 `fake-indexeddb`；生成多会话各持消息，`deleteSession(id)` 后 `getAllSessions` 不含该会话且 `getMessages(id)` 为空，其余会话及其消息序列保持不变

- [x] 3. 检查点 - 确保纯逻辑层与数据层测试通过
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Chat_Store 改造
  - [x] 4.1 改造 `app/web/src/store/uiStore.ts` 接入持久化
    - 移除硬编码 mock：`defaultSessions`（`s1`/`s2`）与初始 `messages`（`m1`/`m2`）
    - 初始状态：`sessions: []`、`currentSessionId: null`、`messages: []`、新增 `sessionsLoading: true`、`isPersistent: true`
    - `ChatSession.updatedAt` 语义改为 ISO 8601 时间戳字符串；新建/更新时写入 `new Date().toISOString()`
    - 通过 `createChatDb()` 持有 Chat_DB 实例；实现异步 actions：
      - `loadSessions()`：`init` → 失败则进入 Memory_Fallback_Mode（`isPersistent=false`、自动建内存会话、toast「本地历史无法保存」）；成功则 `getAllSessions`，存在会话用 `pickLatestSession` 选最新并 `getMessages` 恢复，无会话则 `createSession(currentCharacterId)`；读取失败按空集合走空状态；最终 `sessionsLoading=false`
      - `createSession(characterId)`：建空会话（`characterId`、`voiceId` 取角色绑定音色、`title=DEFAULT_TITLE`、ISO `updatedAt`），设为当前并清空 `messages`，`saveSession` 持久化
      - `switchSession(sessionId)`：已是当前则 `messages` 不变；否则设 `currentSessionId` 并 `getMessages` 替换 `messages`
      - `deleteSession(sessionId)`：`deleteSession` 删会话及消息；删的是当前且仍有会话则切到 `pickLatestSession` 并加载其消息；删的是当前且已无会话则进入空状态（自动建会话）；非当前则 `currentSessionId`/`messages` 不变
      - `renameSession(sessionId, title)`：`title.trim()` 非空才更新并 `saveSession`；为空则原值不变
      - `appendMessage(msg)`：push 到 `messages`；当 `msg.role==='user'`、当前会话 `title===DEFAULT_TITLE` 且此前无用户消息时用 `deriveTitle(msg.content)` 设标题；更新 Active_Session 的 `updatedAt`；以递增 `seq` `saveMessage` 并 `saveSession`
    - 降级：任一写操作 reject 时保留内存状态并 toast「保存失败」（复用 `useToastStore`）；`init` reject 设 `isPersistent=false`
    - **临时保留** `addMessage` 作为委托 `appendMessage` 的薄壳，避免 `ChatPage.tsx` 迁移前编译失败（任务 6.3 移除）
    - 保持 `ChatSession`/`ChatMessage` 类型继续导出
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 3.1, 3.2, 3.4, 4.2, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3, 6.1, 6.3, 6.4, 7.1, 7.2, 7.3, 8.6, 9.1, 9.3, 9.4_

  - [x]* 4.2 为新建会话编写属性测试 `app/web/src/store/uiStore.session.test.ts`
    - **Property 7: 新建会话字段派生与状态后置条件**
    - **Validates: Requirements 2.1, 2.2**
    - 生成角色集合与任一 `currentCharacterId`；`createSession` 后断言新会话 `characterId`/`voiceId`/`title=DEFAULT_TITLE`，`currentSessionId` 指向新会话且 `messages` 为空

  - [x]* 4.3 为切换会话编写属性测试（追加到 `uiStore.session.test.ts`）
    - **Property 8: 切换会话状态转移与幂等**
    - **Validates: Requirements 3.1, 3.4**
    - 生成多会话（各持消息序列）与目标 `id`；`switchSession(id)` 后 `currentSessionId===id` 且 `messages` 等于该会话持久化消息序列；`id` 已是当前时 `messages` 不变

  - [x]* 4.4 为自动标题编写属性测试（追加到 `uiStore.session.test.ts`）
    - **Property 2: 自动标题首条触发且单次**
    - **Validates: Requirements 6.1, 6.4**
    - 对 `title=DEFAULT_TITLE` 且无用户消息的会话追加任意非空用户消息后标题变为 `deriveTitle(content)`；对已有非默认标题的会话再追加任意用户消息标题不变

  - [x]* 4.5 为重命名编写属性测试（追加到 `uiStore.session.test.ts`）
    - **Property 3: 重命名 trim 语义**
    - **Validates: Requirements 5.1, 5.3**
    - 生成任意标题文本 `t`；`renameSession` 后 `t.trim()` 非空则标题等于 `t.trim()`，否则保持原值

  - [x]* 4.6 为追加消息更新 updatedAt 编写属性测试（追加到 `uiStore.session.test.ts`）
    - **Property 10: 追加消息更新 updatedAt 并持久化**
    - **Validates: Requirements 8.6**
    - `appendMessage` 后 Active_Session 的 `updatedAt` 不早于追加前的值，且持久模式下该会话与该消息均写入 Chat_DB（可用 `fake-indexeddb` 或 mock 数据层断言写入调用）

  - [x]* 4.7 为 currentSessionId 不变式编写基于模型的属性测试 `app/web/src/store/uiStore.invariant.test.ts`
    - **Property 11: currentSessionId 有效性不变式**
    - **Validates: Requirements 7.3**
    - 用 `fc.commands` 或随机操作序列（create/switch/delete/rename/appendMessage）配纯内存参考模型；执行后断言 `currentSessionId` 为 `null` 或指向 `sessions` 中存在的会话 `id`

  - [x]* 4.8 为错误降级分支编写单元测试 `app/web/src/store/uiStore.error.test.ts`
    - 注入会 reject 的 Chat_DB stub：`init` 失败 → Memory_Fallback_Mode（`isPersistent=false`、自动建会话、提示）；读取失败 → 空集合 + 空状态处理；写入失败 → 内存状态保留 + 提示
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

- [x] 5. 检查点 - 确保 Chat_Store 测试通过
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Chat_Page 改造、挂载与清理
  - [x] 6.1 改造 `app/web/src/components/ChatPage.tsx` 数据来源与加载/降级态
    - 删除本地 `messages` useState 与硬编码 m1/m2；改为 `useUIStore(s => s.messages)`
    - 删除组件本地 `ChatMessage` 接口，复用 `@/store/uiStore` 类型
    - 会话列表改为读取 store 的 `sessions`；选中高亮 `s.id === currentSessionId`
    - `sessionsLoading` 为真时侧边栏显示加载占位（不渲染任何硬编码占位会话/消息）
    - `isPersistent === false` 时对话区顶部显示非阻断提示条「本地历史无法保存」
    - 会话项 `updatedAt` 经 `formatRelativeTime` 格式化后展示
    - _Requirements: 7.4, 8.1, 8.2, 8.3, 9.2_

  - [x] 6.2 在 `ChatPage.tsx` 接入会话生命周期 UI 与消息落库（保持 Voice_Loop 不回归）
    - 新建：按钮 `onClick={() => createSession(currentCharacterId)}`
    - 切换：会话项 `onClick={() => switchSession(s.id)}`
    - 删除：每个会话项加删除按钮，点击二次确认（`window.confirm` 或内联确认 UI），确认后 `deleteSession(s.id)`，取消则不变更
    - 重命名：会话项双击/菜单进入编辑（内联 input 或 `window.prompt`），提交 `renameSession(s.id, text)`
    - `handleSend`：用户消息 `await appendMessage(userMsg)`；`POST /api/chat` 返回后 `await appendMessage(assistantMsg)`；后端/网络错误的本地兜底回复同样 `appendMessage` 落库
    - 保留既有 Voice_Loop：录音/ASR `transcribe` 接线与 `autoPlay` 时 `speakMessage`(TTS) 调用不回归
    - _Requirements: 2.4, 3.3, 4.1, 4.3, 5.4, 6.5, 8.4, 8.5, 9.5, 9.6_

  - [x] 6.3 触发启动初始化并清理临时兼容代码
    - 在 `App.tsx` 挂载时（或 ChatPage 首次挂载）调用一次 `loadSessions()`
    - 移除 `uiStore.ts` 中临时保留的 `addMessage` 薄壳（确认无其他引用后删除）
    - _Requirements: 7.1, 7.2, 8.3_

  - [x]* 6.4 改造/补充组件测试 `app/web/src/components/ChatPage.test.tsx`
    - 覆盖：新建/切换/删除（含二次确认与取消）/重命名 UI（Req 2.4, 3.3, 4.1, 4.3, 5.4, 6.5）；启动加载态与去 mock（Req 7.4, 8.1–8.3）；发送与 assistant 落库（Req 8.4, 8.5）；降级提示（Req 9.2）；Voice_Loop 无回归（录音/`transcribe` Req 9.5、`speakMessage`/TTS 播放 Req 9.6）
    - 通过 mock 网络与既有 `src/test/setup.ts` 验证
    - _Requirements: 2.4, 3.3, 4.1, 4.3, 5.4, 6.5, 7.4, 8.1, 8.2, 8.3, 8.4, 8.5, 9.2, 9.5, 9.6_

- [x] 7. 最终检查点与构建验证
  - [x] 7.1 运行类型检查、测试与构建
    - 在 `app/web` 执行 `npx tsc --noEmit` 确认无类型错误
    - 执行 `npm test`（`vitest --run`）确认全部单元/属性/组件测试通过，且既有 `ChatPage`/`useApi`/`useRecorder`/`useAudioPlayer`/`voice` 等测试无回归
    - 执行 `npm run build`（`tsc && vite build`）确认构建通过
    - 确认未改动后端及 `POST /api/chat` / `GET /api/models` / `/api/downloads/*` 契约
    - _Requirements: 9.7, 9.8_

- [x] 8. 检查点 - 确保所有测试与构建通过
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- 带 `*` 的子任务为可选测试任务，可跳过以加速 MVP；核心实现任务不可跳过。
- 每个任务标注对应 Requirements 子句以保证可追溯；每个属性测试显式引用设计文档中的 Property 编号与 Validates 子句。
- Property 4 / 5 / 9 的 Chat_DB 测试使用 `fake-indexeddb`；Property 2/3/7/8/10/11 在 Chat_Store 层测试。
- 编译安全：纯逻辑层与数据层先行且仅依赖既有导出类型；`uiStore` 改造期间临时保留 `addMessage` 薄壳，待 `ChatPage` 迁移后（任务 6.3）移除，确保任意时刻 `tsc --noEmit` 通过。
- 检查点用于增量验证；属性测试验证通用正确性，单元/组件测试覆盖 schema、错误降级与 UI 交互。

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.4", "2.1"] },
    { "id": 1, "tasks": ["1.3", "1.5", "2.2", "4.1"] },
    { "id": 2, "tasks": ["2.3", "4.2", "6.1"] },
    { "id": 3, "tasks": ["2.4", "4.3", "6.2"] },
    { "id": 4, "tasks": ["2.5", "4.4", "6.3"] },
    { "id": 5, "tasks": ["4.5", "6.4"] },
    { "id": 6, "tasks": ["4.6"] },
    { "id": 7, "tasks": ["4.7", "4.8"] },
    { "id": 8, "tasks": ["7.1"] }
  ]
}
```
