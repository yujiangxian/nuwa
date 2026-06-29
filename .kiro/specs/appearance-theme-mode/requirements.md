# Requirements Document

## Introduction

本特性「外观主题应用引擎（appearance-theme-mode）」为「女娲 Nuwa」本地 AI 对话应用补齐一项已存在却未生效的能力：设置面板中的"外观"选项（深色 / 浅色 / 跟随系统）当前仅把 `settings.theme` 持久化保存，却从未实际应用到界面，导致选择"浅色"或"跟随系统"时界面始终保持深色。

本特性为纯前端增量增强，不修改后端、不改动后端契约、不新增独立存储。核心目标是把已持久化的 `settings.theme` 真正落地为文档根元素上的主题标识，并据此驱动 CSS 变量在深色 / 浅色之间切换；同时补全完整的浅色主题变量、实现"跟随系统"的实时跟随、保证启动即按持久化主题应用以避免错误主题闪烁，并抽出可独立测试的纯解析函数。深色主题视觉与既有设置项（backendUrl、modelsDir、autoPlay、language）行为均保持不变。

## Glossary

- **Theme_Engine（主题引擎）**：本特性新增的前端逻辑单元，负责把 `Theme_Setting` 解析为 `Resolved_Theme`，并将其写入 `Document_Root` 的主题标识、监听系统偏好变化、响应设置变更。
- **Theme_Setting（主题设置）**：持久化的用户外观选择，取值为 `'dark'`、`'light'` 或 `'system'`，来源于 `Settings_Store` 中的 `theme` 字段，默认值为 `'dark'`。
- **Resolved_Theme（已解析主题）**：经解析后实际应用到界面的具体主题，取值仅为 `'dark'` 或 `'light'`。
- **resolveTheme（解析函数）**：核心纯函数，签名为 `resolveTheme(themeSetting: 'dark'|'light'|'system', systemPrefersDark: boolean) -> 'dark' | 'light'`，无副作用，不读取全局状态。
- **System_Preference（系统偏好）**：操作系统的明暗外观偏好，通过浏览器媒体查询 `prefers-color-scheme: dark` 读取，`true` 表示系统偏好深色。
- **Document_Root（文档根元素）**：`document.documentElement`，即 `<html>` 元素。
- **Theme_Attribute（主题标识属性）**：写在 `Document_Root` 上、用于驱动 CSS 变量切换的属性，取名为 `data-theme`，其值等于当前 `Resolved_Theme`（`'dark'` 或 `'light'`）。
- **Settings_Store（设置存储）**：现有的应用设置状态与其持久化机制（Zustand `useUIStore` 的 `settings` 字段，持久化于 localStorage 键 `nuwa_settings`）。
- **Settings_Persisted_Keys（既有设置项）**：`backendUrl`、`modelsDir`、`autoPlay`、`language` 这四个不属于本特性范围的既有设置字段。
- **Dark_Theme_Variables（深色变量集）**：`globals.css` 中现有的一套深色 "Ocean Theme" CSS 变量（如 `--bg`、`--surface`、`--border`、`--text-primary`、`--text-secondary`、`--text-muted`、`--primary`、`--danger` 等）。
- **Light_Theme_Variables（浅色变量集）**：本特性新增的、与 `Dark_Theme_Variables` 同名的完整浅色取值集合，仅在 `Resolved_Theme` 为 `'light'` 时生效。
- **First_Paint（首帧绘制）**：浏览器对应用界面的首次可见绘制。
- **Theme_Flash（错误主题闪烁）**：在应用最终主题之前，界面以非目标主题（如默认深色）短暂可见后再切换造成的视觉跳变。

## Requirements

### Requirement 1: 主题解析与回退（resolveTheme 纯函数）

**User Story:** 作为开发者，我想要一个确定性的纯函数把主题设置解析为具体主题，以便核心解析逻辑可被独立测试且行为可预测。

#### Acceptance Criteria

1. WHEN `resolveTheme` 接收 `themeSetting` 为 `'dark'`，THE Theme_Engine SHALL 返回 `'dark'`（与 `systemPrefersDark` 取值无关）。
2. WHEN `resolveTheme` 接收 `themeSetting` 为 `'light'`，THE Theme_Engine SHALL 返回 `'light'`（与 `systemPrefersDark` 取值无关）。
3. WHEN `resolveTheme` 接收 `themeSetting` 为 `'system'` 且 `systemPrefersDark` 为 `true`，THE Theme_Engine SHALL 返回 `'dark'`。
4. WHEN `resolveTheme` 接收 `themeSetting` 为 `'system'` 且 `systemPrefersDark` 为 `false`，THE Theme_Engine SHALL 返回 `'light'`。
5. IF `resolveTheme` 接收的 `themeSetting` 不属于 `'dark'`、`'light'`、`'system'` 三者之一，THEN THE Theme_Engine SHALL 返回 `'dark'` 作为回退值。
6. THE Theme_Engine SHALL 实现 `resolveTheme` 为无副作用纯函数：对相同输入恒返回相同输出，且不修改 `Document_Root`、`Settings_Store` 或任何外部状态。

### Requirement 2: 启动即应用且无错误主题闪烁

**User Story:** 作为用户，我希望应用启动时立即按我上次保存的外观选择呈现，以便不会先看到错误主题再跳变。

#### Acceptance Criteria

1. WHEN 应用启动，THE Theme_Engine SHALL 从 `Settings_Store` 读取已持久化的 `Theme_Setting` 并经 `resolveTheme` 解析为 `Resolved_Theme`。
2. WHEN 应用启动完成主题解析，THE Theme_Engine SHALL 将 `Document_Root` 的 `Theme_Attribute` 设置为该 `Resolved_Theme`。
3. THE Theme_Engine SHALL 在 `First_Paint` 之前完成 `Theme_Attribute` 的写入，使界面首次可见时即为 `Resolved_Theme`，不产生 `Theme_Flash`。
4. IF 启动时 `Settings_Store` 中不存在已持久化的 `Theme_Setting`，THEN THE Theme_Engine SHALL 使用默认值 `'dark'` 进行解析与应用。
5. IF 启动时读取持久化设置发生异常，THEN THE Theme_Engine SHALL 使用默认值 `'dark'` 进行解析与应用。

### Requirement 3: 设置变更即时生效

**User Story:** 作为用户，我希望在设置面板切换外观选项后界面立刻改变，以便我能即时看到选择的效果。

#### Acceptance Criteria

1. WHEN 用户将 `Theme_Setting` 更新为 `'dark'`，THE Theme_Engine SHALL 把 `Document_Root` 的 `Theme_Attribute` 设置为 `'dark'`。
2. WHEN 用户将 `Theme_Setting` 更新为 `'light'`，THE Theme_Engine SHALL 把 `Document_Root` 的 `Theme_Attribute` 设置为 `'light'`。
3. WHEN 用户将 `Theme_Setting` 更新为 `'system'`，THE Theme_Engine SHALL 依据当前 `System_Preference` 经 `resolveTheme` 解析后设置 `Theme_Attribute`。
4. WHEN `Theme_Setting` 发生变更，THE Theme_Engine SHALL 在不刷新页面的情况下完成 `Theme_Attribute` 的更新。

### Requirement 4: system 模式跟随系统偏好实时切换

**User Story:** 作为选择"跟随系统"的用户，我希望操作系统在明暗之间切换时应用同步切换，以便外观始终与系统一致。

#### Acceptance Criteria

1. WHILE `Theme_Setting` 为 `'system'`，THE Theme_Engine SHALL 监听 `System_Preference`（`prefers-color-scheme`）的变化。
2. WHILE `Theme_Setting` 为 `'system'` 且监听期间 `System_Preference` 变为偏好深色，THE Theme_Engine SHALL 将 `Theme_Attribute` 更新为 `'dark'`。
3. WHILE `Theme_Setting` 为 `'system'` 且监听期间 `System_Preference` 变为偏好浅色，THE Theme_Engine SHALL 将 `Theme_Attribute` 更新为 `'light'`。
4. WHILE `Theme_Setting` 为 `'dark'` 或 `'light'`，THE Theme_Engine SHALL 忽略 `System_Preference` 的变化，保持 `Theme_Attribute` 等于该锁定主题。
5. WHEN `Theme_Setting` 从 `'system'` 变更为 `'dark'` 或 `'light'`，THE Theme_Engine SHALL 停止对 `System_Preference` 变化作出响应。

### Requirement 5: 浅色主题变量覆盖完整性

**User Story:** 作为用户，我希望浅色模式视觉协调一致，以便在浅色下也能清晰、舒适地使用界面。

#### Acceptance Criteria

1. WHEN `Theme_Attribute` 为 `'light'`，THE Theme_Engine SHALL 应用 `Light_Theme_Variables`，覆盖背景类（`--bg`、`--bg-elevated`）、表面类（`--surface`、`--surface-hover`、`--surface-active`）、边框类（`--border`、`--border-active`）、文字类（`--text-primary`、`--text-secondary`、`--text-muted`）、主色类（`--primary`、`--primary-dim`）以及 `--danger`。
2. WHERE `Resolved_Theme` 为 `'light'`，THE Light_Theme_Variables SHALL 为 `Dark_Theme_Variables` 中每一个面向颜色的变量提供对应的浅色取值，不遗留沿用深色背景或深色文字主色的变量。
3. WHEN `Theme_Attribute` 为 `'light'`，THE Light_Theme_Variables SHALL 使 `--text-primary` 在 `--bg` 背景上的对比度满足正文文本不低于 4.5:1 的可读性标准。
4. WHEN `Theme_Attribute` 为 `'dark'`，THE Theme_Engine SHALL 应用 `Dark_Theme_Variables`，且其取值与本特性引入前的现有取值保持一致。

### Requirement 6: 持久化往返

**User Story:** 作为用户，我希望我的外观选择被持久保存并在下次打开应用时恢复，以便无需每次重新设置。

#### Acceptance Criteria

1. WHEN 用户更新 `Theme_Setting`，THE Settings_Store SHALL 通过现有持久化机制保存该值（不新建独立存储）。
2. WHEN 应用重新启动，THE Theme_Engine SHALL 读取到上次保存的 `Theme_Setting` 并据此应用对应的 `Resolved_Theme`。
3. FOR ALL 取值属于 `'dark'`、`'light'`、`'system'` 的 `Theme_Setting`，保存后再读取 SHALL 得到与保存时相等的值（往返一致性）。

### Requirement 7: 不回归既有设置项与既有深色视觉

**User Story:** 作为用户，我希望新增的主题应用能力不影响现有的其他设置和原有深色界面，以便升级后一切照旧可用。

#### Acceptance Criteria

1. WHEN 应用读取或保存设置，THE Settings_Store SHALL 保留 `Settings_Persisted_Keys`（`backendUrl`、`modelsDir`、`autoPlay`、`language`）的现有取值与默认值行为不变。
2. WHEN 用户更新 `Theme_Setting`，THE Theme_Engine SHALL 不修改任何 `Settings_Persisted_Keys` 的值。
3. WHEN `Theme_Setting` 为默认值 `'dark'`，THE Theme_Engine SHALL 呈现与本特性引入前一致的深色视觉。
4. THE Theme_Engine SHALL 不改动后端代码与后端契约。
