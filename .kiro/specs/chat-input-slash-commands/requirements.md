# Requirements Document

## Introduction

「对话输入框斜杠命令」(chat-input-slash-commands) 特性在女娲 Nuwa 对话页（Chat_Page）的底部消息输入框（Input_Field）中提供一个斜杠命令快捷输入菜单（Slash_Command_Menu）。当用户在 Input_Field 中以斜杠 `/` 开头输入时，弹出一个命令面板，列出两类命令：

1. 内置快捷命令（Builtin_Command），例如 `/clear`（清空当前输入）、`/retry`（重新生成最后一条 assistant 回复）、`/presets`（打开提示词预设页）；
2. 用户已保存的提示词预设命令（Preset_Command），来源于既有 Prompt_Preset 集合（promptPresetDb / Chat_Store 的 `presets`），每条预设可作为一条斜杠命令被调用。

用户在斜杠后继续输入时，菜单按查询串（Slash_Query）做前缀/模糊过滤；可用 ArrowUp/ArrowDown 移动高亮项，用 Enter 或鼠标点击选中。选中 Preset_Command 时，将该预设的 `content` 文本插入 Input_Field 并替换掉斜杠查询；选中 Builtin_Command 时执行其对应动作。按 Escape 关闭菜单。当没有激活斜杠命令时，菜单不得干扰正常输入与发送。

本特性为纯前端、纯增量增强：不改动任何后端接口或行为，不破坏既有对话发送、流式输出、持久化、语音、预设管理等功能。其核心解析/过滤/匹配/选择逻辑以无副作用纯函数形式集中在新模块 `app/web/src/lib/slashCommand.ts`，便于使用 fast-check 做属性测试（≥100 runs）。

本特性覆盖以下相互关联的目标，作为一个整体交付：

1. 斜杠激活与查询解析：精确判定输入是否处于斜杠命令模式，并解析出 Slash_Query。
2. 命令目录构建：合并 Builtin_Command 与 Preset_Command 形成统一的 Command_Item 列表。
3. 查询过滤与匹配：按 Slash_Query 对 Command_Item 列表做保序、幂等的子集过滤。
4. 键盘与鼠标交互：高亮项导航、选中、关闭，且高亮下标在过滤后始终处于合法范围。
5. 选中执行：Preset_Command 插入预设文本替换斜杠查询；Builtin_Command 执行对应动作。
6. 纯函数核心与可测性：核心逻辑为纯函数，满足斜杠检测精确性、过滤子集保序、查询解析往返、幂等、下标有界等属性。
7. 无干扰与无回归约束：未激活斜杠模式时不影响正常输入/发送；既有功能不回归。

## Glossary

- **Nuwa_Web**: 前端 React 19 + TypeScript + Vite 应用，源码位于 `app/web/src`。
- **Chat_Page**: Nuwa_Web 的「对话」页面，组件 `app/web/src/components/ChatPage.tsx`。
- **Chat_Store**: Nuwa_Web 的全局状态存储（Zustand），位于 `app/web/src/store/uiStore.ts`，管理 `inputText`、`setInputText`、`presets`、`messages` 以及消息动作等。
- **Input_Field**: Chat_Page 底部的消息输入框（textarea，`ref={inputRef}`），其文本绑定到 Chat_Store 的 `inputText`，最大长度由 `INPUT_MAX_LENGTH`（2000 码点）约束。
- **Prompt_Preset**: 既有提示词预设条目，字段为 `{ id: string, title: string, content: string }`，由 prompt-preset-management 特性经 promptPresetDb 持久化，存于 Chat_Store 的 `presets`。
- **Slash_Command_Engine**: 本特性新增的纯函数逻辑模块 `app/web/src/lib/slashCommand.ts`，提供斜杠检测、查询解析、目录构建、过滤匹配、选中下标规整与文本替换等无副作用函数。
- **Slash_Command_Menu**: Chat_Page 中在 Input_Field 上方弹出的命令面板 UI，展示过滤后的 Command_Item 列表并支持高亮、选中、关闭。
- **Slash_Active_State**: Input_Field 当前文本满足 Slash_Trigger_Condition 时所处的「斜杠命令激活」状态，期间显示 Slash_Command_Menu。
- **Slash_Trigger_Condition**: 判定是否进入 Slash_Active_State 的条件：Input_Field 文本去除首部后第一个字符为 `/`，且斜杠后（含为空）不包含换行符；本特性以「文本首字符为 `/`」作为激活判据。
- **Slash_Query**: 处于 Slash_Active_State 时，Input_Field 文本中位于首个 `/` 之后、到文本末尾（或首个换行符之前）的子串，作为命令过滤的查询关键字。
- **Command_Item**: Slash_Command_Menu 中的一个可选条目，统一表示一条命令，含 `kind`（`'builtin' | 'preset'`）、`commandKey`（用于匹配的命令关键字，如 `clear`、`retry` 或预设标题派生关键字）、`title`（展示标题）、`description`（展示说明）、以及 `presetId`（仅 Preset_Command 含）。
- **Builtin_Command**: 内置快捷命令类 Command_Item，初始集合为 `/clear`（Clear_Action）、`/retry`（Retry_Action）、`/presets`（Open_Presets_Action）。
- **Preset_Command**: 由单个 Prompt_Preset 派生的 Command_Item（`kind === 'preset'`，`presetId` 指向来源预设），选中后插入该预设的 `content`。
- **Command_Catalog**: 由全部 Builtin_Command 与全部 Preset_Command 按确定顺序合并得到的 Command_Item 列表（Builtin_Command 在前，Preset_Command 按 `presets` 原有顺序在后）。
- **Filtered_Commands**: 以 Slash_Query 对 Command_Catalog 过滤后得到的 Command_Item 列表，保持 Command_Catalog 中的相对顺序。
- **Highlight_Index**: Slash_Command_Menu 当前高亮项在 Filtered_Commands 中的下标。
- **Clear_Action**: 内置命令 `/clear` 的动作：将 Input_Field 文本清空（`inputText` 置为空串）。
- **Retry_Action**: 内置命令 `/retry` 的动作：触发对 Last_Assistant_Message 的重新生成，复用既有 Chat_Store 重新生成动作。
- **Open_Presets_Action**: 内置命令 `/presets` 的动作：将 Nuwa_Web 当前页切换到提示词预设页（`presets`）。
- **Last_Assistant_Message**: 当前 `messages` 中最后一条且 `role` 为 `assistant` 的消息。
- **Inserted_Preset_Text**: 选中某 Preset_Command 后写回 Input_Field 的文本：以该预设 `content` 替换掉从首个 `/` 起到 Slash_Query 末尾的整段斜杠查询。
- **Voxcpm_Server**: 后端 Rust + Axum 服务（crate `voxcpm-server`），监听 8080；本特性不改动其任何接口。

## Requirements

### Requirement 1: 斜杠激活与查询解析

**User Story:** 作为女娲用户，我想在输入框开头键入斜杠时看到命令菜单，以便快速调用命令而无需记忆完整文本。

#### Acceptance Criteria

1. WHEN Input_Field 文本的首个字符为 `/` 且该文本不包含换行符，THE Slash_Command_Engine SHALL 判定该文本处于 Slash_Active_State。
2. IF Input_Field 文本为空，THEN THE Slash_Command_Engine SHALL 判定该文本不处于 Slash_Active_State。
3. IF Input_Field 文本的首个字符不是 `/`，THEN THE Slash_Command_Engine SHALL 判定该文本不处于 Slash_Active_State。
4. IF Input_Field 文本包含换行符，THEN THE Slash_Command_Engine SHALL 判定该文本不处于 Slash_Active_State。
5. WHEN Input_Field 文本处于 Slash_Active_State，THE Slash_Command_Engine SHALL 将首个 `/` 之后到文本末尾的子串解析为 Slash_Query。
6. WHEN Input_Field 文本为单个 `/` 字符，THE Slash_Command_Engine SHALL 将 Slash_Query 解析为空串。
7. WHEN Slash_Query 与处于 Slash_Active_State 的判定结果确定后，THE Slash_Command_Engine SHALL 满足由空串 Slash_Query 重建文本得到 `"/"`、由非空 Slash_Query `q` 重建文本得到 `"/" + q` 的往返一致性。

### Requirement 2: 命令目录构建

**User Story:** 作为女娲用户，我想在命令菜单里同时看到内置命令和我保存的提示词预设，以便统一从一个入口调用。

#### Acceptance Criteria

1. THE Slash_Command_Engine SHALL 提供固定的 Builtin_Command 集合，至少包含 `commandKey` 为 `clear`、`retry`、`presets` 的三条 Command_Item。
2. WHEN 给定 Prompt_Preset 列表，THE Slash_Command_Engine SHALL 为每条 Prompt_Preset 生成一条 `kind` 为 `preset`、`presetId` 等于来源预设 `id` 的 Preset_Command。
3. WHEN 构建 Command_Catalog，THE Slash_Command_Engine SHALL 将全部 Builtin_Command 置于全部 Preset_Command 之前。
4. WHEN 构建 Command_Catalog，THE Slash_Command_Engine SHALL 保持 Preset_Command 之间的相对顺序与输入 Prompt_Preset 列表的顺序一致。
5. WHEN 给定包含 N 条 Prompt_Preset 的列表，THE Slash_Command_Engine SHALL 使 Command_Catalog 的条目数等于 Builtin_Command 数量与 N 之和。
6. WHERE 某 Preset_Command 来源预设的 `title` 去除首尾空白后为空，THE Slash_Command_Engine SHALL 仍以该预设 `id` 派生出可匹配的 `commandKey`，使该 Preset_Command 出现在 Command_Catalog 中。

### Requirement 3: 查询过滤与匹配

**User Story:** 作为女娲用户，我想在斜杠后继续输入时菜单自动收窄到相关命令，以便更快定位目标命令。

#### Acceptance Criteria

1. WHEN Slash_Query 为空串，THE Slash_Command_Engine SHALL 使 Filtered_Commands 等于完整的 Command_Catalog。
2. WHEN Slash_Query 非空，THE Slash_Command_Engine SHALL 仅保留 `commandKey` 或 `title` 在忽略大小写后包含 Slash_Query 全部字符（按子序列前缀/包含匹配规则）的 Command_Item。
3. THE Slash_Command_Engine SHALL 使 Filtered_Commands 是 Command_Catalog 的子集且保持 Command_Catalog 中的相对顺序。
4. WHEN 对同一 Command_Catalog 与同一 Slash_Query 重复执行过滤，THE Slash_Command_Engine SHALL 返回与单次过滤相等的 Filtered_Commands（过滤幂等）。
5. THE Slash_Command_Engine SHALL 使 Filtered_Commands 的条目数不超过 Command_Catalog 的条目数。
6. WHEN Slash_Query 不匹配任何 Command_Item，THE Slash_Command_Engine SHALL 使 Filtered_Commands 为空列表。
7. WHEN 过滤匹配执行，THE Slash_Command_Engine SHALL 以忽略大小写的方式比较 Slash_Query 与 Command_Item 的匹配字段。

### Requirement 4: 菜单显示与键盘鼠标交互

**User Story:** 作为女娲用户，我想用键盘上下键和回车在命令菜单里导航并选中，以便不离开键盘就完成操作。

#### Acceptance Criteria

1. WHILE Input_Field 处于 Slash_Active_State 且 Filtered_Commands 非空，THE Slash_Command_Menu SHALL 展示 Filtered_Commands 并高亮其中一项。
2. WHILE Input_Field 处于 Slash_Active_State 且 Filtered_Commands 为空，THE Chat_Page SHALL 不展示 Slash_Command_Menu。
3. WHEN Filtered_Commands 发生变化，THE Slash_Command_Engine SHALL 将 Highlight_Index 规整到区间 `[0, Filtered_Commands.length - 1]` 内，且当 Filtered_Commands 非空时 Highlight_Index 为有效下标。
4. WHILE Slash_Command_Menu 可见，WHEN 用户按 ArrowDown，THE Slash_Command_Menu SHALL 将 Highlight_Index 移动到下一项，并在越过末项时回绕到首项。
5. WHILE Slash_Command_Menu 可见，WHEN 用户按 ArrowUp，THE Slash_Command_Menu SHALL 将 Highlight_Index 移动到上一项，并在越过首项时回绕到末项。
6. WHILE Slash_Command_Menu 可见，WHEN 用户按 Enter，THE Chat_Page SHALL 选中 Highlight_Index 所指的 Command_Item 而不发送消息。
7. WHILE Slash_Command_Menu 可见，WHEN 用户点击某条 Command_Item，THE Chat_Page SHALL 选中被点击的 Command_Item。
8. WHILE Slash_Command_Menu 可见，WHEN 用户按 Escape，THE Chat_Page SHALL 关闭 Slash_Command_Menu 并保留 Input_Field 当前文本。

### Requirement 5: 命令选中与执行

**User Story:** 作为女娲用户，我想选中预设命令时把预设内容填入输入框、选中内置命令时直接执行动作，以便一步完成想做的事。

#### Acceptance Criteria

1. WHEN 用户选中某 Preset_Command，THE Chat_Store SHALL 将 Input_Field 文本设置为 Inserted_Preset_Text，即用该预设 `content` 替换从首个 `/` 起到 Slash_Query 末尾的整段斜杠查询。
2. WHEN 用户选中某 Preset_Command 后写入 Inserted_Preset_Text，THE Chat_Page SHALL 关闭 Slash_Command_Menu。
3. IF 选中 Preset_Command 后得到的 Inserted_Preset_Text 码点数超过 `INPUT_MAX_LENGTH`，THEN THE Chat_Store SHALL 保持 Input_Field 文本不变并提示长度超限。
4. WHEN 用户选中 `commandKey` 为 `clear` 的 Builtin_Command，THE Chat_Store SHALL 将 Input_Field 文本清空并关闭 Slash_Command_Menu。
5. WHEN 用户选中 `commandKey` 为 `retry` 的 Builtin_Command 且存在 Last_Assistant_Message，THE Chat_Store SHALL 触发对 Last_Assistant_Message 的重新生成并关闭 Slash_Command_Menu。
6. IF 用户选中 `commandKey` 为 `retry` 的 Builtin_Command 但不存在 Last_Assistant_Message，THEN THE Chat_Page SHALL 关闭 Slash_Command_Menu 且不触发重新生成。
7. WHEN 用户选中 `commandKey` 为 `presets` 的 Builtin_Command，THE Nuwa_Web SHALL 将当前页切换到提示词预设页并关闭 Slash_Command_Menu。
8. WHEN 任一 Command_Item 被选中执行完毕，THE Slash_Command_Engine SHALL 不保留任何跨次调用的可变内部状态。

### Requirement 6: 纯函数核心与可测性

**User Story:** 作为女娲平台维护者，我想把斜杠命令的解析与过滤逻辑做成可被属性测试覆盖的纯函数，以便保证其正确性与可回归。

#### Acceptance Criteria

1. THE Slash_Command_Engine SHALL 以无 DOM、无 Chat_Store、无 IndexedDB 依赖的纯函数形式实现斜杠检测、Slash_Query 解析、Command_Catalog 构建、过滤匹配、Highlight_Index 规整与 Inserted_Preset_Text 构造。
2. FOR ALL 字符串输入，THE Slash_Command_Engine SHALL 使「是否处于 Slash_Active_State」的判定结果当且仅当该文本首字符为 `/` 且不含换行符时为真（斜杠检测精确性）。
3. FOR ALL 处于 Slash_Active_State 的文本，THE Slash_Command_Engine SHALL 满足「解析出 Slash_Query 后再重建文本」与原文本相等的往返一致性。
4. FOR ALL Command_Catalog 与 Slash_Query，THE Slash_Command_Engine SHALL 使 Filtered_Commands 为 Command_Catalog 的保序子集（每个结果项均来自 Command_Catalog 且相对顺序不变）。
5. FOR ALL Command_Catalog 与 Slash_Query，THE Slash_Command_Engine SHALL 满足过滤幂等性（对结果再次以同一 Slash_Query 过滤得到相等结果）。
6. FOR ALL Filtered_Commands 与任意整数 Highlight_Index 候选值，THE Slash_Command_Engine SHALL 使规整后的 Highlight_Index 在 Filtered_Commands 非空时落在 `[0, length - 1]` 内、在 Filtered_Commands 为空时取约定空值（如 `-1`）。

### Requirement 7: 无干扰与无回归约束

**User Story:** 作为女娲用户与维护者，我想在新增斜杠命令后既有输入、发送与其他功能保持不变，以便本特性以纯增量方式安全交付。

#### Acceptance Criteria

1. WHILE Input_Field 不处于 Slash_Active_State，THE Chat_Page SHALL 保持既有的输入、换行（Shift+Enter）与按 Enter 发送消息行为不变。
2. IF Input_Field 不处于 Slash_Active_State，THEN THE Chat_Page SHALL 不展示 Slash_Command_Menu。
3. WHILE Slash_Command_Menu 不可见，WHEN 用户按 Enter 且 Input_Field 文本去除首尾空白后非空，THE Chat_Page SHALL 按既有逻辑发送消息。
4. THE Voxcpm_Server SHALL 在本特性变更后保持全部既有 HTTP 接口的请求与响应契约不变。
5. THE Nuwa_Web SHALL 在本特性变更后保持对话发送、流式输出、停止生成、会话持久化与恢复功能可正常使用。
6. THE Nuwa_Web SHALL 在本特性变更后保持提示词预设管理、语音输入/朗读、角色管理与模型管理功能可正常使用。
7. THE Chat_Store SHALL 在本特性变更后保持 `inputText`、`setInputText`、`presets` 与既有消息动作的对外契约不变。
