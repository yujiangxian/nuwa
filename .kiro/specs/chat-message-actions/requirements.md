# Requirements Document

## Introduction

「对话消息操作」(chat-message-actions) 特性在女娲 Nuwa 对话页（Chat_Page）为对话中的单条消息提供操作能力：重新生成最后一条 assistant 回复、编辑并重发某条用户消息、复制任意消息文本、删除单条消息。本特性以前端为主，复用既有 streaming-chat-output 的流式消费链路（`POST /api/chat/stream` 与 `consumeChatStream`）、chat-session-persistence 的 Chat_DB / Chat_Store 持久化（`appendMessage`、Message_Seq、`updatedAt`、自动标题）以及 voice-interaction-loop 的 TTS 自动朗读规则。

本特性为纯增量增强：不改动后端 `POST /api/chat`、`POST /api/chat/stream` 等既有 API 契约；仅在必要时于 Chat_Store（uiStore）与 Chat_DB 增加「删除单条消息」「按 Message_Seq 截断消息」以及对应的会话动作（重新生成、编辑重发），并保持既有发送、流式渲染、停止生成、会话生命周期、语音输入/朗读、角色与模型管理等功能不回归。

本特性覆盖以下相互关联的目标，作为一个整体交付：

1. 消息操作入口：在 Chat_Page 为每条消息暴露操作入口，并按消息角色与生成状态约束各操作的可用性。
2. 重新生成（Regenerate_Action）：对 Last_Assistant_Message 重新生成，复用流式链路替换原回复并持久化。
3. 编辑重发（Edit_Resend_Action）：编辑某条用户消息内容，截断其后全部消息并重新生成 assistant 回复。
4. 复制（Copy_Action）：把任意消息文本写入系统剪贴板。
5. 删除（Delete_Action）：删除单条消息及其 Chat_DB 持久化记录，并保持会话状态一致。
6. 数据层与持久化一致性：Chat_DB 与 Chat_Store 提供删除/截断/替换能力，保证操作后内存消息与持久化记录的 round-trip 一致。
7. 流式与 TTS 集成、错误处理与无回归：重新生成/编辑重发复用流式消费、降级与按 autoPlay 朗读规则，且既有功能不回归。

## Glossary

- **Nuwa_Web**: 前端 React 19 + Vite 应用，源码位于 `app/web/src`。
- **Voxcpm_Server**: 后端 Rust + Axum 服务（crate `voxcpm-server`），监听 8080，源码位于 `backend/server/src`。
- **Chat_Page**: Nuwa_Web 的「对话」页面，组件 `app/web/src/components/ChatPage.tsx`。
- **Chat_Store**: Nuwa_Web 的全局状态存储（Zustand），位于 `app/web/src/store/uiStore.ts`，管理 `sessions`、`currentSessionId`、`messages`，并提供 `appendMessage` 等动作。
- **Chat_DB**: 封装 IndexedDB 读写的持久化数据模块（`app/web/src/lib/chatDb.ts`），提供会话与消息的增删改查接口。
- **Chat_Session**: 一条会话记录，字段为 `{ id, title, characterId, voiceId, updatedAt }`。
- **Active_Session**: `currentSessionId` 所指向的 Chat_Session。
- **Chat_Message**: 一条消息记录，字段为 `{ id, role, content, audioUrl?, voiceName?, duration? }`，并归属于某个 Chat_Session。
- **Message_Seq**: chat-session-persistence 中持久化消息的单调递增排序键（`PersistedMessage.seq`），用于恢复时按追加顺序排序。
- **Message_Actions**: Chat_Page 在单条 Chat_Message 上提供的操作集合，包含 Copy_Action、Delete_Action，以及针对 Last_Assistant_Message 的 Regenerate_Action 与针对用户消息的 Edit_Resend_Action。
- **Last_Assistant_Message**: 当前 `messages` 中最后一条且 `role` 为 `assistant` 的 Chat_Message。
- **Regenerate_Action**: 用户对 Last_Assistant_Message 触发的重新生成操作。
- **Edit_Resend_Action**: 用户对某条 `role` 为 `user` 的 Chat_Message 触发的「编辑内容并重发」操作。
- **Copy_Action**: 用户对某条 Chat_Message 触发的「复制文本到剪贴板」操作。
- **Delete_Action**: 用户对某条 Chat_Message 触发的「删除该条消息」操作。
- **Message_Truncation**: 从 `messages` 中移除某条指定 Chat_Message 之后（即 Message_Seq 更大）的全部 Chat_Message，并删除其 Chat_DB 持久化记录的操作。
- **Regenerated_Message**: Regenerate_Action 或 Edit_Resend_Action 流式生成完成后产生的新的 assistant Final_Message。
- **Stream_Endpoint**: 既有流式对话接口 `POST /api/chat/stream`（streaming-chat-output 提供）。
- **Chat_Endpoint**: 既有非流式对话接口 `POST /api/chat`。
- **Stream_Chunk**: Stream_Endpoint 下发的单个数据块，承载增量文本（`delta`）、结束标志（`done`）或错误信息（`error`）之一。
- **Stream_Reader**: Nuwa_Web 中消费 Stream_Endpoint 响应流的客户端逻辑（`consumeChatStream`）。
- **Streaming_Message**: 流式生成期间展示的、随 Stream_Chunk 增量更新内容的 assistant Chat_Message。
- **Placeholder_Message**: Streaming_Message 在尚无任何增量内容时的初始空内容形态（显示生成中指示）。
- **Final_Message**: 流式生成正常完成或被停止后定型的 assistant Chat_Message。
- **Generating_State**: Chat_Page 表示「正在生成回复」的状态（对应 `isTyping` / `isStreaming` 等价状态），期间禁止再次发起发送。
- **Stop_Action**: 用户在生成过程中触发停止生成的操作，经 AbortController 中断流并保留已接收增量。
- **Fallback_Strategy**: 在产生任何增量文本前无法建立到 Stream_Endpoint 的流式连接时，Nuwa_Web 改用 Chat_Endpoint 完成本次回复的降级策略。
- **System_Prompt**: 当前 Character 的 `systemPrompt`，随对话请求作为 `system` 字段传给后端。
- **Auto_Play_Setting**: Nuwa_Web 设置项 `settings.autoPlay`，控制 assistant 回复是否自动 TTS 朗读。
- **Clipboard**: 浏览器系统剪贴板（`navigator.clipboard`）。
- **Session_Persistence**: 已交付的 chat-session-persistence 能力，由 Chat_Store 经 Chat_DB 将会话与消息持久化，并在追加消息时更新 `updatedAt` 与自动标题。
- **Voice_Loop**: 已交付的 voice-interaction-loop 能力，含 Chat_Page 的麦克风语音输入（ASR）与 assistant 回复 TTS 朗读（按 Auto_Play_Setting）。

## Requirements

### Requirement 1: 消息操作入口与可用性

**User Story:** 作为女娲用户，我想在每条消息上看到可用的操作入口，以便对消息进行复制、删除、重新生成或编辑重发。

#### Acceptance Criteria

1. THE Chat_Page SHALL 为 `messages` 中的每条已定型 Chat_Message 提供 Copy_Action 入口与 Delete_Action 入口。
2. THE Chat_Page SHALL 仅为 Last_Assistant_Message 提供 Regenerate_Action 入口。
3. THE Chat_Page SHALL 仅为 `role` 为 `user` 的 Chat_Message 提供 Edit_Resend_Action 入口。
4. WHILE Chat_Page 处于 Generating_State，THE Chat_Page SHALL 禁用 Regenerate_Action、Edit_Resend_Action 与 Delete_Action 的触发。
5. WHILE Chat_Page 正在展示 Streaming_Message 或 Placeholder_Message，THE Chat_Page SHALL 不为该 Streaming_Message 或 Placeholder_Message 提供 Message_Actions 入口。

### Requirement 2: 重新生成最后一条回复

**User Story:** 作为女娲用户，我想对最后一条 AI 回复重新生成，以便在回复不满意时获得另一份回复。

#### Acceptance Criteria

1. WHEN 用户对 Last_Assistant_Message 触发 Regenerate_Action，THE Chat_Store SHALL 从 `messages` 中移除该 Last_Assistant_Message 并通过 Chat_DB 删除其持久化记录。
2. WHEN Regenerate_Action 移除 Last_Assistant_Message 后，THE Chat_Page SHALL 进入 Generating_State 并展示一条 assistant Placeholder_Message。
3. WHEN Chat_Page 为 Regenerate_Action 发起生成，THE Chat_Page SHALL 以移除 Last_Assistant_Message 后的 `messages` 作为对话历史、并在存在 System_Prompt 时附带 System_Prompt，经 Stream_Endpoint 消费流式回复。
4. WHEN Regenerate_Action 的流式生成正常完成且累积内容非空，THE Chat_Page SHALL 将 Regenerated_Message 作为 assistant Final_Message 追加到 Active_Session 并通过 Session_Persistence 持久化。
5. IF Regenerate_Action 的生成结束后累积内容为空，THEN THE Chat_Page SHALL 移除 Placeholder_Message 且不产生空内容的 Final_Message。
6. WHILE Regenerate_Action 处于 Generating_State，THE Chat_Page SHALL 提供 Stop_Action。
7. WHEN 用户在 Regenerate_Action 生成过程中触发 Stop_Action 且已接收增量内容非空，THE Chat_Page SHALL 将已接收增量作为 Final_Message 追加并持久化。

### Requirement 3: 编辑并重发用户消息

**User Story:** 作为女娲用户，我想编辑我此前发出的某条消息并重新发送，以便修正措辞后获得对应的新回复。

#### Acceptance Criteria

1. WHEN 用户对某条 `role` 为 `user` 的 Chat_Message 触发 Edit_Resend_Action，THE Chat_Page SHALL 展示以该消息 `content` 预填的可编辑输入并等待用户提交或取消。
2. IF 用户取消 Edit_Resend_Action，THEN THE Chat_Store SHALL 保持该 Chat_Message 及其后的全部消息不变。
3. IF 用户提交的编辑内容去除首尾空白后为空，THEN THE Chat_Store SHALL 保持该 Chat_Message 及其后的全部消息不变。
4. WHEN 用户提交对某条 user Chat_Message 的非空编辑内容，THE Chat_Store SHALL 将该 Chat_Message 的 `content` 更新为去除首尾空白后的文本并通过 Chat_DB 持久化该消息记录。
5. WHEN Edit_Resend_Action 提交非空编辑内容，THE Chat_Store SHALL 通过 Message_Truncation 从 `messages` 中移除该 user Chat_Message 之后的全部 Chat_Message 并通过 Chat_DB 删除其持久化记录。
6. WHEN Edit_Resend_Action 完成消息更新与截断，THE Chat_Page SHALL 进入 Generating_State 并以截断后的 `messages`（含已编辑的 user 消息）作为对话历史经 Stream_Endpoint 生成 assistant 回复。
7. WHEN Edit_Resend_Action 的流式生成正常完成且累积内容非空，THE Chat_Page SHALL 将 Regenerated_Message 作为 assistant Final_Message 追加到 Active_Session 并通过 Session_Persistence 持久化。
8. WHILE Edit_Resend_Action 处于 Generating_State，THE Chat_Page SHALL 提供 Stop_Action。

### Requirement 4: 复制消息内容

**User Story:** 作为女娲用户，我想复制任意一条消息的文本，以便在其他地方使用该内容。

#### Acceptance Criteria

1. WHEN 用户对某条 Chat_Message 触发 Copy_Action，THE Chat_Page SHALL 将该 Chat_Message 的 `content` 写入 Clipboard。
2. WHEN Copy_Action 成功写入 Clipboard，THE Chat_Page SHALL 展示复制成功的提示。
3. IF 写入 Clipboard 失败，THEN THE Chat_Page SHALL 展示复制失败的提示。

### Requirement 5: 删除单条消息

**User Story:** 作为女娲用户，我想删除某条不需要的消息，以便整理对话内容。

#### Acceptance Criteria

1. WHEN 用户对某条 Chat_Message 触发 Delete_Action，THE Chat_Store SHALL 从 `messages` 中移除该 Chat_Message 并通过 Chat_DB 删除其持久化记录。
2. WHEN 某条 Chat_Message 被删除，THE Chat_Page SHALL 在消息列表中不再展示该 Chat_Message。
3. WHEN 某条 Chat_Message 被删除且 Active_Session 仍存在其他 Chat_Message，THE Chat_Store SHALL 保持其余 Chat_Message 的相对顺序不变。
4. WHEN Active_Session 的全部 Chat_Message 被逐条删除，THE Chat_Store SHALL 将该会话的 `messages` 置为空并保留该 Chat_Session。

### Requirement 6: 数据层与持久化一致性

**User Story:** 作为女娲平台维护者，我想让删除、截断与替换消息后内存状态与本地持久化保持一致，以便切换或重启后恢复出正确的对话内容。

#### Acceptance Criteria

1. THE Chat_DB SHALL 提供按消息 `id` 删除单条 Chat_Message 的接口。
2. THE Chat_DB SHALL 提供删除某 Chat_Session 中 Message_Seq 大于给定值的全部 Chat_Message 的截断接口，以支持 Message_Truncation。
3. THE Chat_Store SHALL 提供删除单条消息、编辑并重发、重新生成最后一条回复的动作。
4. WHEN `messages` 经 Delete_Action、Message_Truncation 或 Regenerated_Message 替换而变更，THE Chat_Store SHALL 维持 `messages` 的相对顺序与其 Chat_DB 持久化记录按 Message_Seq 排序后的顺序一致。
5. WHEN 用户在 Delete_Action、Message_Truncation 或重新生成发生后切换离开该 Chat_Session 再切回，THE Chat_Store SHALL 通过 Chat_DB 恢复出与操作后内存 `messages` 等价的有序消息序列。
6. WHEN 因 Regenerate_Action 或 Edit_Resend_Action 产生新的 assistant Final_Message，THE Chat_Store SHALL 更新 Active_Session 的 `updatedAt` 并通过 Chat_DB 持久化该 Chat_Session。
7. WHEN 执行 Delete_Action 或 Message_Truncation，THE Chat_Store SHALL 保持该 Chat_Session 的 `title` 不变。

### Requirement 7: 流式与 TTS 集成

**User Story:** 作为女娲用户，我想让重新生成与编辑重发复用既有的流式回复与自动朗读体验，以便获得与普通发送一致的交互效果。

#### Acceptance Criteria

1. THE Chat_Page SHALL 复用 Stream_Reader 与 Stream_Endpoint 消费 Regenerate_Action 与 Edit_Resend_Action 的流式回复，且不新增或修改后端接口。
2. WHERE Auto_Play_Setting 为开启状态，WHEN Regenerate_Action 或 Edit_Resend_Action 的流式生成正常完成且 Final_Message 含非空内容，THE Chat_Page SHALL 对该 Final_Message 文本触发一次 TTS 朗读。
3. WHILE Regenerate_Action 或 Edit_Resend_Action 的流式生成进行中，THE Chat_Page SHALL 不对 Streaming_Message 的增量内容触发 TTS 朗读。
4. WHERE Auto_Play_Setting 为关闭状态，WHEN Regenerate_Action 或 Edit_Resend_Action 的流式生成完成，THE Chat_Page SHALL 不自动触发 TTS 朗读。
5. IF Regenerate_Action 或 Edit_Resend_Action 在产生任何增量文本之前无法建立到 Stream_Endpoint 的流式连接，THEN THE Chat_Page SHALL 按 Fallback_Strategy 改用 Chat_Endpoint 完成本次回复。
6. WHEN Stream_Reader 接收到携带错误信息的 Stream_Chunk，THE Chat_Page SHALL 展示该错误信息并退出 Generating_State。

### Requirement 8: 错误处理与无回归约束

**User Story:** 作为女娲用户与维护者，我想在新增消息操作后既有功能保持可用且异常有清晰反馈，以便本特性以纯增量方式安全交付。

#### Acceptance Criteria

1. THE Voxcpm_Server SHALL 在本特性变更后保持 Chat_Endpoint（`POST /api/chat`）与 Stream_Endpoint（`POST /api/chat/stream`）的请求与响应契约不变。
2. IF Chat_Store 处于内存降级模式（Chat_DB 不可用），THEN THE Chat_Store SHALL 在内存中完成 Delete_Action、Edit_Resend_Action 与 Regenerate_Action 的状态变更而不进行持久化写入。
3. THE Chat_Page SHALL 在本特性变更后保持发送消息、流式渲染与停止生成功能可正常使用。
4. THE Nuwa_Web SHALL 在本特性变更后保持 Session_Persistence 的会话新建、切换、删除、重命名、自动标题与历史恢复功能可正常使用。
5. THE Chat_Page SHALL 在本特性变更后保持 Voice_Loop 的麦克风语音输入与手动/自动 TTS 朗读功能可正常使用。
6. THE Nuwa_Web SHALL 在本特性变更后保持角色管理、模型管理与模型下载功能可正常使用。
