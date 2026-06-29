# Requirements Document

## Introduction

「提示词预设管理」(prompt-preset-management) 特性为女娲 Nuwa 前端补齐常用提示词/快捷短语（Prompt Preset）的端到端管理与快速复用能力。在当前对话页（Chat_Page）中，用户每次都需手动键入重复的指令或人设引导语；本特性允许用户保存一组带「标题 + 内容」的预设，集中管理（列表、编辑、删除），并在对话输入框旁一键将某条预设的内容插入到输入框，方便快速发送。

本特性是在已交付的「会话历史持久化」(chat-session-persistence)、「流式对话输出」(streaming-chat-output)、「角色/人设管理」(character-persona-management) 之上的纯前端增量增强，复用 character-persona-management 已建立的「纯逻辑层（`lib/`）→ IndexedDB 数据层（`lib/*Db.ts`，可注入 `IDBFactory` 以便测试）→ Zustand store actions → UI 层」分层模式与降级策略，不修改后端服务及任何既有 API 契约。

本特性覆盖以下相互关联的目标，作为一个整体交付：

1. 持久化：预设列表写入 Preset_DB（IndexedDB，库名 `nuwa-prompt-preset`），刷新或重启后恢复。
2. 预设管理界面：列出、新建、编辑、删除预设，并设置 `title` 与 `content`，删除带二次确认。
3. 快速插入：在 Chat_Page 输入框旁提供入口，点击某条预设将其 `content` 插入到输入框，便于快速发送。
4. 入口集成：在 Home_Page 提供进入 Preset_Manager 的入口，并在 Chat_Page 内提供轻量的预设插入与管理入口。
5. 错误处理与无回归：Preset_DB 不可用或读写失败时降级为内存模式并提示，且不破坏会话持久化、流式输出、角色管理等既有功能与契约。

## Glossary

- **Nuwa_Web**: 前端 React 19 + Vite + TypeScript 应用，源码位于 `app/web/src`。
- **Prompt_Preset**: 提示词预设条目，字段为 `{ id, title, content }`，其中 `id` 为集合内唯一标识，`title` 为预设标题，`content` 为待插入对话输入框的提示词正文。
- **Preset_Store**: Nuwa_Web 的全局状态存储（Zustand），位于 `app/web/src/store/uiStore.ts`，管理 `prompt-preset` 列表（`presets`）。
- **Preset_DB**: 封装 IndexedDB 读写的预设持久化数据模块（建议 `app/web/src/lib/promptPresetDb.ts`），提供预设的获取全部、保存单条、删除单条接口，复用 Character_DB 的构造与降级模式，可注入 `IDBFactory`（如 fake-indexeddb）以供测试。库名为 `nuwa-prompt-preset`。
- **Preset_Logic**: 预设相关的纯逻辑层（建议 `app/web/src/lib/promptPreset.ts`），不依赖 DOM/store/IndexedDB，包含字段校验、唯一 `id` 生成、插入文本构造等可被属性测试直接覆盖的纯函数。
- **Preset_Manager**: Nuwa_Web 的「提示词预设管理」界面（新增页面/组件，建议路由 `/presets`、组件 `PromptPresetsPage`），提供预设列表、新建、编辑、删除及字段编辑控件。
- **Chat_Page**: Nuwa_Web 的「对话」页面，路由 `/chat`，组件 `app/web/src/components/ChatPage.tsx`。
- **Home_Page**: Nuwa_Web 的「首页」，组件 `app/web/src/components/HomePage.tsx`，提供各功能入口。
- **Input_Field**: Chat_Page 的对话输入框（`textarea`），其文本由 Preset_Store 的 `inputText` 状态承载，并通过 `setInputText` 更新。
- **Preset_Insert_Entry**: Chat_Page 输入框旁用于触发将某条 Prompt_Preset 的 `content` 插入 Input_Field 的功能性入口。
- **Input_Max_Length**: Input_Field 允许容纳的最大字符数，为 2000 个字符（与现有 `textarea` 的 `maxLength` 一致）。
- **Title_Max_Length**: Prompt_Preset 的 `title` 允许的最大字符数，为 30 个字符。
- **Content_Max_Length**: Prompt_Preset 的 `content` 允许的最大字符数，为 2000 个字符。
- **Inserted_Text**: 由 Preset_Logic 依据 Input_Field 当前文本与所选 Prompt_Preset 的 `content` 计算得到的、用于写回 Input_Field 的新文本。
- **Memory_Fallback_Mode**: 当 Preset_DB 初始化或读写失败时，Nuwa_Web 仅在内存中维护预设、不进行持久化的降级运行模式。

## Requirements

### Requirement 1: 预设持久化与启动恢复

**User Story:** 作为女娲用户，我想让我创建和修改的提示词预设保存在本地，以便刷新页面或重启应用后还能继续使用这些预设。

#### Acceptance Criteria

1. THE Preset_DB SHALL 使用浏览器 IndexedDB（库名 `nuwa-prompt-preset`）存储 Prompt_Preset 记录。
2. WHEN 一条 Prompt_Preset 被创建、编辑或删除，THE Preset_Store SHALL 通过 Preset_DB 将该变更持久化到 IndexedDB。
3. WHEN Nuwa_Web 在页面刷新或应用重启后再次加载，THE Preset_Store SHALL 通过 Preset_DB 读取已持久化的全部 Prompt_Preset 并恢复到 `presets`。
4. WHEN Preset_DB 读取一条先前持久化的 Prompt_Preset，THE Preset_Store SHALL 恢复其 `id`、`title`、`content` 字段，且各字段值与持久化前相等。
5. THE Preset_DB SHALL 提供获取全部 Prompt_Preset、保存单条 Prompt_Preset、删除单条 Prompt_Preset 的接口。

### Requirement 2: 浏览预设列表

**User Story:** 作为女娲用户，我想在预设管理界面浏览全部预设及其标题与内容，以便了解并选择要编辑、删除或使用的预设。

#### Acceptance Criteria

1. THE Preset_Manager SHALL 展示 `presets` 中每一条 Prompt_Preset 的 `title` 与 `content`。
2. WHILE `presets` 不包含任何 Prompt_Preset，THE Preset_Manager SHALL 展示无预设的空状态提示。
3. THE Preset_Manager SHALL 按 Preset_Store 中 `presets` 的顺序展示各条 Prompt_Preset。

### Requirement 3: 新建预设

**User Story:** 作为女娲用户，我想新建一条预设并设置其标题与内容，以便在对话中快速复用常用的提示词。

#### Acceptance Criteria

1. THE Preset_Manager SHALL 提供输入 `title` 与 `content` 的功能性控件。
2. WHEN 用户在 Preset_Manager 提交创建一条 `title` 与 `content` 去除首尾空白后均非空的 Prompt_Preset，THE Preset_Store SHALL 创建一条新 Prompt_Preset 并为其分配在 `presets` 内唯一的 `id`。
3. WHEN 一条新 Prompt_Preset 被创建，THE Preset_Store SHALL 记录用户输入去除首尾空白后的 `title` 与 `content`。
4. WHEN 一条新 Prompt_Preset 被创建，THE Preset_Store SHALL 通过 Preset_DB 持久化该 Prompt_Preset。
5. WHEN 一条新 Prompt_Preset 被创建，THE Preset_Manager SHALL 在预设列表中展示该 Prompt_Preset。
6. WHILE 新建表单中 `title` 去除首尾空白后为空，THE Preset_Manager SHALL 展示需要填写标题的提示并禁用提交创建。
7. WHILE 新建表单中 `content` 去除首尾空白后为空，THE Preset_Manager SHALL 展示需要填写内容的提示并禁用提交创建。
8. WHERE 用户输入的 `title` 字符数达到 Title_Max_Length，THE Preset_Manager SHALL 阻止超过 Title_Max_Length 的字符进入 `title`。
9. WHERE 用户输入的 `content` 字符数达到 Content_Max_Length，THE Preset_Manager SHALL 阻止超过 Content_Max_Length 的字符进入 `content`。

### Requirement 4: 编辑预设

**User Story:** 作为女娲用户，我想编辑已有预设的标题与内容，以便调整不再贴切的提示词。

#### Acceptance Criteria

1. WHEN 用户在 Preset_Manager 对某条 Prompt_Preset 提交编辑，THE Preset_Store SHALL 将该 Prompt_Preset 的 `title` 与 `content` 更新为去除首尾空白后的提交值，并保持其 `id` 不变。
2. WHEN 一条 Prompt_Preset 被编辑，THE Preset_Store SHALL 通过 Preset_DB 持久化更新后的 Prompt_Preset。
3. WHILE 编辑表单中 `title` 去除首尾空白后为空，THE Preset_Manager SHALL 展示需要填写标题的提示并禁用提交编辑。
4. WHILE 编辑表单中 `content` 去除首尾空白后为空，THE Preset_Manager SHALL 展示需要填写内容的提示并禁用提交编辑。
5. WHEN 一条 Prompt_Preset 被编辑，THE Preset_Manager SHALL 在预设列表中展示更新后的 `title` 与 `content`。

### Requirement 5: 删除预设与二次确认

**User Story:** 作为女娲用户，我想删除不再需要的预设，并在删除前得到确认，以便避免误删常用提示词。

#### Acceptance Criteria

1. WHEN 用户在 Preset_Manager 触发删除某条 Prompt_Preset，THE Preset_Manager SHALL 展示二次确认提示并等待用户确认或取消。
2. WHEN 用户确认删除某条 Prompt_Preset，THE Preset_Store SHALL 从 `presets` 移除该 Prompt_Preset 并通过 Preset_DB 删除其持久化记录。
3. IF 用户取消删除确认，THEN THE Preset_Store SHALL 保留该 Prompt_Preset 且不调用 Preset_DB 删除。
4. WHEN 一条 Prompt_Preset 被删除，THE Preset_Manager SHALL 从预设列表中移除该 Prompt_Preset。

### Requirement 6: 快速插入到对话输入框

**User Story:** 作为女娲用户，我想在对话页一键把某条预设的内容插入到输入框，以便快速编辑并发送。

#### Acceptance Criteria

1. THE Chat_Page SHALL 在 Input_Field 旁提供 Preset_Insert_Entry，用于展示并选择可插入的 Prompt_Preset。
2. WHEN 用户通过 Preset_Insert_Entry 选择一条 Prompt_Preset，THE Preset_Store SHALL 将 Input_Field 的文本经 Preset_Logic 计算为 Inserted_Text 并写回 `inputText`。
3. WHILE 选择 Prompt_Preset 前 Input_Field 文本为空，THE Inserted_Text SHALL 等于所选 Prompt_Preset 的 `content`。
4. WHILE 选择 Prompt_Preset 前 Input_Field 文本去除首尾空白后非空，THE Inserted_Text SHALL 等于选择前文本、一个换行符与所选 Prompt_Preset 的 `content` 依次拼接的结果。
5. IF 计算得到的 Inserted_Text 字符数超过 Input_Max_Length，THEN THE Chat_Page SHALL 展示因长度超限无法插入的提示且不修改 `inputText`。
6. WHEN 一条 Prompt_Preset 的 `content` 被插入 Input_Field，THE Chat_Page SHALL 使 Input_Field 获得焦点。
7. WHEN 一条 Prompt_Preset 的 `content` 被插入 Input_Field，THE Preset_Store SHALL 保持 `presets` 不变。

### Requirement 7: 管理入口与对话页插入入口

**User Story:** 作为女娲用户，我想从首页进入预设管理，并在对话页直接访问预设，以便顺畅地在管理与使用预设之间切换。

#### Acceptance Criteria

1. THE Home_Page SHALL 提供进入 Preset_Manager 的功能性入口。
2. WHEN 用户触发 Home_Page 上的该入口，THE Nuwa_Web SHALL 导航至 Preset_Manager。
3. THE Chat_Page SHALL 提供进入 Preset_Manager 的功能性入口。
4. WHEN 用户触发 Chat_Page 上的该入口，THE Nuwa_Web SHALL 导航至 Preset_Manager。

### Requirement 8: 错误处理与无回归约束

**User Story:** 作为女娲用户与维护者，我想在本地存储不可用时仍能使用预设功能，并确保既有功能不被破坏，以便系统在本特性交付后保持稳定可用。

#### Acceptance Criteria

1. IF Preset_DB 初始化失败或 IndexedDB 在当前浏览器不可用，THEN THE Preset_Store SHALL 进入 Memory_Fallback_Mode 并在内存中维护 `presets`。
2. WHILE 处于 Memory_Fallback_Mode，THE Nuwa_Web SHALL 展示预设无法保存的提示信息。
3. IF 某次 Preset_DB 读取操作失败，THEN THE Preset_Store SHALL 以空的 `presets` 在内存中继续运行。
4. IF 某次 Preset_DB 写入操作失败，THEN THE Preset_Store SHALL 保留内存中的 `presets` 状态并展示保存失败的提示信息。
5. THE Chat_Page SHALL 在本特性变更后保持会话持久化（新建、切换、删除、重命名、启动恢复）功能可正常使用。
6. THE Chat_Page SHALL 在本特性变更后保持流式对话输出与 assistant 回复 TTS 朗读功能可正常使用。
7. THE Nuwa_Web SHALL 在本特性变更后保持角色/人设管理功能可正常使用。
8. THE Nuwa_Web SHALL 在本特性变更后不修改后端服务及既有 API 的请求与响应契约。
