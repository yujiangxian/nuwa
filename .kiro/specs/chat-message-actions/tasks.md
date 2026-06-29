# Implementation Plan: chat-message-actions

## Overview

按「数据层/纯函数层 → 状态层 → 组件层」的依赖顺序增量实现「对话消息操作」特性，保证任意检查点处 `tsc --noEmit` 均可通过、既有功能不回归。

- 先在 `lib/chatDb.ts` 新增 `deleteMessage` / `truncateMessagesAfter`，并新建纯函数 `lib/messageActions.ts`（`actionAvailabilityFor`）；这两层无外部依赖、可独立编译与测试。
- 再在 `store/uiStore.ts` 新增 `deleteMessage` / `regenerateLast` / `editAndResend` 三个 action，编排「先改内存 → 受 `isPersistent` 守卫持久化」。
- 最后改造 `components/ChatPage.tsx`：抽取可复用 `runAssistantStream`、渲染消息操作入口、实现 Copy / 内联编辑 / 复用 Stop。
- 每条设计正确性属性（Property 1–7）对应一个 fast-check 属性测试子任务（标 `*`，≥100 次迭代，用 `fake-indexeddb` 注入隔离 `ChatDb`）。
- 本特性使用 TypeScript（React 19 + Vite，`app/web`），不改动后端契约。

## Tasks

- [x] 1. 数据层与纯函数层（无外部依赖，先落地以保证 `tsc --noEmit` 通过）
  - [x] 1.1 在 `lib/chatDb.ts` 新增 `deleteMessage` 与 `truncateMessagesAfter`
    - 在 `ChatDb` 接口新增 `deleteMessage(messageId: string): Promise<void>` 与 `truncateMessagesAfter(sessionId: string, afterSeq: number): Promise<void>`，保持既有 6 个方法签名不变
    - 在 `createChatDb` 内实现：`deleteMessage` 单 readwrite 事务按 id 删除（id 不存在时 no-op）；`truncateMessagesAfter` 单 readwrite 事务 + `by-session` 索引游标，仅删除 `seq > afterSeq` 的记录（复用 `deleteSession` 的游标删除模式），并将两方法加入返回对象
    - _Requirements: 6.1, 6.2_

  - [x]* 1.2 为 `truncateMessagesAfter` 编写属性测试
    - **Property 2: 截断移除且仅移除 seq 更大的消息**
    - 在 `lib/chatDb.test.ts` 复用既有 `freshDb()` + `IDBFactory` 注入模式，用 fast-check 生成随机会话+按 seq 升序消息序列与任一 `afterSeq`，断言剩余恰为 `seq <= afterSeq` 的消息且不影响其他会话；≥100 次迭代
    - **Validates: Requirements 3.5, 6.2**

  - [x] 1.3 新建纯函数模块 `lib/messageActions.ts`
    - 导出 `ActionAvailability` 接口与 `actionAvailabilityFor(messages, index, isGenerating)` 纯函数，按设计可用性矩阵返回 `canCopy/canDelete/canRegenerate/canEdit`
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x]* 1.4 为 `actionAvailabilityFor` 编写属性测试
    - **Property 7: 消息操作可用性矩阵**
    - 新建 `lib/messageActions.test.ts`，用 fast-check 生成随机 `messages`/`index`/`isGenerating`，断言 `canCopy` 恒真、`canDelete === !isGenerating`、`canRegenerate === (isLastAssistant && !isGenerating)`、`canEdit === (role==='user' && !isGenerating)`；≥100 次迭代
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4**

  - [x]* 1.5 为 `shouldPersistFinal` 补充定型次数不变式属性测试
    - **Property 5: 定型持久化次数不变式**
    - 在既有 `lib/streamChat.test.ts` 中补充：用 fast-check 生成任意累积内容字符串，断言 `shouldPersistFinal(content)` 当且仅当内容非空为真（非空→恰一次定型、空→零次）；≥100 次迭代
    - **Validates: Requirements 2.4, 2.5, 2.7, 3.7**

- [x] 2. 检查点 - 数据层与纯函数层
  - 运行 `npm run build`（含 `tsc --noEmit`）确认编译通过，运行 `vitest --run` 确认 1.x 测试通过；如有问题，询问用户。

- [x] 3. 状态层：`store/uiStore.ts` 新增消息操作 actions
  - [x] 3.1 实现 `deleteMessage` / `regenerateLast` / `editAndResend`
    - 在 `UIState` 接口声明三个 action 并在 store 中实现，遵循「先改内存 → 受 `isPersistent` 守卫持久化 → 失败 `toastSaveFailed()`」既有模式
    - `deleteMessage`：移除指定消息（保序，filter 稳定），不存在则 no-op，不改 `title`/`updatedAt`；持久化调用 `chatDb.deleteMessage`
    - `regenerateLast`：仅当末条为 assistant 时移除并删除其记录，返回移除后历史 `{role,content}[]`，否则返回 `null`
    - `editAndResend`：定位 user 消息，`trim` 后为空则 no-op 返回 `null`；否则更新该消息 content、截断其后全部消息，持久化 `saveMessage`(seq=idx) + `truncateMessagesAfter`，返回截断后历史
    - _Requirements: 2.1, 3.2, 3.3, 3.4, 3.5, 5.1, 5.3, 5.4, 6.3, 6.4, 6.7, 8.2_

  - [x]* 3.2 删除单条消息后保序与 round-trip 属性测试
    - **Property 1: 删除单条消息后保序且内存与 Chat_DB round-trip 一致**
    - 新建 `store/uiStore.messageActions.test.ts`，以 `setChatDbForTesting` 注入 `fake-indexeddb` 包装的 `ChatDb`，生成随机会话+消息，执行 `deleteMessage`（含 `regenerateLast` 删尾）后断言：仅移除目标消息且其余保序、`chatDb.getMessages` 按 seq 升序恢复序列与内存等价、逐条删至空后 `messages` 为空且会话仍存在；≥100 次迭代
    - **Validates: Requirements 2.1, 5.1, 5.3, 5.4, 6.1, 6.4, 6.5**

  - [x]* 3.3 编辑重发 trim 与截断语义属性测试
    - **Property 3: 编辑重发的 trim 与截断语义及 round-trip 一致**
    - 在 `store/uiStore.messageActions.test.ts` 增加：生成随机会话/消息/指向 user 的下标/新内容，断言 `trim` 为空时 `messages` 与持久化完全不变且返回 `null`；非空时该 user 消息 `content === newContent.trim()`、其后全部移除、内存与 `getMessages` 恢复序列等价；≥100 次迭代
    - **Validates: Requirements 3.3, 3.4, 3.5, 6.4, 6.5**

  - [x]* 3.4 删除与截断保持会话 title 不变属性测试
    - **Property 4: 删除与截断保持会话 title 不变**
    - 在 `store/uiStore.messageActions.test.ts` 增加：执行 `deleteMessage` / `regenerateLast` / `editAndResend` 截断后，断言 Chat_Session 的 `title` 与操作前相等；≥100 次迭代
    - **Validates: Requirements 6.7**

  - [x]* 3.5 降级模式下仅内存变更属性测试
    - **Property 6: 降级模式下仅内存变更、不触发持久化写入**
    - 在 `store/uiStore.messageActions.test.ts` 增加：注入记录调用的 stub `ChatDb` 并设 `isPersistent=false`，执行三动作后断言内存 `messages` 已变更且未调用 `deleteMessage`/`truncateMessagesAfter`/`saveMessage`；≥100 次迭代
    - **Validates: Requirements 8.2**

- [x] 4. 检查点 - 状态层
  - 运行 `tsc --noEmit` 确认 app/web 编译通过，运行 `vitest --run` 确认 3.x 测试通过；如有问题，询问用户。

- [x] 5. 组件层：`components/ChatPage.tsx` 改造与接线
  - [x] 5.1 抽取可复用 `runAssistantStream` 并重构 `handleSend`
    - 将 `handleSend` 中「建连 → `consumeChatStream` 流式消费 → `accumulateDelta` → Fallback 改调 `POST /api/chat` → `shouldPersistFinal` 定型 `appendMessage` → `autoPlay` 时 `speakMessage`」抽为组件内 `useCallback runAssistantStream(payloadMessages)`，并改写 `handleSend` 为「落用户消息 → 计算 payload → `await runAssistantStream(...)`」，保持发送/流式/错误链路不变
    - _Requirements: 2.3, 2.4, 2.5, 3.6, 3.7, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [x] 5.2 渲染消息操作入口（Message_Actions）
    - 引入 store 的 `deleteMessage`/`regenerateLast`/`editAndResend` 选择器，为 `messages.map` 的每条已定型消息按 `actionAvailabilityFor` 渲染 Copy/Delete/Regenerate/Edit 入口；流式气泡（`isStreaming` 分支）不渲染任何操作入口；接线 Delete 调用 `deleteMessage`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 5.2_

  - [x] 5.3 实现 Copy_Action
    - 实现 `handleCopy(content)`：`navigator.clipboard.writeText` 成功展示「已复制」toast，失败展示「复制失败」toast；接线到 Copy 入口
    - _Requirements: 4.1, 4.2, 4.3_

  - [x] 5.4 接线 Regenerate 并复用 Stop_Action
    - 实现 `handleRegenerate`：Generating_State 时直接返回；调用 `regenerateLast`，返回 `null` 则不进入生成态，否则 `runAssistantStream(history)` 经 `isStreaming` 渲染 Placeholder；确认既有 `handleStop` 对 `runAssistantStream` 创建的 `abortController` 生效
    - _Requirements: 2.1, 2.2, 2.6, 2.7_

  - [x] 5.5 实现内联编辑态与 Edit_Resend 提交
    - 新增 `editingId`/`editDraft` 本地态，Edit 入口以原 `content` 预填进入内联编辑；实现 `submitEdit(messageId)`：清理编辑态后调用 `editAndResend(messageId, draft)`，返回 `null`（取消/空内容/非 user）则不发起生成，否则 `runAssistantStream(history)`；取消编辑不改任何消息
    - _Requirements: 3.1, 3.2, 3.8_

  - [x]* 5.6 扩展 ChatPage 单元/示例测试
    - 在 `components/ChatPage.test.tsx` 补充（mock fetch / `navigator.clipboard` / `speakMessage`）：Req 1.5 流式气泡无操作入口；Regenerate/Edit 交互、payload 内容、Placeholder、Stop 存在性；Copy 成功/失败 toast；删除后消息不再渲染；三个 store action 为 function；定型后 `updatedAt` 变更并持久化；autoPlay 开关、流式期间不朗读、降级、error chunk
    - _Requirements: 1.5, 2.2, 2.3, 2.6, 3.1, 3.2, 3.6, 3.8, 4.1, 4.2, 4.3, 5.2, 6.3, 6.6, 7.2, 7.3, 7.4, 7.5, 7.6_

- [x] 6. 最终检查点 - 编译、测试与无回归
  - 运行 `tsc --noEmit` 确认 app/web 类型检查通过。
  - 运行 `vitest --run` 执行完整套件，确认本特性测试全部通过，且既有 ChatPage / 会话持久化 / 语音交互 / 角色管理 / 模型管理与下载测试不回归（验证 Req 7.1, 8.1, 8.3, 8.4, 8.5, 8.6）。
  - 运行 `vite build`（`npm run build`）确认生产构建成功。
  - 如有失败，定位并修复后再次运行；如有疑问，询问用户。

## Notes

- 标 `*` 的子任务为可选测试任务，可为加速 MVP 跳过；核心实现任务不标 `*`。
- 依赖顺序保证每个检查点处 `app/web` 均可 `tsc --noEmit` 通过：数据层/纯函数层（任务 1）无外部依赖先落地，状态层（任务 3）依赖任务 1.1 的新 `ChatDb` 方法，组件层（任务 5）依赖任务 3.1 的 store action 与任务 1.3 的纯函数。
- Property 1–7 共 7 条正确性属性各自对应一个属性测试子任务（1.2、1.4、1.5、3.2、3.3、3.4、3.5），均用 fast-check（≥100 次迭代）并以 `fake-indexeddb` 注入隔离 `ChatDb`。
- 本特性不改动后端，`POST /api/chat` 与 `POST /api/chat/stream` 契约保持不变。
- 同一文件的多个任务被安排在不同 wave 中以避免写入冲突（见依赖图）。

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.3", "1.5"] },
    { "id": 1, "tasks": ["1.2", "1.4", "3.1"] },
    { "id": 2, "tasks": ["3.2", "5.1"] },
    { "id": 3, "tasks": ["3.3", "5.2"] },
    { "id": 4, "tasks": ["3.4", "5.3"] },
    { "id": 5, "tasks": ["3.5", "5.4"] },
    { "id": 6, "tasks": ["5.5"] },
    { "id": 7, "tasks": ["5.6"] }
  ]
}
```
