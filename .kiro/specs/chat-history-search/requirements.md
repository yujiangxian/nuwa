# Requirements Document

## Introduction

「聊天记录全局搜索」(chat-history-search) 特性让女娲 Nuwa 用户能够在对话页（Chat_Page）中跨**全部**已持久化的会话与消息进行关键词检索，而不局限于当前活动会话。用户在会话侧边栏输入查询词后，系统在所有 Chat_Session 的标题与所有 Chat_Message 的内容中做大小写不敏感的子串匹配，并以带匹配片段（Match_Snippet）与高亮（Highlight）的结果列表呈现，每条结果标注其所属会话标题与相对时间。点击某条结果将切换到对应会话并定位到匹配的消息。

本特性是在已完成的「会话历史持久化」(chat-session-persistence) 之上的**纯前端**增强：复用既有 Chat_DB（IndexedDB 数据层）、Chat_Store（Zustand）以及 `ChatSession` / `ChatMessage` 类型，不修改后端及 `POST /api/chat` 等契约。为可测试性，检索的核心逻辑（查询规范化、匹配判定、片段提取、高亮区间计算、结果排序）将抽取为纯函数模块（建议 `app/web/src/lib/chatSearch.ts`），便于以 fast-check 做属性测试；数据层检索（跨会话取语料）则可用 fake-indexeddb 验证。

本特性在 Memory_Fallback_Mode（IndexedDB 不可用、`isPersistent=false`）下仍可工作：以内存中可用的会话与消息作为检索语料。本特性必须保证既有对话、会话生命周期（新建 / 切换 / 删除 / 重命名）、语音输入（ASR）与 TTS 朗读等能力不回归。

本特性覆盖以下相互关联的目标，作为一个整体交付：

1. 搜索入口：在会话侧边栏提供搜索输入框（Search_Input）。
2. 查询规范化：去除首尾空白、大小写不敏感匹配、空查询返回空结果。
3. 全局匹配：在所有会话标题与所有消息内容中检索。
4. 语料来源：持久模式经 Chat_DB 跨会话取全量语料；降级模式用内存语料。
5. 片段与高亮（纯函数）：为每条匹配生成截断片段并标注高亮区间。
6. 结果展示：按会话标注、展示标题与相对时间、渲染高亮片段、无结果空状态。
7. 结果导航与定位：点击结果切换会话并滚动定位到匹配消息。
8. 防抖输入：连续输入时在停止后延迟触发检索。
9. 错误处理与无回归：检索只读、读取失败降级、既有功能与后端契约不回归。

## Glossary

- **Nuwa_Web**: 前端 React 19 + Vite 应用，源码位于 `app/web/src`。
- **Chat_Page**: Nuwa_Web 的「对话」页面，组件 `app/web/src/components/ChatPage.tsx`。
- **Chat_Store**: Nuwa_Web 的全局状态存储（Zustand），位于 `app/web/src/store/uiStore.ts`，管理 `sessions`、`currentSessionId`、`messages`、`isPersistent` 等状态及 `switchSession` 等 action。
- **Chat_DB**: 封装 IndexedDB 读写的持久化数据模块（`app/web/src/lib/chatDb.ts`），提供 `getAllSessions`、`getMessages(sessionId)` 等接口。
- **Chat_Session**: 一条会话记录，字段为 `{ id, title, characterId, voiceId, updatedAt }`，其中 `updatedAt` 为可排序的 ISO 8601 时间戳字符串。
- **Chat_Message**: 一条消息记录，字段为 `{ id, role, content, audioUrl?, voiceName?, duration? }`，归属于某个 Chat_Session。
- **Chat_Search**: 封装检索核心逻辑的纯函数模块（建议 `app/web/src/lib/chatSearch.ts`），输入 Search_Corpus 与 Search_Query，输出 Search_Result 集合；不依赖 DOM、Chat_Store 或 IndexedDB，可独立做属性测试。
- **Search_Corpus**: 一次检索所使用的语料，由若干 Chat_Session（含标题）与归属于这些会话的 Chat_Message（含内容）构成。
- **Search_Query**: 用户在 Search_Input 中输入的原始查询文本。
- **Normalized_Query**: Search_Query 去除首尾空白后的查询文本。
- **Search_Result**: 一条检索结果，至少包含所属会话 `id`、所属会话标题、`updatedAt`、匹配类型（Title_Match 或 Message_Match）、匹配消息 `id`（当为 Message_Match 时）、Match_Snippet 与其 Highlight 区间集合。
- **Title_Match**: 因 Chat_Session 标题包含 Normalized_Query 而产生的 Search_Result 类型。
- **Message_Match**: 因 Chat_Message 内容包含 Normalized_Query 而产生的 Search_Result 类型。
- **Match_Snippet**: 从匹配文本中提取、围绕首个匹配位置的一段文本，用于在结果中展示上下文。
- **Highlight_Range**: Match_Snippet 内一处与 Normalized_Query 大小写不敏感相等的子串区间，表示为 `{ start, length }`（基于码点）。
- **Snippet_Max_Length**: Match_Snippet 的最大字符数（取 100 个字符）。
- **Search_Input**: Chat_Page 会话侧边栏中供用户输入 Search_Query 的输入控件。
- **Search_Result_List**: Chat_Page 中展示 Search_Result 集合的列表区域。
- **Debounce_Interval**: 连续输入停止后触发检索计算前的去抖延迟时长（取 200 毫秒）。
- **Memory_Fallback_Mode**: 当 Chat_DB 初始化或读写失败时，Nuwa_Web 仅在内存中维护会话与消息、不进行持久化的降级运行模式（`isPersistent=false`）。
- **Voice_Loop**: 已交付的语音交互能力，包含 Chat_Page 的麦克风语音输入（ASR）与 assistant 回复 TTS 朗读。

## Requirements

### Requirement 1: 搜索入口与查询输入

**User Story:** 作为女娲用户，我想在对话侧边栏有一个搜索框，以便输入关键词检索我的历史聊天记录。

#### Acceptance Criteria

1. THE Chat_Page SHALL 在会话侧边栏区域展示一个 Search_Input 供用户输入 Search_Query。
2. WHEN 用户在 Search_Input 中输入文本，THE Chat_Store SHALL 将 Search_Query 更新为该输入文本。
3. WHERE Normalized_Query 非空，THE Chat_Page SHALL 展示 Search_Result_List 区域。
4. WHEN 用户清空 Search_Input 使 Normalized_Query 为空，THE Chat_Page SHALL 隐藏 Search_Result_List 并恢复展示会话列表。

### Requirement 2: 查询规范化与空查询处理

**User Story:** 作为女娲用户，我想让搜索忽略大小写并自动去除多余空格，以便更容易匹配到相关记录，并在未输入有效内容时不显示干扰结果。

#### Acceptance Criteria

1. THE Chat_Search SHALL 取 Search_Query 去除首尾空白后的文本作为 Normalized_Query。
2. IF Normalized_Query 为空字符串，THEN THE Chat_Search SHALL 返回空的 Search_Result 集合。
3. THE Chat_Search SHALL 以大小写不敏感的方式判定 Normalized_Query 是否为某段文本的子串。
4. WHEN 同一文本以大小写不敏感方式包含 Normalized_Query，THE Chat_Search SHALL 在该文本经统一大小写转换前后给出一致的匹配判定结果。

### Requirement 3: 全局匹配范围

**User Story:** 作为女娲用户，我想让搜索覆盖我所有的会话标题和消息内容，而不只是当前打开的会话，以便找到任意历史会话中的记录。

#### Acceptance Criteria

1. THE Chat_Search SHALL 在 Search_Corpus 中全部 Chat_Session 的标题与全部 Chat_Message 的内容中检索 Normalized_Query。
2. WHEN 某个 Chat_Session 的标题以大小写不敏感方式包含 Normalized_Query，THE Chat_Search SHALL 产生一条 Title_Match 类型的 Search_Result 并归属于该 Chat_Session。
3. WHEN 某条 Chat_Message 的内容以大小写不敏感方式包含 Normalized_Query，THE Chat_Search SHALL 产生一条 Message_Match 类型的 Search_Result 并归属于该 Chat_Message 所属的 Chat_Session。
4. THE Chat_Search SHALL 为每条内容包含 Normalized_Query 的 Chat_Message 至多产生一条 Search_Result。
5. IF 某个 Chat_Session 的标题及其全部 Chat_Message 内容均不包含 Normalized_Query，THEN THE Chat_Search SHALL 不为该 Chat_Session 产生任何 Search_Result。
6. THE Chat_Search SHALL 按所属 Chat_Session 的 `updatedAt` 由新到旧排序 Search_Result，并在同一 Chat_Session 内按 Title_Match 在前、Message_Match 按消息追加顺序在后的次序排序。

### Requirement 4: 检索语料来源

**User Story:** 作为女娲用户，我想无论本地存储是否可用都能搜索到当前可见的历史，以便在任何运行模式下都能使用搜索。

#### Acceptance Criteria

1. WHILE Nuwa_Web 处于持久模式（`isPersistent=true`），WHEN 触发一次检索，THE Chat_Store SHALL 通过 Chat_DB 读取全部 Chat_Session 及其全部 Chat_Message 组装为 Search_Corpus。
2. WHILE Nuwa_Web 处于 Memory_Fallback_Mode，WHEN 触发一次检索，THE Chat_Store SHALL 以内存中可用的 Chat_Session 与 Chat_Message 组装为 Search_Corpus。
3. THE Chat_Store SHALL 将组装好的 Search_Corpus 与 Normalized_Query 传入 Chat_Search 计算 Search_Result。
4. WHEN 检索完成，THE Chat_Store SHALL 将计算所得的 Search_Result 集合写入可供 Chat_Page 读取的搜索状态。

### Requirement 5: 匹配片段提取与高亮

**User Story:** 作为女娲用户，我想在结果中看到关键词周围的上下文并高亮关键词，以便快速判断该结果是否是我要找的内容。

#### Acceptance Criteria

1. WHEN 为一条匹配产生 Search_Result，THE Chat_Search SHALL 生成包含首个匹配位置的 Match_Snippet。
2. THE Chat_Search SHALL 在 Match_Snippet 中为每一处与 Normalized_Query 大小写不敏感相等的子串标注一个 Highlight_Range。
3. WHERE 被匹配文本的字符数超过 Snippet_Max_Length，THE Chat_Search SHALL 将 Match_Snippet 截断至 Snippet_Max_Length 个字符并保留首个匹配子串。
4. THE Chat_Search SHALL 保证每个 Highlight_Range 的 `start` 与 `start + length` 均落在 Match_Snippet 的字符边界范围内，且该区间对应文本与 Normalized_Query 大小写不敏感相等。
5. THE Chat_Search SHALL 按 `start` 升序输出同一 Match_Snippet 内的 Highlight_Range 且各区间互不重叠。

### Requirement 6: 搜索结果展示

**User Story:** 作为女娲用户，我想看到按会话组织、带标题与时间、并高亮关键词的结果列表，以便清晰地浏览所有匹配。

#### Acceptance Criteria

1. THE Chat_Page SHALL 在 Search_Result_List 中为每条 Search_Result 标注其所属 Chat_Session 的标题。
2. THE Chat_Page SHALL 为每条 Search_Result 展示其所属 Chat_Session `updatedAt` 经 `formatRelativeTime` 格式化后的相对时间。
3. THE Chat_Page SHALL 渲染每条 Search_Result 的 Match_Snippet，并对其中每个 Highlight_Range 以视觉突出方式呈现。
4. IF Normalized_Query 非空且 Search_Result 集合为空，THEN THE Chat_Page SHALL 在 Search_Result_List 区域展示无匹配结果的空状态提示。

### Requirement 7: 结果导航与消息定位

**User Story:** 作为女娲用户，我想点击一条搜索结果就跳转到对应会话并定位到那条消息，以便继续查看上下文或对话。

#### Acceptance Criteria

1. WHEN 用户点击一条 Search_Result，THE Chat_Store SHALL 通过既有 `switchSession` 切换到该 Search_Result 所属的 Chat_Session。
2. WHERE 被点击的 Search_Result 为 Message_Match，WHEN 会话切换完成且对应 Chat_Message 存在于消息列表中，THE Chat_Page SHALL 将消息列表滚动定位到该匹配 Chat_Message。
3. IF 被点击的 Search_Result 为 Message_Match 且对应 Chat_Message 无法在消息列表中定位，THEN THE Chat_Page SHALL 完成会话切换并保持消息列表在默认位置。
4. WHEN 用户点击一条 Search_Result，THE Chat_Page SHALL 退出 Search_Result_List 视图并恢复展示会话列表。

### Requirement 8: 防抖输入

**User Story:** 作为女娲用户，我想在快速输入时不会每敲一个字符都触发一次检索，以便获得流畅的输入体验。

#### Acceptance Criteria

1. WHEN 用户连续输入修改 Search_Query，THE Chat_Page SHALL 在最后一次输入后经过 Debounce_Interval 才触发一次检索计算。
2. IF 在 Debounce_Interval 内 Search_Query 再次发生变化，THEN THE Chat_Page SHALL 取消上一次待触发的检索并以最新 Search_Query 重新计时。

### Requirement 9: 错误处理与无回归约束

**User Story:** 作为女娲用户与维护者，我想搜索功能在存储异常时仍可用且不破坏既有能力，以便系统在本特性交付后保持稳定可用。

#### Acceptance Criteria

1. THE Chat_Search SHALL 在检索过程中不修改任何 Chat_Session 或 Chat_Message（检索为只读操作）。
2. IF 检索期间 Chat_DB 读取语料失败，THEN THE Chat_Store SHALL 以内存中可用的 Chat_Session 与 Chat_Message 作为 Search_Corpus 继续返回 Search_Result 且不中断 Chat_Page。
3. THE Nuwa_Web SHALL 在本特性变更后保持会话生命周期（新建、切换、删除、重命名）功能可正常使用。
4. THE Nuwa_Web SHALL 在本特性变更后保持 Voice_Loop 的麦克风语音输入与 assistant 回复 TTS 朗读功能可正常使用。
5. THE Nuwa_Web SHALL 在本特性变更后保持对话（`POST /api/chat`）、模型管理（`GET /api/models`）、模型下载（`/api/downloads/*`）功能可正常使用。
6. THE Nuwa_Web SHALL 在本特性变更后不修改后端服务及 `POST /api/chat` 的请求与响应契约。
