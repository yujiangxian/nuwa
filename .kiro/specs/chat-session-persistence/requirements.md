# Requirements Document

## Introduction

「会话历史持久化」(chat-session-persistence) 特性让女娲 Nuwa 对话页（Chat_Page）的会话与消息真正持久化到浏览器本地 IndexedDB，并实现完整的会话生命周期：新建、切换、删除、重命名会话，自动生成会话标题，以及应用启动时恢复历史。

本特性是在已完成的「语音交互闭环」(voice-interaction-loop) 之上的纯前端增强，不修改后端及 `POST /api/chat` 契约。当前对话页存在两处割裂：(1) Chat_Page 使用组件本地 `useState` 维护消息（含硬编码 m1/m2），与 Chat_Store 的 `messages` 未打通；(2) Chat_Store 的 `sessions` 是硬编码 mock（s1/s2），`createSession` 只写内存不持久化。本特性将引入持久化数据层（Chat_DB）统一管理会话与消息，移除上述硬编码 mock 数据，并保证语音输入与 TTS 朗读等既有能力不回归。

本特性覆盖以下相互关联的目标，作为一个整体交付：

1. 持久化：会话列表与每个会话的消息写入 Chat_DB（IndexedDB），刷新或重启后恢复。
2. 会话生命周期：新建（绑定当前角色与音色，空消息）、切换（加载对应消息）、删除（二次确认，连带删除其消息）、重命名标题。
3. 自动标题：新会话首条用户消息后用其内容截断生成标题；未发消息的新会话显示默认标题。
4. 消息持久化：用户消息与 assistant 回复写入当前会话并持久化。
5. 启动恢复与空状态：启动时加载会话；无会话时进入空状态或自动新建会话；`currentSessionId` 始终指向有效会话。
6. Chat_Page 改造：用 Chat_Store 持久化会话替换组件本地消息与 mock 会话，移除硬编码数据。
7. 错误处理与无回归：Chat_DB 不可用或读写失败时降级为内存模式并提示，且对话、语音、模型、下载等既有功能不回归。

## Glossary

- **Nuwa_Web**: 前端 React 19 + Vite 应用，源码位于 `app/web/src`。
- **Chat_Page**: Nuwa_Web 的「对话」页面，路由 `/chat`，组件 `app/web/src/components/ChatPage.tsx`。
- **Chat_Store**: Nuwa_Web 的全局状态存储（Zustand），位于 `app/web/src/store/uiStore.ts`，管理 `sessions`、`currentSessionId`、`messages` 等状态。
- **Chat_DB**: 封装 IndexedDB 读写的持久化数据模块（建议 `app/web/src/lib/chatDb.ts`），提供会话与消息的增删改查接口，可被单元测试（fake-indexeddb 或 mock）。
- **Chat_Session**: 一条会话记录，字段为 `{ id, title, characterId, voiceId, updatedAt }`。
- **Chat_Message**: 一条消息记录，字段为 `{ id, role, content, audioUrl?, voiceName?, duration? }`，并归属于某个 Chat_Session。
- **Current_Session_Id**: Chat_Store 中记录的当前活动会话 ID（`currentSessionId`），可为有效会话 ID 或 null。
- **Active_Session**: `Current_Session_Id` 所指向的 Chat_Session。
- **Character**: Chat_Store 中的角色定义，含 `id`、`name`、`systemPrompt`、`voiceId`，由 `currentCharacterId` 标识当前角色。
- **Default_Title**: 新建且尚无用户消息的 Chat_Session 所显示的默认标题文本「新对话」。
- **Title_Max_Length**: 自动生成会话标题的最大字符数（取 20 个字符）。
- **Memory_Fallback_Mode**: 当 Chat_DB 初始化或读写失败时，Nuwa_Web 仅在内存中维护会话与消息、不进行持久化的降级运行模式。
- **Voice_Loop**: 已交付的「语音交互闭环」能力，包含 Chat_Page 的麦克风语音输入（ASR）与 assistant 回复 TTS 朗读。

## Requirements

### Requirement 1: 会话与消息持久化

**User Story:** 作为女娲用户，我想让我的对话会话和消息保存在本地，以便刷新页面或重启应用后还能看到历史记录。

#### Acceptance Criteria

1. THE Chat_DB SHALL 使用浏览器 IndexedDB 分别存储 Chat_Session 记录与 Chat_Message 记录。
2. WHEN 一条 Chat_Session 被创建、重命名或其 `updatedAt` 发生变化，THE Chat_Store SHALL 通过 Chat_DB 将该 Chat_Session 持久化到 IndexedDB。
3. WHEN 一条 Chat_Message 被追加到某个 Chat_Session，THE Chat_Store SHALL 通过 Chat_DB 将该 Chat_Message 持久化到 IndexedDB 并关联其所属 Chat_Session 的 `id`。
4. WHEN Nuwa_Web 在页面刷新或应用重启后再次加载，THE Chat_Store SHALL 通过 Chat_DB 读取已持久化的全部 Chat_Session 记录并恢复到 `sessions`。
5. WHEN 用户切换到某个 Chat_Session，THE Chat_Store SHALL 通过 Chat_DB 读取该 Chat_Session 所属的全部 Chat_Message 并按追加顺序恢复到 `messages`。
6. THE Chat_DB SHALL 提供获取全部 Chat_Session、按会话 ID 获取 Chat_Message、保存 Chat_Session、保存 Chat_Message、删除 Chat_Session 及其消息的接口。

### Requirement 2: 新建会话

**User Story:** 作为女娲用户，我想新建一个空白会话，以便针对新话题与当前角色开始独立的对话。

#### Acceptance Criteria

1. WHEN 用户在 Chat_Page 触发新建会话，THE Chat_Store SHALL 创建一条新的 Chat_Session，其 `characterId` 取自当前 `currentCharacterId`、`voiceId` 取自该 Character 绑定的音色、`title` 为 Default_Title、消息为空。
2. WHEN 一条新的 Chat_Session 被创建，THE Chat_Store SHALL 将 Current_Session_Id 设为该新会话的 `id` 并将 `messages` 清空。
3. WHEN 一条新的 Chat_Session 被创建，THE Chat_Store SHALL 通过 Chat_DB 持久化该 Chat_Session。
4. WHEN 一条新的 Chat_Session 被创建，THE Chat_Page SHALL 在会话列表中展示该会话且将其标记为当前选中会话。

### Requirement 3: 切换会话

**User Story:** 作为女娲用户，我想在会话列表中切换到另一个会话，以便查看并继续该会话的历史对话。

#### Acceptance Criteria

1. WHEN 用户在 Chat_Page 选择一个非当前的 Chat_Session，THE Chat_Store SHALL 将 Current_Session_Id 设为所选 Chat_Session 的 `id`。
2. WHEN 用户切换到某个 Chat_Session，THE Chat_Store SHALL 通过 Chat_DB 加载该会话的 Chat_Message 并替换 `messages` 的内容。
3. WHILE 某个 Chat_Session 为 Active_Session，THE Chat_Page SHALL 在会话列表中将该会话标记为选中状态。
4. WHEN 用户选择已是 Active_Session 的会话，THE Chat_Store SHALL 保持 `messages` 不变。

### Requirement 4: 删除会话

**User Story:** 作为女娲用户，我想删除不再需要的会话，以便保持会话列表整洁，同时避免误删。

#### Acceptance Criteria

1. WHEN 用户在 Chat_Page 触发删除某个 Chat_Session，THE Chat_Page SHALL 展示二次确认提示并等待用户确认或取消。
2. WHEN 用户确认删除某个 Chat_Session，THE Chat_Store SHALL 通过 Chat_DB 删除该 Chat_Session 及其全部 Chat_Message。
3. IF 用户取消删除确认，THEN THE Chat_Store SHALL 保留该 Chat_Session 及其 Chat_Message 不做任何变更。
4. WHEN 被删除的 Chat_Session 是 Active_Session 且删除后仍存在其他 Chat_Session，THE Chat_Store SHALL 将 Current_Session_Id 切换到剩余 Chat_Session 中 `updatedAt` 最新的一条并加载其消息。
5. WHEN 被删除的 Chat_Session 是 Active_Session 且删除后已无任何 Chat_Session，THE Chat_Store SHALL 进入空状态处理（见 Requirement 7）。
6. WHEN 被删除的 Chat_Session 不是 Active_Session，THE Chat_Store SHALL 保持 Current_Session_Id 与 `messages` 不变。

### Requirement 5: 重命名会话标题

**User Story:** 作为女娲用户，我想手动修改会话的标题，以便用更易识别的名称管理我的会话。

#### Acceptance Criteria

1. WHEN 用户在 Chat_Page 对某个 Chat_Session 提交新的标题文本，THE Chat_Store SHALL 将该 Chat_Session 的 `title` 更新为去除首尾空白后的文本。
2. WHEN 某个 Chat_Session 的 `title` 被更新，THE Chat_Store SHALL 通过 Chat_DB 持久化该 Chat_Session。
3. IF 用户提交的标题文本去除首尾空白后为空，THEN THE Chat_Store SHALL 保持该 Chat_Session 的原 `title` 不变。
4. WHEN 某个 Chat_Session 的 `title` 被更新，THE Chat_Page SHALL 在会话列表中展示更新后的标题。

### Requirement 6: 自动生成会话标题

**User Story:** 作为女娲用户，我想让新会话在我发出第一条消息后自动获得一个有意义的标题，以便无需手动命名就能区分会话。

#### Acceptance Criteria

1. WHILE 某个 Chat_Session 的 `title` 仍为 Default_Title 且该会话尚无用户消息，WHEN 用户在该会话发出第一条 Chat_Message，THE Chat_Store SHALL 用该用户消息的 `content` 生成并设置该 Chat_Session 的 `title`。
2. WHERE 用户首条消息内容的字符数超过 Title_Max_Length，THE Chat_Store SHALL 取该内容前 Title_Max_Length 个字符作为标题。
3. WHEN 某个 Chat_Session 的 `title` 被自动生成，THE Chat_Store SHALL 通过 Chat_DB 持久化该 Chat_Session。
4. WHILE 某个 Chat_Session 已存在自定义或已自动生成的标题，WHEN 用户在该会话继续发送消息，THE Chat_Store SHALL 保持该 Chat_Session 的 `title` 不变。
5. WHILE 某个 Chat_Session 尚无任何用户消息，THE Chat_Page SHALL 在会话列表中将该会话显示为 Default_Title。

### Requirement 7: 启动恢复与空状态

**User Story:** 作为女娲用户，我想在打开应用时直接看到历史会话或一个可用的新会话，以便立即开始对话而不会落到无效状态。

#### Acceptance Criteria

1. WHEN Nuwa_Web 完成 Chat_DB 加载且存在已持久化的 Chat_Session，THE Chat_Store SHALL 将 Current_Session_Id 设为 `updatedAt` 最新的 Chat_Session 并加载其 Chat_Message。
2. WHEN Nuwa_Web 完成 Chat_DB 加载且不存在任何已持久化的 Chat_Session，THE Chat_Store SHALL 自动创建一条以当前 Character 为基础的新 Chat_Session 并将其设为 Active_Session。
3. THE Chat_Store SHALL 保证 Current_Session_Id 为 null 或指向 `sessions` 中存在的某个 Chat_Session 的 `id`。
4. WHILE Chat_DB 加载尚未完成，THE Chat_Page SHALL 显示会话加载中的状态而不展示硬编码的占位会话或占位消息。

### Requirement 8: Chat_Page 改造与移除 Mock 数据

**User Story:** 作为女娲平台维护者，我想让对话页统一从持久化会话存读取数据，移除硬编码 mock，以便消除组件本地状态与全局状态的割裂。

#### Acceptance Criteria

1. THE Chat_Page SHALL 从 Chat_Store 的 `messages` 读取并渲染当前会话消息，不再使用组件本地的消息 `useState`。
2. THE Chat_Page SHALL 从 Chat_Store 的 `sessions` 读取并渲染会话列表。
3. THE Chat_Store SHALL 移除硬编码的 mock 会话数据（`defaultSessions` 中的 `s1`、`s2`）与硬编码的初始消息（`m1`、`m2`）。
4. WHEN 用户在 Chat_Page 发送一条文本消息，THE Chat_Page SHALL 通过 Chat_Store 将该用户 Chat_Message 追加到 Active_Session 并持久化。
5. WHEN `POST /api/chat` 返回一条 assistant 回复，THE Chat_Page SHALL 通过 Chat_Store 将该 assistant Chat_Message 追加到 Active_Session 并持久化。
6. WHEN 用户发送一条文本消息或收到一条 assistant 回复，THE Chat_Store SHALL 更新 Active_Session 的 `updatedAt` 并通过 Chat_DB 持久化该 Chat_Session。

### Requirement 9: 错误处理与无回归约束

**User Story:** 作为女娲用户与维护者，我想在本地存储不可用时仍能继续对话，并确保既有功能不被破坏，以便系统在本特性交付后保持稳定可用。

#### Acceptance Criteria

1. IF Chat_DB 初始化失败或 IndexedDB 在当前浏览器不可用，THEN THE Chat_Store SHALL 进入 Memory_Fallback_Mode 并在内存中维护会话与消息。
2. WHILE 处于 Memory_Fallback_Mode，THE Chat_Page SHALL 展示本地历史无法保存的提示信息。
3. IF 某次 Chat_DB 读取操作失败，THEN THE Chat_Store SHALL 以空会话集合继续运行并触发空状态处理（见 Requirement 7）。
4. IF 某次 Chat_DB 写入操作失败，THEN THE Chat_Store SHALL 保留内存中的会话与消息状态并展示保存失败的提示信息。
5. THE Chat_Page SHALL 在本特性变更后保持 Voice_Loop 的麦克风语音输入功能可正常使用。
6. THE Chat_Page SHALL 在本特性变更后保持 Voice_Loop 的 assistant 回复 TTS 朗读功能可正常使用。
7. THE Nuwa_Web SHALL 在本特性变更后保持对话（`POST /api/chat`）、模型管理（`GET /api/models`）、模型下载（`/api/downloads/*`）功能可正常使用。
8. THE Nuwa_Web SHALL 在本特性变更后不修改后端服务及 `POST /api/chat` 的请求与响应契约。
