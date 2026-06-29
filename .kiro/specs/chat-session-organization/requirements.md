# Requirements Document

## Introduction

「会话组织：置顶与按时间分组」(chat-session-organization) 特性为女娲 Nuwa 对话页（Chat_Page）的会话侧边栏引入组织能力。当前侧边栏仅把会话平铺成一个按 `updatedAt` 排序的列表，缺少结构。本特性让用户能把任意会话置顶（Pin），并将会话先按是否置顶分为「置顶」组与普通组，普通组再按相对时间分桶（今天 / 昨天 / 近 7 天 / 近 30 天 / 更早），从而更快地定位与管理历史会话。

本特性是在已交付的「会话历史持久化」(chat-session-persistence) 与「聊天记录全局搜索」(chat-history-search) 之上的**纯前端**增强：复用既有 Chat_DB（IndexedDB 数据层）、Chat_Store（Zustand）以及 `ChatSession` / `ChatMessage` 类型，不修改后端及 `POST /api/chat` 等契约。置顶状态作为 `ChatSession` 上新增的 `pinned: boolean` 字段持久化到 Chat_DB；为兼容旧数据，缺失该字段的历史会话一律视为未置顶。

为可测试性，「分组 + 排序」的核心逻辑（输入会话数组与当前时间，输出有序的分组结构）抽取为纯函数模块（建议 `app/web/src/lib/sessionOrganize.ts`），不依赖 DOM / Chat_Store / IndexedDB，便于以 fast-check 做属性测试；Chat_Store 的置顶状态变更与持久化则可用 fake-indexeddb 验证。

本特性在 Memory_Fallback_Mode（IndexedDB 不可用、`isPersistent=false`）下仍可工作：置顶状态仅保存在内存中。本特性必须保证既有的会话生命周期（新建 / 切换 / 删除 / 重命名）、全局搜索、语音输入（ASR）与 TTS 朗读、流式输出等能力不回归。

本特性覆盖以下相互关联的目标，作为一个整体交付：

1. 置顶字段：在 `ChatSession` 上新增 `pinned: boolean` 字段，新建会话默认未置顶，旧数据缺省视为未置顶。
2. 置顶操作与持久化：用户可置顶 / 取消置顶任意会话，变更持久化到 Chat_DB（降级模式仅存内存）。
3. 分组纯函数：将「分组 + 排序」逻辑抽取为纯函数模块，输入会话数组与当前时间，输出有序分组结构。
4. 时间分桶：普通组会话按相对时间归入「今天 / 昨天 / 近 7 天 / 近 30 天 / 更早」五个时间桶之一。
5. 组内与组间排序：各组内按 `updatedAt` 降序；置顶组始终排在普通组之前；时间桶组按固定时间次序排列。
6. 侧边栏分组展示：Chat_Page 按分组结构渲染会话，提供置顶 / 取消置顶交互，置顶变更后立即反映在分组中。
7. 降级与无回归：降级模式置顶仅存内存；既有会话生命周期、搜索、语音、流式输出等能力不回归。

## Glossary

- **Nuwa_Web**: 前端 React 19 + Vite 应用，源码位于 `app/web/src`。
- **Chat_Page**: Nuwa_Web 的「对话」页面，组件 `app/web/src/components/ChatPage.tsx`，其会话侧边栏展示会话列表。
- **Chat_Store**: Nuwa_Web 的全局状态存储（Zustand），位于 `app/web/src/store/uiStore.ts`，管理 `sessions`、`currentSessionId`、`messages`、`isPersistent` 等状态及 `createSession` / `switchSession` / `deleteSession` / `renameSession` 等 action。
- **Chat_DB**: 封装 IndexedDB 读写的持久化数据模块（`app/web/src/lib/chatDb.ts`），提供 `getAllSessions`、`getMessages(sessionId)`、`saveSession` 等接口。
- **Chat_Session**: 一条会话记录，字段为 `{ id, title, characterId, voiceId, updatedAt, pinned }`，其中 `updatedAt` 为可排序的 ISO 8601 时间戳字符串，`pinned` 为本特性新增的布尔置顶标记。
- **Chat_Message**: 一条消息记录，归属于某个 Chat_Session。
- **Pinned_Flag**: Chat_Session 上的布尔字段 `pinned`，为 true 表示该会话被置顶，false 表示未置顶。
- **Session_Organize**: 封装「分组 + 排序」核心逻辑的纯函数模块（建议 `app/web/src/lib/sessionOrganize.ts`），输入 Chat_Session 数组与 Current_Time，输出有序的 Session_Group 列表；不依赖 DOM、Chat_Store 或 IndexedDB，可独立做属性测试。
- **Current_Time**: 一次分组计算所参照的当前时间，由调用方传入 Session_Organize。
- **Session_Group**: Session_Organize 输出中的一个分组，包含分组类别（Pinned_Group 或某个 Time_Bucket）与该组内已排序的 Chat_Session 列表。
- **Pinned_Group**: 由全部 Pinned_Flag 为 true 的 Chat_Session 构成的 Session_Group，对应侧边栏「置顶」组。
- **Time_Bucket**: 普通（未置顶）会话按相对时间归入的分组类别，取值为 Today_Bucket、Yesterday_Bucket、Last_7_Days_Bucket、Last_30_Days_Bucket 或 Earlier_Bucket 之一。
- **Day_Diff**: 一个 Chat_Session 的相对天数差，定义为 Current_Time 所在日历日的零点与该会话 `updatedAt` 所在日历日的零点之间相差的整日数（基于本地时区，可为 0、正数或负数）。
- **Today_Bucket**: 对应侧边栏「今天」组的 Time_Bucket。
- **Yesterday_Bucket**: 对应侧边栏「昨天」组的 Time_Bucket。
- **Last_7_Days_Bucket**: 对应侧边栏「近 7 天」组的 Time_Bucket。
- **Last_30_Days_Bucket**: 对应侧边栏「近 30 天」组的 Time_Bucket。
- **Earlier_Bucket**: 对应侧边栏「更早」组的 Time_Bucket。
- **Group_Order**: Session_Group 在输出中的固定排列顺序：Pinned_Group、Today_Bucket、Yesterday_Bucket、Last_7_Days_Bucket、Last_30_Days_Bucket、Earlier_Bucket。
- **Active_Session**: `currentSessionId` 所指向的 Chat_Session。
- **Memory_Fallback_Mode**: 当 Chat_DB 初始化或读写失败时，Nuwa_Web 仅在内存中维护会话与消息、不进行持久化的降级运行模式（`isPersistent=false`）。
- **Voice_Loop**: 已交付的语音交互能力，包含 Chat_Page 的麦克风语音输入（ASR）与 assistant 回复 TTS 朗读。

## Requirements

### Requirement 1: 置顶字段与默认值

**User Story:** 作为女娲用户，我想让会话具备置顶标记并兼容我已有的历史会话，以便在不丢失旧数据的前提下使用置顶能力。

#### Acceptance Criteria

1. THE Chat_Session SHALL 包含布尔字段 Pinned_Flag 用于表示该会话是否被置顶。
2. WHEN Chat_Store 创建一条新的 Chat_Session，THE Chat_Store SHALL 将该会话的 Pinned_Flag 初始化为 false。
3. WHEN Chat_Store 从 Chat_DB 读取一条缺少 Pinned_Flag 字段的 Chat_Session，THE Chat_Store SHALL 将该会话的 Pinned_Flag 取值为 false。
4. THE Session_Organize SHALL 将缺少 Pinned_Flag 字段或 Pinned_Flag 取值为 false 的 Chat_Session 视为未置顶。

### Requirement 2: 置顶与取消置顶操作

**User Story:** 作为女娲用户，我想把重要的会话置顶或取消置顶，以便让常用会话固定在侧边栏顶部。

#### Acceptance Criteria

1. WHEN 用户对某个 Chat_Session 触发置顶，THE Chat_Store SHALL 将该 Chat_Session 的 Pinned_Flag 设为 true。
2. WHEN 用户对某个 Chat_Session 触发取消置顶，THE Chat_Store SHALL 将该 Chat_Session 的 Pinned_Flag 设为 false。
3. WHEN 某个 Chat_Session 的 Pinned_Flag 被切换，THE Chat_Store SHALL 保持该 Chat_Session 的 `updatedAt`、`title`、`characterId` 与 `voiceId` 不变。
4. WHEN 用户对某个 Chat_Session 切换 Pinned_Flag，THE Chat_Store SHALL 仅改变该 Chat_Session 的 Pinned_Flag 而不改变其他 Chat_Session 的 Pinned_Flag。

### Requirement 3: 置顶状态持久化与降级

**User Story:** 作为女娲用户，我想让置顶状态在刷新后仍然保留，并在本地存储不可用时也能临时置顶，以便在任何运行模式下管理会话。

#### Acceptance Criteria

1. WHILE Nuwa_Web 处于持久模式（`isPersistent=true`），WHEN 某个 Chat_Session 的 Pinned_Flag 被切换，THE Chat_Store SHALL 通过 Chat_DB 持久化该 Chat_Session 含其 Pinned_Flag。
2. WHILE Nuwa_Web 处于 Memory_Fallback_Mode，WHEN 某个 Chat_Session 的 Pinned_Flag 被切换，THE Chat_Store SHALL 仅在内存中更新该 Chat_Session 的 Pinned_Flag 而不写入 Chat_DB。
3. WHEN Nuwa_Web 在页面刷新或应用重启后于持久模式下加载会话，THE Chat_Store SHALL 依据 Chat_DB 中持久化的 Pinned_Flag 恢复各 Chat_Session 的置顶状态。
4. IF 持久模式下写入 Chat_DB 失败，THEN THE Chat_Store SHALL 保留内存中已更新的 Pinned_Flag 并展示保存失败的提示信息。

### Requirement 4: 分组纯函数与会话归属

**User Story:** 作为女娲平台维护者，我想把「分组 + 排序」逻辑抽取为与界面和存储解耦的纯函数，以便对其做确定性的属性测试。

#### Acceptance Criteria

1. THE Session_Organize SHALL 接收一个 Chat_Session 数组与一个 Current_Time 作为输入，并输出一个有序的 Session_Group 列表。
2. THE Session_Organize SHALL 将每个 Pinned_Flag 为 true 的 Chat_Session 归入 Pinned_Group。
3. THE Session_Organize SHALL 将每个未置顶的 Chat_Session 归入恰好一个 Time_Bucket。
4. THE Session_Organize SHALL 使输入数组中的每个 Chat_Session 在输出的全部 Session_Group 中恰好出现一次。
5. THE Session_Organize SHALL 不修改输入的 Chat_Session 数组及其中任何 Chat_Session 的字段。
6. WHEN 以相同的 Chat_Session 数组与相同的 Current_Time 多次调用 Session_Organize，THE Session_Organize SHALL 返回结构与顺序一致的 Session_Group 列表。

### Requirement 5: 相对时间分桶

**User Story:** 作为女娲用户，我想让未置顶的会话按最近活动时间自动归类，以便按时间远近浏览历史会话。

#### Acceptance Criteria

1. WHERE 一个未置顶 Chat_Session 的 Day_Diff 等于 0，THE Session_Organize SHALL 将该 Chat_Session 归入 Today_Bucket。
2. WHERE 一个未置顶 Chat_Session 的 Day_Diff 等于 1，THE Session_Organize SHALL 将该 Chat_Session 归入 Yesterday_Bucket。
3. WHERE 一个未置顶 Chat_Session 的 Day_Diff 在 2 至 6（含端点）之间，THE Session_Organize SHALL 将该 Chat_Session 归入 Last_7_Days_Bucket。
4. WHERE 一个未置顶 Chat_Session 的 Day_Diff 在 7 至 29（含端点）之间，THE Session_Organize SHALL 将该 Chat_Session 归入 Last_30_Days_Bucket。
5. WHERE 一个未置顶 Chat_Session 的 Day_Diff 大于或等于 30，THE Session_Organize SHALL 将该 Chat_Session 归入 Earlier_Bucket。
6. IF 一个未置顶 Chat_Session 的 `updatedAt` 晚于 Current_Time（Day_Diff 小于 0），THEN THE Session_Organize SHALL 将该 Chat_Session 归入 Today_Bucket。

### Requirement 6: 组内与组间排序

**User Story:** 作为女娲用户，我想让置顶组排在最前、各组内按最近活动排序，以便最相关的会话总是最容易看到。

#### Acceptance Criteria

1. THE Session_Organize SHALL 在每个 Session_Group 内按 `updatedAt` 由新到旧排序其中的 Chat_Session。
2. THE Session_Organize SHALL 将 Pinned_Group 排在全部 Time_Bucket 对应的 Session_Group 之前。
3. THE Session_Organize SHALL 按 Group_Order 规定的固定顺序排列输出中的 Session_Group。
4. THE Session_Organize SHALL 在输出中省略不包含任何 Chat_Session 的 Session_Group。
5. WHEN 同一 Session_Group 内存在 `updatedAt` 相等的多个 Chat_Session，THE Session_Organize SHALL 使这些 Chat_Session 之间保持其在输入数组中的相对次序。

### Requirement 7: 侧边栏分组展示与交互

**User Story:** 作为女娲用户，我想在侧边栏看到按置顶与时间分组的会话并能直接置顶或取消置顶，以便快速组织和切换会话。

#### Acceptance Criteria

1. THE Chat_Page SHALL 依据 Session_Organize 的输出在会话侧边栏按 Session_Group 渲染会话。
2. THE Chat_Page SHALL 为每个非空 Session_Group 展示对应的组标题（置顶 / 今天 / 昨天 / 近 7 天 / 近 30 天 / 更早）。
3. THE Chat_Page SHALL 为每个 Chat_Session 提供置顶 / 取消置顶的操作入口。
4. WHEN 用户通过该操作入口切换某个 Chat_Session 的 Pinned_Flag，THE Chat_Page SHALL 依据更新后的 Session_Organize 输出重新渲染分组。
5. WHILE 某个 Chat_Session 为 Active_Session，THE Chat_Page SHALL 在其所在 Session_Group 中将该会话标记为选中状态。
6. WHEN 用户在侧边栏选择某个非当前的 Chat_Session，THE Chat_Store SHALL 通过既有 `switchSession` 切换到该 Chat_Session。

### Requirement 8: 错误处理与无回归约束

**User Story:** 作为女娲用户与维护者，我想新的组织能力不破坏既有功能，以便系统在本特性交付后保持稳定可用。

#### Acceptance Criteria

1. THE Nuwa_Web SHALL 在本特性变更后保持会话生命周期（新建、切换、删除、重命名）功能可正常使用。
2. THE Nuwa_Web SHALL 在本特性变更后保持聊天记录全局搜索功能可正常使用。
3. THE Nuwa_Web SHALL 在本特性变更后保持 Voice_Loop 的麦克风语音输入与 assistant 回复 TTS 朗读功能可正常使用。
4. THE Nuwa_Web SHALL 在本特性变更后保持对话（`POST /api/chat`）、流式输出、模型管理（`GET /api/models`）、模型下载（`/api/downloads/*`）功能可正常使用。
5. THE Nuwa_Web SHALL 在本特性变更后不修改后端服务及 `POST /api/chat` 的请求与响应契约。
