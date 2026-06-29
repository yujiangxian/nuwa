# Implementation Plan: 界面多语言（ui-internationalization）

## Overview

按设计文档的分层依赖顺序逐步实现，保证每一步后代码库都可编译、可运行：先落地无副作用的纯逻辑模块 `lib/i18n.ts`（`resolveLocale`、`translate`、`CATALOGS`、`LOCALE_LABELS`），再补全针对纯逻辑层的属性测试（Property 1–9），随后实现读取当前语言的 `useI18n` Hook 与同步 `<html lang>` 的薄副作用 `useLangEffect` Hook 并接入 `App.tsx`，最后把硬编码中文字面量在 `HomePage` 与 `SettingsModal` 处替换为 `t(key)` 调用。全部为纯前端增量，复用既有 `useUIStore` 的 `settings.language` 持久化机制，不新增存储、不引入任何第三方 i18n 框架、不改动后端。

本设计严格镜像既有外观主题系统（appearance-theme-mode）的分层与任务结构：纯逻辑层对应 `lib/theme.ts`，`useLangEffect` 对应 `useThemeEffect`。

所有文件路径均相对 `app/web/`。属性测试使用 **fast-check（≥100 runs）+ Vitest（jsdom）**，每个属性测试以注释 `// Feature: ui-internationalization, Property N: ...` 标注。React 集成测试使用 **@testing-library/react**。

## Tasks

- [x] 1. 实现 `lib/i18n.ts` 纯逻辑层与翻译目录
  - [x] 1.1 实现类型、静态数据与无副作用纯函数
    - 新建 `src/lib/i18n.ts`
    - 定义类型 `LocaleCode = 'zh-CN' | 'en' | 'ja'`、`TranslationKey = string`、`TranslationCatalog = Record<TranslationKey, string>`
    - 定义常量 `DEFAULT_LOCALE: LocaleCode = 'zh-CN'`、`SUPPORTED_LOCALES: readonly LocaleCode[] = ['zh-CN', 'en', 'ja']`、`LOCALE_LABELS: Record<LocaleCode, string>`（`zh-CN`→`简体中文`、`en`→`English`、`ja`→`日本語`）及其反向映射 `LABEL_TO_CODE`
    - 定义 `CATALOGS: Record<LocaleCode, TranslationCatalog>`，三种语言共享同一组 `Translation_Key` 集合；补全设计「翻译目录」表中全部键（`home.subtitle`、`home.feature.{chat|characters|presets|voice|transcribe|models}.{title|desc}`、`settings.title`、`settings.appearance`、`settings.backendUrl`、`settings.modelsDir`、`settings.language`、`settings.autoPlay.{title|desc}`、`settings.theme.{dark|light|system}`），`zh-CN` 目录对每个键提供 `trim` 后非空字符串
    - 实现纯函数 `resolveLocale(input: string | null | undefined): LocaleCode`：合法 `LocaleCode` 原样返回；合法 `Display_Label` 返回对应 `LocaleCode`；其他（空串、`null`、`undefined`、未知串）返回 `DEFAULT_LOCALE`；不读写 store/DOM/任何外部状态
    - 实现纯函数 `translate(locale: LocaleCode, key: TranslationKey): string`：回退链 active 目录命中 → `DEFAULT_LOCALE` 目录命中 → 返回 key 本身；不修改任何外部状态
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4_

- [x] 2. 为 `lib/i18n.ts` 编写属性测试与确定性示例测试
  - [x]* 2.1 编写 resolveLocale 合法输入归一属性测试
    - 新建 `src/lib/i18n.test.ts`
    - **Property 1: resolveLocale 对合法输入正确归一**
    - 注释标签 `// Feature: ui-internationalization, Property 1: resolveLocale 对合法输入正确归一`
    - fast-check `{ numRuns: 100 }`；从 `LOCALE_LABELS` 生成 `(label, code)` 对、从 `SUPPORTED_LOCALES` 采样 code，断言 `resolveLocale(label) === code` 且 `resolveLocale(code) === code`
    - **Validates: Requirements 2.1, 2.2**

  - [x]* 2.2 编写 resolveLocale 非法输入回退属性测试
    - 在 `src/lib/i18n.test.ts` 中追加
    - **Property 2: resolveLocale 对非法输入回退 Default_Locale**
    - 注释标签 `// Feature: ui-internationalization, Property 2: resolveLocale 对非法输入回退 Default_Locale`
    - fast-check `{ numRuns: 100 }`；`fc.oneof(fc.string(), fc.constant(null), fc.constant(undefined))` 过滤掉合法 label/code 后断言结果 `=== DEFAULT_LOCALE`；显式补 `''`、`null`、`undefined` 边界示例
    - **Validates: Requirements 2.3**

  - [x]* 2.3 编写 resolveLocale 全函数性与确定性属性测试
    - 在 `src/lib/i18n.test.ts` 中追加
    - **Property 3: resolveLocale 全函数性与确定性**
    - 注释标签 `// Feature: ui-internationalization, Property 3: resolveLocale 全函数性与确定性`
    - fast-check `{ numRuns: 100 }`；任意输入断言返回值 ∈ `SUPPORTED_LOCALES`、两次调用相等；断言调用前后 `document.documentElement.lang` 不变（无副作用）
    - **Validates: Requirements 2.4**

  - [x]* 2.4 编写 translate 命中当前语言目录属性测试
    - 在 `src/lib/i18n.test.ts` 中追加
    - **Property 4: translate 命中当前语言目录时返回该值**
    - 注释标签 `// Feature: ui-internationalization, Property 4: translate 命中当前语言目录时返回该值`
    - fast-check `{ numRuns: 100 }`；对每个 locale 从其目录键集合 `fc.constantFrom(...keys)` 采样，断言 `translate(locale, key) === CATALOGS[locale][key]`
    - **Validates: Requirements 3.1**

  - [x]* 2.5 编写 translate 回退默认语言属性测试
    - 在 `src/lib/i18n.test.ts` 中追加
    - **Property 5: translate 在当前语言缺失时回退默认语言**
    - 注释标签 `// Feature: ui-internationalization, Property 5: translate 在当前语言缺失时回退默认语言`
    - fast-check `{ numRuns: 100 }`；通过可注入查找入口或合成目录构造「仅 zh-CN 定义」的键，断言 `translate(locale, key)` 返回 `DEFAULT_LOCALE` 目录中对应值（构造方式须不受真实目录补全影响而保持稳定）
    - **Validates: Requirements 3.2**

  - [x]* 2.6 编写 translate 两目录均缺失返回键本身属性测试
    - 在 `src/lib/i18n.test.ts` 中追加
    - **Property 6: translate 在两目录均缺失时返回键本身**
    - 注释标签 `// Feature: ui-internationalization, Property 6: translate 在两目录均缺失时返回键本身`
    - fast-check `{ numRuns: 100 }`；生成不在任何目录中的随机键（过滤所有已知键）与任意 locale，断言 `translate(locale, key) === key`
    - **Validates: Requirements 3.3**

  - [x]* 2.7 编写 translate 确定性与无副作用属性测试
    - 在 `src/lib/i18n.test.ts` 中追加
    - **Property 7: translate 确定性与无副作用**
    - 注释标签 `// Feature: ui-internationalization, Property 7: translate 确定性与无副作用`
    - fast-check `{ numRuns: 100 }`；任意 `(locale, key)` 两次调用返回相同字符串；断言调用前后外部状态（`document.documentElement.lang`）不变
    - **Validates: Requirements 3.4**

  - [x]* 2.8 编写翻译目录键集合一致属性测试
    - 在 `src/lib/i18n.test.ts` 中追加
    - **Property 8: 三种语言目录共享同一键集合**
    - 注释标签 `// Feature: ui-internationalization, Property 8: 三种语言目录共享同一键集合`
    - fast-check `{ numRuns: 100 }`；对所有 LocaleCode 对断言 `new Set(Object.keys(CATALOGS[a]))` 与 `CATALOGS[b]` 的键集合相等
    - **Validates: Requirements 1.2**

  - [x]* 2.9 编写 zh-CN 目录值非空属性测试
    - 在 `src/lib/i18n.test.ts` 中追加
    - **Property 9: zh-CN 目录的每个键值为非空字符串**
    - 注释标签 `// Feature: ui-internationalization, Property 9: zh-CN 目录的每个键值为非空字符串`
    - fast-check `{ numRuns: 100 }`；从 `Object.keys(CATALOGS['zh-CN'])` 采样键，断言其值为 `string` 且 `trim().length > 0`
    - **Validates: Requirements 1.3**

  - [x]* 2.10 编写 resolveLocale / translate 确定性示例边界单元测试
    - 在 `src/lib/i18n.test.ts` 中追加（镜像 `theme.test.ts` 的确定性示例块）
    - `resolveLocale`：三语 label/code、空串、`null`、`undefined`、未知串的确定性断言
    - `translate`：命中当前语言、回退默认语言、回退键本身三个确定性示例
    - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.3_

- [x] 3. 实现 `hooks/useI18n.ts` 当前语言驱动的翻译 Hook
  - [x] 3.1 实现 useI18n
    - 新建 `src/hooks/useI18n.ts`
    - 定义接口 `I18n { locale: LocaleCode; t: (key: TranslationKey) => string }`
    - `const language = useUIStore((s) => s.settings.language)` → `const locale = resolveLocale(language)`；以 `useMemo` 基于 `locale` 缓存 `t = (key) => translate(locale, key)`
    - `settings.language` 变更触发 Zustand 选择器重渲染，使 `locale`/`t` 随之更新
    - _Requirements: 4.1, 4.2, 4.3_

  - [x]* 3.2 编写 useI18n 集成测试
    - 新建 `src/hooks/useI18n.test.ts`（`@testing-library/react` 的 `renderHook`）
    - 用例：设 `settings.language` 为各 Display_Label，断言 `locale === resolveLocale(label)` 且 `t(key) === translate(locale, key)`；`act` 中 `updateSetting('language', 新 label)` 后断言 `locale`/`t` 更新为新语言（响应式重渲染）
    - _Requirements: 4.1, 4.2, 4.3_

- [x] 4. 实现 `hooks/useLangEffect.ts` 并接入 `App.tsx`
  - [x] 4.1 实现 useLangEffect 薄副作用 Hook
    - 新建 `src/hooks/useLangEffect.ts`（镜像 `useThemeEffect.ts` 结构）
    - `const language = useUIStore((s) => s.settings.language)`；`useEffect(() => { document.documentElement.lang = resolveLocale(language); }, [language])`
    - 是唯一接触 `<html lang>` 属性的代码；幂等、不抛错
    - _Requirements: 6.1, 6.2_

  - [x] 4.2 在 `App.tsx` 顶层调用 useLangEffect()
    - 修改 `src/App.tsx`，在既有 `useThemeEffect()` 旁新增 `useLangEffect()` 调用一次，不改变其它现有逻辑
    - _Requirements: 6.1_

  - [x]* 4.3 编写 useLangEffect 集成测试
    - 新建 `src/hooks/useLangEffect.test.ts`（`renderHook` 或宿主组件渲染）
    - 用例：初次挂载后断言 `document.documentElement.lang === resolveLocale(初始 language)`；`act` 中更新 `settings.language` 后断言 `lang` 更新为新 LocaleCode（含 Display_Label 与未知值回退两种输入）
    - _Requirements: 6.1, 6.2_

- [x] 5. Checkpoint - 类型检查与首轮测试
  - 运行 `tsc --noEmit` 与 `vitest --run`，确保编译通过、已写测试（Property 1–9、示例、Hook 集成）全部通过
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. 将 `HomePage.tsx` 文案接入翻译
  - [x] 6.1 用 t(key) 替换 HomePage 硬编码字面量
    - 修改 `src/components/HomePage.tsx`
    - 组件内 `const { t } = useI18n()`；`features` 数组的 `title`/`desc` 字面量替换为翻译键引用（`titleKey`/`descKey`），渲染处用 `t(f.titleKey)`/`t(f.descKey)`；页副标题改为 `t('home.subtitle')`
    - 所用键须与 `CATALOGS` 中定义的键一致；缺失键由 `translate` 依 Property 5/6 回退，界面不空白
    - _Requirements: 5.1, 5.3, 5.4, 5.5_

  - [x]* 6.2 编写 HomePage 多语言集成测试
    - 修改/扩展 `src/components/HomePage.test.tsx`
    - 用例：默认（zh-CN）渲染断言出现各功能卡片中文标题/描述；设 `language='English'`/`'日本語'` 渲染断言出现对应英文/日文文本；构造当前语言缺失键的场景断言显示回退文本无空白
    - _Requirements: 5.1, 5.3, 5.4, 5.5_

- [x] 7. 将 `SettingsModal.tsx` 文案接入翻译
  - [x] 7.1 用 t(key) 替换 SettingsModal 硬编码字面量
    - 修改 `src/components/SettingsModal.tsx`
    - 组件内 `const { t } = useI18n()`；区段标签（设置标题、外观、后端地址、模型目录、界面语言、合成后自动播放及其副描述、主题三选项）改为 `t(key)`
    - 语言 `<select>` 的选项继续使用 `LOCALE_LABELS` 的值作为展示文本与存储值（维持 `settings.language` 存 `Display_Label` 的现状）
    - _Requirements: 5.2, 5.3, 5.4, 5.5_

  - [x]* 7.2 编写 SettingsModal 多语言集成测试
    - 新建 `src/components/SettingsModal.test.tsx`（复用既有组件测试模式）
    - 用例：打开态默认渲染断言区段标签来自 zh-CN 目录；切换 `language` 为 `English`/`日本語` 断言标签文本随之变化；语言选择器选项展示 `LOCALE_LABELS` 值
    - _Requirements: 5.2, 5.3, 5.4_

- [x] 8. Final checkpoint - 全量验证
  - 运行 `tsc --noEmit`、`vitest --run`、`vite build`，确保类型检查、全部测试与生产构建均通过
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- 标注 `*` 的子任务为可选测试任务，可为快速 MVP 跳过；核心实现任务（`lib/i18n.ts`、`useI18n`、`useLangEffect`、`App.tsx` 接入、`HomePage`/`SettingsModal` 文案接入）不可跳过。
- 每个任务引用具体需求子条款以保证可追溯性。
- 9 个 Correctness Property 分别映射到 2.1–2.9 子任务，均要求 fast-check ≥100 runs 并带 `// Feature: ui-internationalization, Property N: ...` 注释标签；2.10 为确定性示例补充。
- Hook 与 DOM 副作用（Req 4、6）及组件文案应用（Req 5）以集成/示例测试覆盖，符合设计 Testing Strategy 的「属性测试 + 集成测试」双轨。
- Checkpoint 任务（5、8）用 `tsc --noEmit` + `vitest --run`（+ task 8 的 `vite build`）做增量验证。
- 纯前端增量：复用既有 `useUIStore` 的 `settings.language`，不新增存储、不引入第三方 i18n 框架、不改后端。

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "2.2", "2.3", "2.4", "2.5", "2.6", "2.7", "2.8", "2.9", "2.10", "3.1", "4.1"] },
    { "id": 2, "tasks": ["3.2", "4.2", "6.1", "7.1"] },
    { "id": 3, "tasks": ["4.3", "6.2", "7.2"] }
  ]
}
```
