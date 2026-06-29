# Requirements Document

## Introduction

界面多语言（UI Internationalization, i18n）为女娲 Nuwa Web 应用提供一个轻量、零第三方依赖的前端界面字符串国际化层。当前 `SettingsModal` 已存在界面语言选择器（简体中文 / English / 日本語）并绑定到 Zustand `uiStore` 的 `settings.language`，但选择语言不会真正改变任何界面文案——全部文案目前是硬编码的中文字面量。

本特性引入：三种受支持语言（zh-CN 简体中文为默认、en 英语、ja 日语）的翻译资源目录；一个根据当前语言返回字符串、缺失时回退的翻译查找函数与 React Hook；由既有持久化设置 `settings.language` 驱动的语言状态（将显示标签归一为语言代码）；将首页功能卡片、设置弹窗标签、通用按钮等既有界面文案由硬编码字面量替换为查找调用；以及随当前语言更新 `<html lang>` 属性。所有核心逻辑（语言解析归一、带回退的键查找）为无副作用纯函数，便于属性测试（vitest + fast-check）。

本特性范围严格限定于前端界面字符串层，不引入任何重量级 i18n 框架。

## Glossary

- **Nuwa_Web**: 女娲 Nuwa 的 React 19 + TypeScript + Vite Web 前端应用（位于 `app/web`）。
- **Locale_Code**: 受支持语言的规范代码，取值集合为 `zh-CN`、`en`、`ja`。
- **Default_Locale**: 默认语言代码，固定为 `zh-CN`。
- **Display_Label**: 设置选择器中向用户展示的语言名称，取值集合为 `简体中文`、`English`、`日本語`。
- **Settings_Store**: 既有的 Zustand `uiStore`，其 `settings.language` 字段以 `Display_Label` 持久化于 `localStorage`。
- **Locale_Resolver**: 将任意输入（`Display_Label`、`Locale_Code` 或未知值）归一为合法 `Locale_Code` 的无副作用纯函数。
- **Translation_Catalog**: 单一 `Locale_Code` 对应的「翻译键 → 翻译字符串」映射表。
- **Translation_Key**: 标识一条界面文案的稳定字符串键（例如 `home.feature.chat.title`）。
- **Translation_Lookup**: 给定 `Locale_Code` 与 `Translation_Key`，返回对应翻译字符串的无副作用纯函数。
- **Translation_Hook**: React Hook，向组件暴露一个绑定当前语言的翻译函数 `t(key)`。
- **Document_Root**: HTML 文档根元素（`document.documentElement`，即 `<html>`）。
- **Lang_Effect**: 运行期副作用，将 `Document_Root` 的 `lang` 属性同步为当前 `Locale_Code`。

## Requirements

### Requirement 1: 受支持语言与翻译目录

**User Story:** 作为产品维护者，我想为三种受支持语言维护独立的翻译目录，以便每种语言的界面文案集中管理。

#### Acceptance Criteria

1. THE Nuwa_Web SHALL 为 `zh-CN`、`en`、`ja` 三个 Locale_Code 各提供一个 Translation_Catalog。
2. WHERE 任一 Translation_Catalog 含有至少一个 Translation_Key，THE Nuwa_Web SHALL 使三个 Translation_Catalog 使用同一组 Translation_Key 集合（允许三个 Translation_Catalog 同时为零键的空目录）。
3. WHERE 某 Translation_Key 在 `zh-CN` 的 Translation_Catalog 中已定义，THE Nuwa_Web SHALL 在该 Translation_Catalog 中为该 Translation_Key 提供非空字符串值。

### Requirement 2: 语言解析与归一

**User Story:** 作为用户，我想让我在设置中选择的语言被正确识别，以便界面按我选择的语言显示。

#### Acceptance Criteria

1. WHEN Locale_Resolver 接收到一个等于某 Display_Label 的输入，THE Locale_Resolver SHALL 返回该 Display_Label 对应的 Locale_Code。
2. WHEN Locale_Resolver 接收到一个等于某合法 Locale_Code 的输入，THE Locale_Resolver SHALL 原样返回该 Locale_Code。
3. IF Locale_Resolver 接收到一个既非合法 Display_Label 也非合法 Locale_Code 的输入（含空字符串、`null`、`undefined`），THEN THE Locale_Resolver SHALL 返回 Default_Locale。
4. THE Locale_Resolver SHALL 对相同输入恒返回相同 Locale_Code，且不修改 Settings_Store、DOM 或任何外部状态。

### Requirement 3: 带回退的翻译查找

**User Story:** 作为用户，我想在某条文案缺少当前语言翻译时仍看到可读文字，以便界面不出现空白或损坏。

#### Acceptance Criteria

1. WHEN Translation_Lookup 接收到一个 Locale_Code 与一个在该 Locale_Code 的 Translation_Catalog 中已定义的 Translation_Key，THE Translation_Lookup SHALL 返回该 Locale_Code 目录中对应的翻译字符串。
2. IF 某 Translation_Key 在给定 Locale_Code 的 Translation_Catalog 中未定义，但在 Default_Locale 的 Translation_Catalog 中已定义，THEN THE Translation_Lookup SHALL 返回 Default_Locale 目录中对应的翻译字符串。
3. IF 某 Translation_Key 在给定 Locale_Code 的 Translation_Catalog 与 Default_Locale 的 Translation_Catalog 中均未定义，THEN THE Translation_Lookup SHALL 返回该 Translation_Key 字符串本身。
4. THE Translation_Lookup SHALL 对相同的 Locale_Code 与 Translation_Key 输入恒返回相同字符串，且不修改任何外部状态。

### Requirement 4: 当前语言驱动的翻译 Hook

**User Story:** 作为组件开发者，我想在组件中调用一个绑定当前语言的 `t(key)` 函数，以便渲染随语言切换而更新的文案。

#### Acceptance Criteria

1. THE Translation_Hook SHALL 通过 Locale_Resolver 由 Settings_Store 的 `settings.language` 解析出当前 Locale_Code。
2. WHEN 组件调用 Translation_Hook 返回的翻译函数并传入某 Translation_Key，THE Translation_Hook SHALL 返回对当前 Locale_Code 经 Translation_Lookup 得到的字符串。
3. WHEN Settings_Store 的 `settings.language` 发生变更，THE Translation_Hook SHALL 使用变更后的 Locale_Code 提供翻译函数，使消费组件重新渲染为新语言文案。

### Requirement 5: 界面文案应用

**User Story:** 作为用户，我想在切换语言后看到首页、设置弹窗与通用按钮的文案随之改变，以便整个界面以我选择的语言呈现。

#### Acceptance Criteria

1. THE Nuwa_Web SHALL 在首页功能卡片（智能对话、角色管理、提示词、声音工坊、录音转写、模型管理）的标题与描述处使用 Translation_Hook 返回的翻译函数而非硬编码字面量。
2. THE Nuwa_Web SHALL 在设置弹窗的区段标签（设置、外观、后端地址、模型目录、界面语言、合成后自动播放）处使用 Translation_Hook 返回的翻译函数而非硬编码字面量。
3. WHILE 当前 Locale_Code 为 `en`，THE Nuwa_Web SHALL 在上述界面文案处显示 `en` Translation_Catalog 中对应的英文字符串。
4. WHILE 当前 Locale_Code 为 `ja`，THE Nuwa_Web SHALL 在上述界面文案处显示 `ja` Translation_Catalog 中对应的日文字符串。
5. IF 某界面文案对应的 Translation_Key 在当前 Locale_Code 的 Translation_Catalog 中缺失，THEN THE Nuwa_Web SHALL 显示由 Translation_Lookup 依据 Requirement 3 得到的字符串（即回退到 Default_Locale 的翻译，或在两个 Translation_Catalog 均缺失时以该 Translation_Key 自身作为占位符），不显示空白。

### Requirement 6: 同步 HTML lang 属性

**User Story:** 作为用户与依赖语言信息的辅助技术，我想让文档的语言标识与所选语言一致，以便正确处理朗读与排版。

#### Acceptance Criteria

1. WHEN Nuwa_Web 完成初始渲染，THE Lang_Effect SHALL 将 Document_Root 的 `lang` 属性设置为当前 Locale_Code。
2. WHEN Settings_Store 的 `settings.language` 变更导致当前 Locale_Code 改变，THE Lang_Effect SHALL 将 Document_Root 的 `lang` 属性更新为新的 Locale_Code。
