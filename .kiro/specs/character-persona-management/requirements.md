# Requirements Document

## Introduction

「角色/人设管理」(character-persona-management) 特性为女娲 Nuwa 前端补齐角色（Character）的端到端管理能力。当前 `app/web/src/store/uiStore.ts` 中的角色是写死的 3 条 `defaultCharacters`（小助手 / 苏格拉底 / 心理咨询师），既无管理界面，也不持久化，且其绑定的 `voiceId` 可能与真实音色库（`GET /api/voices`）对不上号。对话页（Chat_Page）强依赖当前角色的 `systemPrompt` 与绑定音色完成 LLM 对话与 TTS 朗读。

本特性是在已交付的「会话历史持久化」(chat-session-persistence)、「流式对话输出」(streaming-chat-output)、「语音交互闭环」(voice-interaction-loop)、「音色库管理」(voice-library-management) 之上的纯前端增量增强，复用 chat-session-persistence 已建立的 Chat_DB（IndexedDB）数据层模式与降级策略，可能仅需极小或无后端改动（音色列表沿用既有 `GET /api/voices`）。

本特性覆盖以下相互关联的目标，作为一个整体交付：

1. 持久化：角色列表写入 Character_DB（IndexedDB），刷新或重启后恢复。
2. 种子初始化：持久层为空时以现有 Default_Characters 作为种子落库；非空时直接使用持久层数据且不重复注入。
3. 角色管理界面：列出、新建、编辑、删除角色，并设置 `name`、`systemPrompt`、`description`、`avatar`（渐变），以及从真实音色库选择绑定 `voiceId`。
4. 不变量保护：保证角色列表始终至少存在一条 Character，且 `currentCharacterId` 始终指向有效 Character，避免对话页无可用角色。
5. 集成：在首页提供进入角色管理的入口；对话页从持久化角色列表读取并选用当前角色；编辑当前角色后对话与 TTS 即时生效。
6. 错误处理与无回归：Character_DB 不可用或读写失败时降级为内存模式并提示，且不破坏会话持久化、流式输出、语音闭环、音色库管理等既有契约。

## Glossary

- **Nuwa_Web**: 前端 React 19 + Vite + TypeScript 应用，源码位于 `app/web/src`。
- **Character**: 角色/人设条目，字段为 `{ id, name, avatar, systemPrompt, voiceId, description }`，其中 `avatar` 为 CSS 线性渐变字符串、`voiceId` 为所绑定 Reference_Voice 的 `id`。
- **Character_Store**: Nuwa_Web 的全局状态存储（Zustand），位于 `app/web/src/store/uiStore.ts`，管理 `characters` 与 `currentCharacterId`。
- **Character_DB**: 封装 IndexedDB 读写的角色持久化数据模块（建议 `app/web/src/lib/characterDb.ts`），提供角色的增删改查接口，复用 Chat_DB 的构造与降级模式，可被单元测试（fake-indexeddb 或 mock）。
- **Character_Manager**: Nuwa_Web 的「角色管理」界面（新增页面/组件，建议路由 `/characters`、组件 `CharactersPage`），提供角色列表、新建、编辑、删除及字段编辑控件。
- **Current_Character_Id**: Character_Store 中记录的当前角色 ID（`currentCharacterId`）。
- **Active_Character**: Current_Character_Id 所指向的 Character。
- **Default_Characters**: 现有内置的种子角色集合，含 `id` 为 `assistant`、`socrates`、`counselor` 的三条 Character。
- **Chat_Page**: Nuwa_Web 的「对话」页面，路由 `/chat`，组件 `app/web/src/components/ChatPage.tsx`。
- **Home_Page**: Nuwa_Web 的「首页」，组件 `app/web/src/components/HomePage.tsx`，提供各功能入口。
- **Voice_Library**: 由 `GET /api/voices` 返回的参考音色集合，前端经 `useVoices` 读取。
- **Reference_Voice**: Voice_Library 中的音色条目，含 `id`、`name`、`path`、`transcript` 等字段，用于 TTS 的 `ref_audio` 与 `ref_text`。
- **Avatar_Gradient**: Character 的 `avatar` 字段值，为非空的 CSS 线性渐变字符串。
- **Gradient_Presets**: Character_Manager 提供给用户选择 Avatar_Gradient 的预设渐变集合。
- **Name_Max_Length**: Character 的 `name` 允许的最大字符数，为 20 个字符。
- **Memory_Fallback_Mode**: 当 Character_DB 初始化或读写失败时，Nuwa_Web 仅在内存中维护角色、不进行持久化的降级运行模式。
- **Voice_Ref_Resolution**: 现有将 `voiceId` 解析为 TTS `ref_audio`/`ref_text` 的逻辑（`app/web/src/lib/voice.ts` 的 `resolveVoiceRef`）：命中返回该音色的 `path`/`transcript`，未命中返回空字符串使后端回退默认参考音。

## Requirements

### Requirement 1: 角色持久化与启动恢复

**User Story:** 作为女娲用户，我想让我创建和修改的角色保存在本地，以便刷新页面或重启应用后还能继续使用这些角色。

#### Acceptance Criteria

1. THE Character_DB SHALL 使用浏览器 IndexedDB 存储 Character 记录。
2. WHEN 一条 Character 被创建、编辑或删除，THE Character_Store SHALL 通过 Character_DB 将该变更持久化到 IndexedDB。
3. WHEN Nuwa_Web 在页面刷新或应用重启后再次加载，THE Character_Store SHALL 通过 Character_DB 读取已持久化的全部 Character 并恢复到 `characters`。
4. WHEN Character_DB 读取一条先前持久化的 Character，THE Character_Store SHALL 恢复其 `id`、`name`、`avatar`、`systemPrompt`、`voiceId`、`description` 字段，且各字段值与持久化前相等。
5. THE Character_DB SHALL 提供获取全部 Character、保存单条 Character、删除单条 Character 的接口。

### Requirement 2: 种子初始化

**User Story:** 作为女娲用户，我想在首次使用时直接看到一组可用的内置角色，以便无需手动创建即可开始对话。

#### Acceptance Criteria

1. WHEN Nuwa_Web 完成 Character_DB 加载且持久层不存在任何 Character，THE Character_Store SHALL 以 Default_Characters 初始化 `characters`。
2. WHEN Character_Store 以 Default_Characters 初始化 `characters`，THE Character_Store SHALL 通过 Character_DB 持久化每一条 Default_Character。
3. WHEN Nuwa_Web 完成 Character_DB 加载且持久层已存在至少一条 Character，THE Character_Store SHALL 使用持久层中的 Character 恢复 `characters` 且不再注入 Default_Characters。
4. WHEN Nuwa_Web 在已完成种子初始化后再次启动，THE Character_Store SHALL 保持 `characters` 与上一次运行结束时的角色集合一致，且不重复追加 Default_Characters。

### Requirement 3: 浏览角色列表

**User Story:** 作为女娲用户，我想在角色管理界面浏览全部角色及其关键信息，以便了解并选择要编辑或使用的角色。

#### Acceptance Criteria

1. THE Character_Manager SHALL 展示 `characters` 中每一条 Character 的 `name`、`description` 与 `avatar`。
2. WHERE 某条 Character 的 `voiceId` 在 Voice_Library 中存在对应 Reference_Voice，THE Character_Manager SHALL 展示该 Reference_Voice 的 `name`。
3. WHILE Voice_Library 请求处于等待响应状态，THE Character_Manager SHALL 显示音色加载中的状态。
4. IF Voice_Library 请求发生网络错误或返回非成功响应，THEN THE Character_Manager SHALL 展示音色加载失败的提示并仍展示 `characters` 的其余信息。

### Requirement 4: 新建角色

**User Story:** 作为女娲用户，我想新建一个角色并设置其名称、人设提示词、描述、头像渐变与绑定音色，以便在对话中使用自定义的人设。

#### Acceptance Criteria

1. THE Character_Manager SHALL 提供输入 `name`、`systemPrompt`、`description`，从 Gradient_Presets 选择 Avatar_Gradient，以及从 Voice_Library 选择绑定 `voiceId` 的功能性控件。
2. WHEN 用户在 Character_Manager 提交创建一条 `name` 去除首尾空白后非空的 Character，THE Character_Store SHALL 创建一条新 Character 并为其分配在 `characters` 内唯一的 `id`。
3. WHEN 一条新 Character 被创建，THE Character_Store SHALL 记录用户输入的 `name`、`systemPrompt`、`description`、所选 Avatar_Gradient 与所选 `voiceId`。
4. WHEN 一条新 Character 被创建，THE Character_Store SHALL 通过 Character_DB 持久化该 Character。
5. WHEN 一条新 Character 被创建，THE Character_Manager SHALL 在角色列表中展示该 Character。
6. IF 用户提交创建时 `name` 去除首尾空白后为空，THEN THE Character_Manager SHALL 展示需要填写名称的提示且不创建 Character。
7. WHERE 用户输入的 `name` 字符数超过 Name_Max_Length，THE Character_Manager SHALL 阻止超过 Name_Max_Length 的字符进入 `name`。

### Requirement 5: 编辑角色

**User Story:** 作为女娲用户，我想编辑已有角色（包括内置角色）的各项字段，以便调整人设、描述、头像与绑定音色。

#### Acceptance Criteria

1. WHEN 用户在 Character_Manager 对某条 Character 提交编辑，THE Character_Store SHALL 将该 Character 的 `name`、`systemPrompt`、`description`、`avatar`、`voiceId` 更新为提交值，并保持其 `id` 不变。
2. WHEN 一条 Character 被编辑，THE Character_Store SHALL 通过 Character_DB 持久化更新后的 Character。
3. IF 用户提交编辑时 `name` 去除首尾空白后为空，THEN THE Character_Manager SHALL 展示需要填写名称的提示且不更新该 Character。
4. WHEN 一条 Character 被编辑，THE Character_Manager SHALL 在角色列表中展示更新后的字段。
5. WHEN 被编辑的 Character 是 Active_Character，THE Chat_Page SHALL 在后续对话请求中使用该 Character 更新后的 `systemPrompt`，并在后续 TTS 中按更新后的 `voiceId` 经 Voice_Ref_Resolution 解析参考音。

### Requirement 6: 删除角色与至少保留一个角色

**User Story:** 作为女娲用户，我想删除不再需要的角色，以便保持角色列表整洁，同时系统始终保证至少有一个可用角色且当前角色有效。

#### Acceptance Criteria

1. WHEN 用户在 Character_Manager 触发删除某条 Character，THE Character_Manager SHALL 展示二次确认提示并等待用户确认或取消。
2. WHEN 用户确认删除某条 Character 且删除后 `characters` 仍至少保留一条 Character，THE Character_Store SHALL 从 `characters` 移除该 Character 并通过 Character_DB 删除其持久化记录。
3. IF 用户取消删除确认，THEN THE Character_Store SHALL 保留该 Character 且不调用 Character_DB 删除。
4. IF 用户请求删除的 Character 是 `characters` 中唯一的一条 Character，THEN THE Character_Manager SHALL 拒绝该删除并展示至少需保留一个角色的提示，且不调用 Character_DB 删除。
5. WHEN 被删除的 Character 是 Active_Character，THE Character_Store SHALL 将 Current_Character_Id 重设为删除后 `characters` 中仍存在的某一条 Character 的 `id`。
6. THE Character_Store SHALL 保证 `characters` 在任意时刻至少包含一条 Character。
7. THE Character_Store SHALL 保证 Current_Character_Id 在任意时刻指向 `characters` 中存在的某条 Character 的 `id`。

### Requirement 7: 从真实音色库绑定音色

**User Story:** 作为女娲用户，我想从真实音色库中为角色选择绑定的音色，以便对话朗读使用我管理的参考音色而非对不上号的写死值。

#### Acceptance Criteria

1. THE Character_Manager SHALL 从 Voice_Library（`GET /api/voices`）获取可选的 Reference_Voice 列表供绑定。
2. WHEN 用户在 Character_Manager 为某条 Character 选择一条 Reference_Voice，THE Character_Store SHALL 将该 Character 的 `voiceId` 设为所选 Reference_Voice 的 `id`。
3. WHERE 某条 Character 的 `voiceId` 在 Voice_Library 中无对应 Reference_Voice，THE Chat_Page SHALL 在 TTS 时经 Voice_Ref_Resolution 回退为后端默认参考音，使 `ref_audio` 与 `ref_text` 为空字符串。
4. WHERE 用户在 Character_Manager 创建或编辑 Character 时未选择任何 Reference_Voice，THE Character_Store SHALL 允许该 Character 的 `voiceId` 为空字符串。

### Requirement 8: 角色管理入口与对话页选用角色

**User Story:** 作为女娲用户，我想从首页进入角色管理，并在对话页选用当前角色，以便顺畅地在管理与使用角色之间切换。

#### Acceptance Criteria

1. THE Home_Page SHALL 提供进入 Character_Manager 的功能性入口。
2. WHEN 用户触发该入口，THE Nuwa_Web SHALL 导航至 Character_Manager。
3. THE Chat_Page SHALL 从 Character_Store 的 `characters` 读取并渲染可选角色列表。
4. WHEN 用户在 Chat_Page 选择某条 Character 作为当前角色，THE Character_Store SHALL 将 Current_Character_Id 设为该 Character 的 `id`。

### Requirement 9: 错误处理与无回归约束

**User Story:** 作为女娲用户与维护者，我想在本地存储不可用时仍能使用角色功能，并确保既有功能不被破坏，以便系统在本特性交付后保持稳定可用。

#### Acceptance Criteria

1. IF Character_DB 初始化失败或 IndexedDB 在当前浏览器不可用，THEN THE Character_Store SHALL 进入 Memory_Fallback_Mode 并以 Default_Characters 在内存中维护 `characters`。
2. WHILE 处于 Memory_Fallback_Mode，THE Nuwa_Web SHALL 展示角色无法保存的提示信息。
3. IF 某次 Character_DB 读取操作失败，THEN THE Character_Store SHALL 以 Default_Characters 在内存中继续运行。
4. IF 某次 Character_DB 写入操作失败，THEN THE Character_Store SHALL 保留内存中的 `characters` 状态并展示保存失败的提示信息。
5. THE Chat_Page SHALL 在本特性变更后保持会话持久化（新建、切换、删除、重命名、启动恢复）功能可正常使用。
6. THE Chat_Page SHALL 在本特性变更后保持流式对话输出与 assistant 回复 TTS 朗读功能可正常使用。
7. THE Nuwa_Web SHALL 在本特性变更后保持音色库管理（`GET /api/voices` 及音色上传、删除）功能可正常使用。
8. THE Nuwa_Web SHALL 在本特性变更后不修改后端服务及既有 API 的请求与响应契约。
