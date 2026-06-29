# Requirements Document

## Introduction

「对话导出与导入」(conversation-export-import) 特性让女娲 Nuwa 对话页（Chat_Page）的用户能够备份、迁移和分享对话历史。本特性是在已交付的「会话历史持久化」(chat-session-persistence) 之上的纯前端增量增强，复用既有 Chat_DB / Chat_Store（`sessions`、`messages`、IndexedDB）、Character 角色绑定以及 Memory_Fallback_Mode 降级语义，不修改后端及 `POST /api/chat`、`/api/inference/*` 等契约。

本特性覆盖以下相互关联的目标，作为一个整体交付：

1. JSON 导出：将单个会话或全部会话导出为结构化 JSON 文件，包含会话元数据、消息、角色绑定与时间戳，用于备份/迁移，并支持无损往返（导出→导入还原内容与顺序一致）。
2. Markdown 导出：将单个会话或全部会话导出为可读 Markdown 文本，按角色名 + 时间排版消息，用于分享/阅读；对任意消息序列产生确定性输出。
3. JSON 导入：从 JSON 文件导入会话，校验文件格式与版本；导入的会话以新分配的、库内唯一的 `id` 作为新会话写入持久层，不覆盖任何现有会话。
4. 导入错误处理：非法、损坏或版本不兼容的文件给出明确错误提示，且不改动任何现有数据。
5. UI 入口：在 Chat_Page 会话侧边栏提供「导出当前会话」「导出全部」与「导入」（文件选择）入口。
6. 降级与无回归：在 Memory_Fallback_Mode 下导入写入内存会话；既有对话、语音、持久化等能力不回归。

## Glossary

- **Nuwa_Web**: 前端 React 19 + Vite 应用，源码位于 `app/web/src`。
- **Chat_Page**: Nuwa_Web 的「对话」页面，组件 `app/web/src/components/ChatPage.tsx`，含会话侧边栏（Session_Sidebar）。
- **Session_Sidebar**: Chat_Page 中展示会话列表与会话操作入口的侧边栏区域。
- **Chat_Store**: Nuwa_Web 的全局状态存储（Zustand），位于 `app/web/src/store/uiStore.ts`，管理 `sessions`、`currentSessionId`、`messages`、`isPersistent` 等状态。
- **Chat_DB**: 封装 IndexedDB 读写的持久化数据模块（`app/web/src/lib/chatDb.ts`），提供会话与消息的增删改查接口，可被注入 fake-indexeddb 测试。
- **Chat_Session**: 一条会话记录，字段为 `{ id, title, characterId, voiceId, updatedAt }`。
- **Chat_Message**: 一条消息记录，字段为 `{ id, role, content, audioUrl?, voiceName?, duration? }`，按追加顺序归属于某个 Chat_Session。
- **Current_Session_Id**: Chat_Store 中记录的当前活动会话 ID（`currentSessionId`），可为有效会话 ID 或 null。
- **Active_Session**: Current_Session_Id 所指向的 Chat_Session。
- **Export_Module**: 实现导出/导入纯逻辑的模块（建议 `app/web/src/lib/conversationExport.ts`），含 JSON 序列化、Markdown 序列化、JSON 解析与校验函数，不依赖 DOM / Chat_Store / IndexedDB，可被属性测试直接验证。
- **Export_Bundle**: 导出 JSON 文件的顶层结构，字段为 `{ formatVersion, exportedAt, sessions }`，其中 `sessions` 为若干 Exported_Session。
- **Exported_Session**: Export_Bundle 中的单条会话条目，字段为 `{ session, messages }`，`session` 为 Chat_Session 元数据（含 characterId 角色绑定与 voiceId），`messages` 为该会话按顺序排列的 Chat_Message 数组。
- **Format_Version**: Export_Bundle 的格式版本号字符串（本特性固定为 `"1"`），用于导入时的版本兼容性校验。
- **Supported_Version**: 当前 Export_Module 能够导入的 Format_Version 集合（本特性为 `{"1"}`）。
- **JSON_Export**: 将一个或多个 Chat_Session 及其 Chat_Message 序列化为 Export_Bundle JSON 文本的操作。
- **Markdown_Export**: 将一个或多个 Chat_Session 及其 Chat_Message 序列化为可读 Markdown 文本的操作。
- **JSON_Import**: 解析并校验 Export_Bundle JSON 文本、为每条会话分配新 id 后写入持久层的操作。
- **Import_Error**: 导入失败时返回的明确错误结果，区分语法错误、结构错误与版本不兼容三类。
- **File_Download**: 浏览器侧将文本内容触发为文件下载的行为（通过 Blob + 锚点）。
- **Memory_Fallback_Mode**: 当 Chat_DB 初始化或读写失败时，Nuwa_Web 仅在内存中维护会话与消息、不进行持久化的降级运行模式（`isPersistent === false`）。
- **Round_Trip**: 对同一批会话执行 JSON_Export 后再 JSON_Import，还原出的消息内容与顺序、会话元数据（除新分配的 id 外）与原始一致的性质。

## Requirements

### Requirement 1: JSON 导出（单个会话与全部会话）

**User Story:** 作为女娲用户，我想把单个会话或全部会话导出为结构化 JSON 文件，以便备份并在需要时无损还原我的对话历史。

#### Acceptance Criteria

1. WHEN 用户在 Session_Sidebar 触发导出当前会话为 JSON，THE Export_Module SHALL 生成一个仅包含 Active_Session 及其全部 Chat_Message 的 Export_Bundle JSON 文本。
2. WHEN 用户在 Session_Sidebar 触发导出全部会话为 JSON，THE Export_Module SHALL 生成一个按 `sessions` 顺序包含全部 Chat_Session 及各自全部 Chat_Message 的 Export_Bundle JSON 文本。
3. THE Export_Module SHALL 在 Export_Bundle 顶层写入等于当前 Format_Version 的 `formatVersion` 字段、ISO 8601 格式的 `exportedAt` 字段以及 `sessions` 数组。
4. THE Export_Module SHALL 在每个 Exported_Session 中保留对应 Chat_Session 的 `title`、`characterId`、`voiceId`、`updatedAt` 字段以及该会话全部 Chat_Message 的 `role` 与 `content` 字段，且 Chat_Message 顺序与会话内追加顺序一致。
5. WHEN Export_Bundle JSON 文本生成完成，THE Chat_Page SHALL 通过 File_Download 以 `.json` 扩展名的文件名提供该文本供用户下载。

### Requirement 2: Markdown 导出（单个会话与全部会话）

**User Story:** 作为女娲用户，我想把会话导出为可读的 Markdown 文本，以便分享和阅读我的对话。

#### Acceptance Criteria

1. WHEN 用户在 Session_Sidebar 触发导出当前会话为 Markdown，THE Export_Module SHALL 生成一段包含 Active_Session 标题与其全部 Chat_Message 的 Markdown 文本。
2. WHEN 用户在 Session_Sidebar 触发导出全部会话为 Markdown，THE Export_Module SHALL 生成一段按 `sessions` 顺序包含全部 Chat_Session 及各自全部 Chat_Message 的 Markdown 文本。
3. THE Export_Module SHALL 在 Markdown 文本中为每条 Chat_Message 渲染其发送方显示名与 `content`，其中 user 消息的显示名为「我」、assistant 消息的显示名为该会话 `characterId` 对应 Character 的 `name`，当该 Character 不存在时使用「助手」。
4. THE Export_Module SHALL 按 Chat_Message 在会话内的追加顺序排版消息。
5. FOR ALL 相同的会话与消息输入，THE Export_Module SHALL 产生逐字符相同的 Markdown 文本（确定性输出）。
6. WHEN Markdown 文本生成完成，THE Chat_Page SHALL 通过 File_Download 以 `.md` 扩展名的文件名提供该文本供用户下载。

### Requirement 3: JSON 解析与校验

**User Story:** 作为女娲用户，我想让导入功能在读取文件时校验其格式与版本，以便不兼容或损坏的文件能被明确识别。

#### Acceptance Criteria

1. WHEN Export_Module 接收到一段文件文本进行 JSON_Import，THE Export_Module SHALL 先将其解析为 JSON 值。
2. IF 文件文本无法解析为合法 JSON，THEN THE Export_Module SHALL 返回语法类 Import_Error 且不产生任何会话数据。
3. IF 解析得到的 JSON 值不是符合 Export_Bundle 结构（缺少 `formatVersion`、`sessions` 不是数组，或任一 Exported_Session 缺少 `session` 或 `messages`）的对象，THEN THE Export_Module SHALL 返回结构类 Import_Error 且不产生任何会话数据。
4. IF 解析得到的 Export_Bundle 的 `formatVersion` 不属于 Supported_Version，THEN THE Export_Module SHALL 返回版本不兼容类 Import_Error 且不产生任何会话数据。
5. WHEN 一段文件文本通过语法、结构与版本校验，THE Export_Module SHALL 产出一个可写入持久层的、规范化的 Exported_Session 列表。
6. FOR ALL 由 JSON_Export 产生的 Export_Bundle JSON 文本，THE Export_Module SHALL 在 JSON_Import 时成功通过校验并产出对应的 Exported_Session 列表。

### Requirement 4: JSON 导入写入与新 ID 分配

**User Story:** 作为女娲用户，我想把导入的会话作为新会话加入到我的列表中而不覆盖现有会话，以便安全地合并来自备份或他人的对话。

#### Acceptance Criteria

1. WHEN 一段文件文本通过 JSON_Import 校验，THE Chat_Store SHALL 为每个 Exported_Session 创建一条新的 Chat_Session，其 `title`、`characterId`、`voiceId` 取自该 Exported_Session，`updatedAt` 取自该 Exported_Session 或在缺失时取当前时间。
2. WHEN 为某个 Exported_Session 创建新的 Chat_Session，THE Chat_Store SHALL 为该会话分配一个在当前 `sessions` 全集内唯一的新 `id`。
3. WHEN 一批 Exported_Session 在同一次 JSON_Import 中创建多条新的 Chat_Session，THE Chat_Store SHALL 保证这批新会话彼此之间以及与现有 Chat_Session 之间的 `id` 互不相同。
4. WHEN 为某个 Exported_Session 创建新的 Chat_Session，THE Chat_Store SHALL 将该 Exported_Session 的全部 Chat_Message 以原始顺序追加为该新会话的消息，并为每条消息分配在该会话内唯一的 `id`。
5. WHEN 一次 JSON_Import 成功创建新的 Chat_Session，THE Chat_Store SHALL 保留全部现有 Chat_Session 及其 Chat_Message 不被修改或删除。
6. WHILE Chat_Store 处于持久模式（`isPersistent === true`），WHEN 一次 JSON_Import 成功创建新的 Chat_Session，THE Chat_Store SHALL 通过 Chat_DB 持久化每条新建的 Chat_Session 及其 Chat_Message。
7. WHEN 一次 JSON_Import 成功创建若干新的 Chat_Session，THE Chat_Store SHALL 将 Current_Session_Id 设为本次导入会话中 `updatedAt` 最新的一条并加载其消息。

### Requirement 5: 导入往返一致性

**User Story:** 作为女娲用户，我想确保导出再导入后我的对话内容与顺序完全一致，以便信任备份与迁移不会丢失或打乱信息。

#### Acceptance Criteria

1. FOR ALL Chat_Session 集合及其 Chat_Message，THE Export_Module SHALL 保证对其执行 JSON_Export 再 JSON_Import 后产出的 Exported_Session 列表中，每条会话的 Chat_Message 序列在 `role` 与 `content` 上与原始逐条一致且顺序不变（Round_Trip 性质）。
2. FOR ALL Chat_Session 集合，THE Export_Module SHALL 保证 JSON_Export 再 JSON_Import 后产出的每条会话的 `title`、`characterId`、`voiceId` 与原始一致。
3. THE Export_Module SHALL 保证 JSON_Export 再 JSON_Import 后产出的会话条目数量与原始 Chat_Session 数量相同。

### Requirement 6: 导入错误处理（不改动现有数据）

**User Story:** 作为女娲用户，我想在导入失败时得到明确提示并且我的现有数据毫发无损，以便放心尝试导入任意文件。

#### Acceptance Criteria

1. IF 一次 JSON_Import 返回任意类别的 Import_Error，THEN THE Chat_Store SHALL 保持 `sessions`、`messages`、Current_Session_Id 与持久层中的全部数据不变。
2. IF 一次 JSON_Import 返回语法类 Import_Error，THEN THE Chat_Page SHALL 展示文件格式无法解析的错误提示。
3. IF 一次 JSON_Import 返回结构类 Import_Error，THEN THE Chat_Page SHALL 展示文件内容结构不正确的错误提示。
4. IF 一次 JSON_Import 返回版本不兼容类 Import_Error，THEN THE Chat_Page SHALL 展示文件版本不受支持的错误提示。
5. WHEN 一次 JSON_Import 成功导入若干会话，THE Chat_Page SHALL 展示导入成功并包含导入会话数量的提示。

### Requirement 7: Session_Sidebar 导出与导入入口

**User Story:** 作为女娲用户，我想在会话侧边栏直接找到导出与导入的操作，以便无需离开对话页就能管理我的备份。

#### Acceptance Criteria

1. THE Session_Sidebar SHALL 展示「导出当前会话」入口，供用户选择以 JSON 或 Markdown 导出 Active_Session。
2. THE Session_Sidebar SHALL 展示「导出全部」入口，供用户选择以 JSON 或 Markdown 导出全部 Chat_Session。
3. THE Session_Sidebar SHALL 展示「导入」入口，触发文件选择器并限定可选文件类型为 `.json`。
4. WHEN 用户经「导入」入口选择一个文件，THE Chat_Page SHALL 读取该文件文本并将其交由 JSON_Import 处理。
5. WHILE 当前不存在任何 Chat_Session，THE Session_Sidebar SHALL 禁用或隐藏导出相关入口。

### Requirement 8: 降级与无回归约束

**User Story:** 作为女娲用户与维护者，我想在本地存储不可用时仍能导入会话，并确保既有功能不被破坏，以便系统在本特性交付后保持稳定可用。

#### Acceptance Criteria

1. WHILE Chat_Store 处于 Memory_Fallback_Mode（`isPersistent === false`），WHEN 一次 JSON_Import 成功，THE Chat_Store SHALL 将新建的 Chat_Session 与 Chat_Message 仅维护在内存中而不调用 Chat_DB 写入。
2. IF 在持久模式下某次导入相关的 Chat_DB 写入操作失败，THEN THE Chat_Store SHALL 保留内存中的会话与消息状态并展示保存失败的提示信息。
3. THE Export_Module SHALL 不依赖 DOM、Chat_Store 或 IndexedDB，以便其纯逻辑可被 fast-check 属性测试直接验证。
4. THE Nuwa_Web SHALL 在本特性变更后保持对话（`POST /api/chat`）、语音推理（`/api/inference/*`）功能与既有会话持久化能力可正常使用。
5. THE Nuwa_Web SHALL 在本特性变更后不修改后端服务及 `POST /api/chat`、`/api/inference/*` 的请求与响应契约。
6. THE Nuwa_Web SHALL 在本特性变更后保持 `tsc --noEmit` 类型检查通过。
