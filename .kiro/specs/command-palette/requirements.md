# Requirements Document

## Introduction

本特性为 Nuwa Web 应用引入一套**全局命令面板（Command Palette）与键盘快捷键系统**。用户按下 `Ctrl/Cmd+K` 唤起一个覆盖层面板，输入文字即可模糊搜索并执行命令：在页面间导航（Home、Chat、Voice Studio、Transcribe、Models、Characters、Presets）、打开设置、切换主题（浅色/深色/跟随系统）、切换界面语言、新建对话会话等。面板支持纯键盘操作（方向键移动高亮、Enter 执行、Escape 关闭）。系统同时对外暴露若干直接键盘快捷键（如 `Ctrl/Cmd+K` 开面板、`Escape` 关闭模态层）。

命令以**带类型的注册表（typed registry）**提供。命令过滤逻辑须为**纯函数**且可独立测试。按键组合（Key Combo）的解析与格式化须为**纯函数**且可往返（round-trip）。本特性需干净地集成进现有架构，并在合理处替换零散的导航 hack（如 `window.__nuwa_switchPage`）。

本特性遵循既有约定：纯领域逻辑放在 `src/lib/*.ts` 并配套 `*.test.ts` 单元测试与 fast-check 属性测试；UI 状态切片放在 `src/store/uiStore.ts`；组件放在 `src/components/*.tsx` 并配套 React Testing Library 测试。导航复用 `uiStore` 的 `currentPage`/`setPage`，设置弹窗复用 `isSettingsOpen`/`setSettingsOpen`，主题/语言复用 `settings.theme`/`settings.language`（经 `updateSetting`），新建会话复用 `createSession`。

## Glossary

- **Command_Palette**: 由 `Ctrl/Cmd+K` 唤起的全局覆盖层组件，包含搜索输入框与可滚动的命令结果列表。
- **Palette_Open_State**: 布尔状态，表示 Command_Palette 当前是否可见；由 Palette_Store 维护。
- **Palette_Query**: 用户在 Command_Palette 搜索框中输入的原始查询字符串。
- **Command_Item**: 一条可执行命令的带类型记录，含稳定 `id`、显示 `title`、可选 `subtitle`、用于匹配的关键字集合 `keywords`、分组 `group`、可选关联 Key_Combo，以及无参执行函数 `run`。
- **Command_Registry**: 在构建期由应用上下文（store actions 等）组装的 Command_Item 有序集合。
- **Command_Group**: Command_Item 的分类标签（如 `navigation`、`settings`、`appearance`、`session`），用于在面板中分组展示。
- **Command_Filter**: 纯函数，依据 Palette_Query 对一组 Command_Item 做模糊匹配并按相关度排序，返回保序的子集。
- **Highlight_Index**: 当前高亮命令在 Filtered_Commands 中的下标；空列表时取约定空值 -1。
- **Filtered_Commands**: Command_Filter 对当前 Palette_Query 计算出的结果列表。
- **Key_Combo**: 一个规范化的按键组合数据结构，含修饰键标志（`ctrl`/`meta`/`shift`/`alt`）与单个主键 `key`（规范化后的小写键名）。
- **Key_Combo_Parser**: 纯函数，将 Key_Combo 字符串（如 `"mod+k"`、`"ctrl+shift+p"`）解析为 Key_Combo 数据结构，非法输入返回 null。
- **Key_Combo_Formatter**: 纯函数，将 Key_Combo 数据结构格式化为规范字符串。
- **Mod_Key**: 跨平台修饰键别名 `mod`，在 macOS 解析/匹配为 `meta`（Cmd），在其他平台解析/匹配为 `ctrl`。
- **Keybinding_Engine**: 监听全局 `keydown` 事件、将事件归一化为 Key_Combo 并与已注册快捷键匹配以触发动作的运行期模块（React hook）。
- **Keybinding**: Key_Combo 与一个动作的绑定关系。
- **Palette_Store**: `uiStore` 中新增的 UI 状态切片，维护 Palette_Open_State、Palette_Query 与 Highlight_Index。
- **App_Page**: 既有页面标识联合类型（`home`/`chat`/`voice`/`transcribe`/`models`/`characters`/`presets`）。
- **Theme_Setting**: 既有主题设置取值（`dark`/`light`/`system`）。
- **Locale_Setting**: 既有界面语言设置取值（来自 i18n 的受支持语言）。
- **Editable_Target**: 触发 `keydown` 时的焦点元素属于可编辑控件（`input`/`textarea`/`select`/`contenteditable`）的情形。

## Requirements

### Requirement 1: 唤起与关闭命令面板

**User Story:** 作为用户，我希望用键盘快捷键随时唤起或关闭命令面板，以便快速发起操作而不必离开键盘。

#### Acceptance Criteria

1. WHEN 用户按下 Mod_Key 与 `k` 的组合（macOS 为 `Cmd+K`、其他平台为 `Ctrl+K`），THE Keybinding_Engine SHALL 将 Palette_Open_State 置为 true。
2. WHILE Palette_Open_State 为 true，WHEN 用户按下 `Escape`，THE Command_Palette SHALL 将 Palette_Open_State 置为 false。
3. WHEN Palette_Open_State 由 false 变为 true，THE Command_Palette SHALL 将 Palette_Query 重置为空字符串，并将 Highlight_Index 设为 Filtered_Commands 的首个元素（若列表非空则为 0，否则为 -1）。
4. WHILE Palette_Open_State 为 true，WHEN 用户按下 Mod_Key 与 `k` 的组合，THE Keybinding_Engine SHALL 将 Palette_Open_State 置为 false。
5. WHILE Palette_Open_State 为 true，WHEN 用户在 Command_Palette 覆盖层的命令列表与搜索框区域之外点击，THE Command_Palette SHALL 将 Palette_Open_State 置为 false。
6. WHEN Mod_Key 与 `k` 的组合被触发，THE Keybinding_Engine SHALL 阻止该事件的浏览器默认行为。

### Requirement 2: 命令注册表

**User Story:** 作为开发者，我希望命令以带类型的注册表集中声明，以便新增命令时类型安全且易于维护。

#### Acceptance Criteria

1. THE Command_Registry SHALL 将每个 Command_Item 表示为含稳定 `id`、`title`、`keywords`（字符串数组）、`group` 与无参函数 `run` 的记录。
2. THE Command_Registry SHALL 为每个受支持的 App_Page（`home`、`chat`、`voice`、`transcribe`、`models`、`characters`、`presets`）提供一个导航 Command_Item。
3. THE Command_Registry SHALL 提供一个打开设置弹窗的 Command_Item。
4. THE Command_Registry SHALL 为每个 Theme_Setting 取值（`dark`、`light`、`system`）提供一个切换主题的 Command_Item。
5. THE Command_Registry SHALL 为每个受支持的 Locale_Setting 取值提供一个切换界面语言的 Command_Item。
6. THE Command_Registry SHALL 提供一个新建对话会话的 Command_Item。
7. THE Command_Registry SHALL 保证全部 Command_Item 的 `id` 在注册表内唯一。
8. WHERE 某个 Command_Item 关联了一个 Key_Combo，THE Command_Registry SHALL 在该 Command_Item 上记录其规范化 Key_Combo 字符串。

### Requirement 3: 命令模糊过滤（纯函数）

**User Story:** 作为用户，我希望输入片段即可模糊匹配命令，以便用最少的击键找到目标命令。

#### Acceptance Criteria

1. WHEN Palette_Query 为空字符串，THE Command_Filter SHALL 返回输入 Command_Item 列表的保序全量副本。
2. WHEN Palette_Query 非空，THE Command_Filter SHALL 仅保留其 `title` 或任一 `keywords` 元素（均忽略大小写）能按子序列匹配 Palette_Query 的 Command_Item。
3. THE Command_Filter SHALL 对相同 Filtered_Commands 中的 Command_Item 保持其在输入列表中的相对顺序，作为相关度相等时的稳定回退排序。
4. THE Command_Filter SHALL 是无副作用纯函数：不读取或修改 Palette_Store、DOM 或任何外部状态，对相同输入恒返回相同输出。
5. WHEN 对 Command_Filter 的结果再次以同一 Palette_Query 调用 Command_Filter，THE Command_Filter SHALL 返回与首次调用相等的列表（过滤幂等）。
6. THE Command_Filter SHALL 保证 Filtered_Commands 是输入列表的子集（每个输出元素均来自输入，不新增、不复制元素）。

### Requirement 4: 面板内键盘导航

**User Story:** 作为用户，我希望仅用键盘在命令列表中移动并执行，以便保持高效的键盘工作流。

#### Acceptance Criteria

1. WHILE Palette_Open_State 为 true 且 Filtered_Commands 非空，WHEN 用户按下 `ArrowDown`，THE Command_Palette SHALL 将 Highlight_Index 增加 1 并在到达末尾后回绕到 0。
2. WHILE Palette_Open_State 为 true 且 Filtered_Commands 非空，WHEN 用户按下 `ArrowUp`，THE Command_Palette SHALL 将 Highlight_Index 减少 1 并在低于 0 后回绕到末尾下标。
3. WHEN Palette_Query 变化导致 Filtered_Commands 更新，THE Command_Palette SHALL 将 Highlight_Index 规整到 `[0, 列表长度-1]`，当列表为空时设为 -1。
4. WHILE Palette_Open_State 为 true 且 Highlight_Index 指向某个 Command_Item，WHEN 用户按下 `Enter`，THE Command_Palette SHALL 执行该 Command_Item 的 `run` 函数并随后将 Palette_Open_State 置为 false。
5. IF Filtered_Commands 为空，THEN WHEN 用户按下 `Enter`，THE Command_Palette SHALL 不执行任何命令并保持 Palette_Open_State 为 true。
6. WHILE Palette_Open_State 为 true，THE Command_Palette SHALL 持续将键盘焦点维持在搜索输入框上。

### Requirement 5: 命令执行与副作用

**User Story:** 作为用户，我希望执行命令后立即看到对应效果（页面切换、设置变更等），以便命令面板成为可靠的操作入口。

#### Acceptance Criteria

1. WHEN 用户执行某个导航 Command_Item，THE Command_Palette SHALL 经 `setPage` 将 `currentPage` 设为该命令对应的 App_Page。
2. WHEN 用户执行打开设置的 Command_Item，THE Command_Palette SHALL 经 `setSettingsOpen(true)` 打开设置弹窗。
3. WHEN 用户执行某个切换主题的 Command_Item，THE Command_Palette SHALL 经 `updateSetting('theme', …)` 将 `settings.theme` 设为该命令对应的 Theme_Setting 取值。
4. WHEN 用户执行某个切换语言的 Command_Item，THE Command_Palette SHALL 经 `updateSetting('language', …)` 将 `settings.language` 设为该命令对应的 Locale_Setting 取值。
5. WHEN 用户执行新建会话的 Command_Item，THE Command_Palette SHALL 经 `createSession` 用当前 `currentCharacterId` 新建一个对话会话，并经 `setPage` 切换到 `chat` 页面。
6. WHEN 任一 Command_Item 被执行完成，THE Command_Palette SHALL 将 Palette_Open_State 置为 false。

### Requirement 6: 全局键盘快捷键

**User Story:** 作为用户，我希望常用动作有直接快捷键，以便无需打开面板即可完成高频操作。

#### Acceptance Criteria

1. THE Keybinding_Engine SHALL 在文档级注册一个 `keydown` 监听器以归一化按键事件并与已注册的 Keybinding 匹配。
2. WHEN 某次 `keydown` 事件归一化后的 Key_Combo 与某个已注册 Keybinding 相等，THE Keybinding_Engine SHALL 触发该 Keybinding 的动作并阻止该事件的浏览器默认行为。
3. IF 触发 `keydown` 时焦点位于 Editable_Target 且按下的 Key_Combo 不含 `ctrl`/`meta` 修饰键，THEN THE Keybinding_Engine SHALL 不触发任何 Keybinding 动作。
4. WHILE 任意模态层（设置弹窗或 Command_Palette）处于打开状态，WHEN 用户按下 `Escape`，THE Keybinding_Engine SHALL 关闭最上层的打开模态层。
5. WHEN Command_Palette 卸载或被禁用，THE Keybinding_Engine SHALL 移除其注册的文档级 `keydown` 监听器。

### Requirement 7: 按键组合解析与格式化（纯函数，可往返）

**User Story:** 作为开发者，我希望以稳定的字符串声明快捷键并可靠地解析与回显，以便快捷键定义可被测试且跨平台一致。

#### Acceptance Criteria

1. WHEN 给定一个语法合法的 Key_Combo 字符串（修饰键经 `+` 连接，末尾为单个主键，忽略大小写与多余空白），THE Key_Combo_Parser SHALL 返回含规范化修饰键标志与小写主键的 Key_Combo 数据结构。
2. IF 给定的字符串为空、缺少主键、含未知 token 或含重复主键，THEN THE Key_Combo_Parser SHALL 返回 null。
3. THE Key_Combo_Formatter SHALL 以固定修饰键顺序（`ctrl`/`meta`/`shift`/`alt` 之后接主键）输出规范化 Key_Combo 字符串。
4. FOR ALL 合法 Key_Combo 数据结构，先经 Key_Combo_Formatter 格式化再经 Key_Combo_Parser 解析 SHALL 得到与原结构相等的 Key_Combo（round-trip：parse(format(x)) == x）。
5. FOR ALL 语法合法的 Key_Combo 字符串，先解析再格式化再解析 SHALL 得到与首次解析相等的 Key_Combo（规范形式幂等：parse(format(parse(s))) == parse(s)）。
6. WHEN 解析含 `mod` token 的字符串，THE Key_Combo_Parser SHALL 在 macOS 平台将其规范化为 `meta`、在其他平台规范化为 `ctrl`。
7. THE Key_Combo_Parser 与 Key_Combo_Formatter SHALL 均为无副作用纯函数：不读取或修改 DOM、Palette_Store 或任何外部状态（平台判定经显式参数注入），对相同输入恒返回相同输出。

### Requirement 8: 面板展示

**User Story:** 作为用户，我希望面板清晰展示命令分组、说明与可用快捷键，以便我快速理解可执行的操作。

#### Acceptance Criteria

1. WHILE Palette_Open_State 为 true，THE Command_Palette SHALL 渲染搜索输入框与 Filtered_Commands 列表。
2. THE Command_Palette SHALL 对每个渲染的 Command_Item 显示其 `title`，并在存在 `subtitle` 时一并显示。
3. WHERE 某个渲染的 Command_Item 关联了 Key_Combo，THE Command_Palette SHALL 经 Key_Combo_Formatter 显示该组合的人类可读形式。
4. WHILE Highlight_Index 指向某个 Command_Item，THE Command_Palette SHALL 对该 Command_Item 施加可视高亮样式。
5. IF Filtered_Commands 为空，THEN THE Command_Palette SHALL 显示一条无匹配结果的空状态提示。
6. THE Command_Palette SHALL 按 Command_Group 对 Filtered_Commands 分组展示，并保持各组内命令的相对顺序。
