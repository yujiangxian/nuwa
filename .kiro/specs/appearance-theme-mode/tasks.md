# Implementation Plan: 外观主题应用引擎（appearance-theme-mode）

## Overview

按设计文档的依赖顺序逐步实现，保证每一步后代码库都可编译、可运行：先落地无副作用的纯逻辑模块 `lib/theme.ts`，再补全浅色 CSS 变量与首屏无闪烁内联脚本，最后接入运行期 React 副作用 hook 并完成测试基建与属性 / 单元测试。全部为纯前端增量，复用既有 `useUIStore` / `loadSettings` / `saveSettings` 持久化机制，不新增存储、不改动后端。

所有文件路径均相对 `app/web/`。属性测试使用 **fast-check（≥100 runs）+ Vitest（jsdom）**，每个属性测试以注释 `// Feature: appearance-theme-mode, Property N: ...` 标注。

## Tasks

- [x] 1. 实现 `lib/theme.ts` 纯逻辑与薄 DOM 写入
  - 新建 `src/lib/theme.ts`
  - 定义类型 `ThemeSetting = 'dark' | 'light' | 'system'`、`ResolvedTheme = 'dark' | 'light'`
  - 实现纯函数 `resolveTheme(themeSetting, systemPrefersDark)`：白名单 `switch` 处理 `'light'`→`'light'`、`'system'`→`systemPrefersDark ? 'dark' : 'light'`，`default`（含 `'dark'`、`null`、`undefined`、任意非法字符串）→ `'dark'`；无副作用、不读全局状态、不写 DOM
  - 实现 `applyTheme(resolved)`：`document.documentElement.dataset.theme = resolved`，幂等
  - 实现 `getSystemPrefersDark()`：`window.matchMedia('(prefers-color-scheme: dark)').matches`，`matchMedia` 不可用时回退 `false`
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.2_

- [x] 2. 为 `resolveTheme` / `applyTheme` 编写属性与单元测试
  - [x]* 2.1 编写 `resolveTheme` 确定性与全覆盖属性测试
    - 新建 `src/lib/theme.test.ts`
    - **Property 1: resolveTheme 的确定性与全覆盖（含非法值回退）**
    - 注释标签 `// Feature: appearance-theme-mode, Property 1: resolveTheme 的确定性与全覆盖（含非法值回退）`
    - fast-check `{ numRuns: 100 }`；`fc.oneof` 生成合法枚举 + `fc.string()` + 常量 `null`/`undefined` 作 `themeSetting`，`fc.boolean()` 作 `systemPrefersDark`；断言返回 ∈ `{'dark','light'}`、同输入多次调用一致、非 `'light'`/`'system'` 输入恒为 `'dark'`
    - **Validates: Requirements 1.1, 1.2, 1.5, 1.6**

  - [x]* 2.2 编写 system 模式等价属性测试
    - 在 `src/lib/theme.test.ts` 中追加
    - **Property 2: system 模式等价于系统偏好**
    - 注释标签 `// Feature: appearance-theme-mode, Property 2: system 模式等价于系统偏好`
    - fast-check `{ numRuns: 100 }`；`fc.boolean()` 作 `systemPrefersDark`，断言 `resolveTheme('system', x) === (x ? 'dark' : 'light')`
    - **Validates: Requirements 1.3, 1.4, 3.3, 4.2, 4.3**

  - [x]* 2.3 编写非 system 锁定忽略系统偏好属性测试
    - 在 `src/lib/theme.test.ts` 中追加
    - **Property 3: 非 system 锁定忽略系统偏好**
    - 注释标签 `// Feature: appearance-theme-mode, Property 3: 非 system 锁定忽略系统偏好`
    - fast-check `{ numRuns: 100 }`；`fc.constantFrom('dark','light')` 与 `fc.boolean()`，断言结果与 `systemPrefersDark` 无关且恒等于锁定主题本身
    - **Validates: Requirements 1.1, 1.2, 4.4**

  - [x]* 2.4 编写主题应用幂等性属性测试
    - 在 `src/lib/theme.test.ts` 中追加（使用 jsdom 的 `document.documentElement`）
    - **Property 4: 主题应用幂等性**
    - 注释标签 `// Feature: appearance-theme-mode, Property 4: 主题应用幂等性`
    - fast-check `{ numRuns: 100 }`；对任意输入解析后连续 `applyTheme` 两次，断言 `dataset.theme` 等于解析结果且二次应用不改变值
    - **Validates: Requirements 2.2, 3.1, 3.2, 5.1, 5.4**

  - [x]* 2.5 编写 `resolveTheme` 确定性示例与非法值边界单元测试
    - 在 `src/lib/theme.test.ts` 中追加
    - 四个确定性示例（`'dark'`、`'light'`、`'system'`+true、`'system'`+false）与非法值（`''`、`'DARK'`、`'auto'`、`undefined`）回退 `'dark'`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [x] 3. 在 `globals.css` 补全浅色变量覆盖
  - 修改 `src/styles/globals.css`
  - 新增 `:root[data-theme="light"]` 完整浅色覆盖块，按设计「CSS 变量映射表」为每个面向颜色的变量提供浅色取值（背景/表面/边框/文字/主色/`--danger`/`--ambient` 等）
  - 新增 `:root[data-theme="dark"]` 镜像块，取值与 `:root` 深色默认完全一致，保证显式 `dark` 与默认无差异
  - 保持 `:root` 现有深色取值不变（不回归既有深色视觉）
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 4.4, 7.3_

- [x] 4. 在 `index.html` 添加首屏无闪烁内联引导脚本
  - 修改 `index.html`，在 `<head>` 内、`<body>` 之前插入同步 `<script>`（非 `type="module"`，阻塞首绘前执行）
  - 脚本逻辑：`try/catch` 读取 `localStorage` 键 `nuwa_settings` → `JSON.parse` 取 `theme`（缺失/异常默认 `'dark'`）→ 读 `prefers-color-scheme`（异常回退 `prefersDark=true`）→ 与 `resolveTheme` 等价分支解析 → 写 `document.documentElement.dataset.theme`
  - 任意读取/解析异常兜底写 `data-theme='dark'`
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [x] 5. 实现 `hooks/useThemeEffect.ts` 并接入 `App.tsx`
  - [x] 5.1 实现 `useThemeEffect` 运行期副作用 hook
    - 新建 `src/hooks/useThemeEffect.ts`
    - `const theme = useUIStore((s) => s.settings.theme)`，`useEffect` 依赖 `[theme]`
    - effect 体先 `applyTheme(resolveTheme(theme, getSystemPrefersDark()))`
    - `theme === 'system'` 且 `typeof window.matchMedia === 'function'` 时注册 `change` handler `(e) => applyTheme(resolveTheme('system', e.matches))`（优先 `addEventListener`，回退 `addListener`），cleanup 中移除监听；非 `'system'` 不注册监听
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x] 5.2 在 `App.tsx` 顶层调用 `useThemeEffect()`
    - 修改 `src/App.tsx`，在 `App` 函数体顶部调用 `useThemeEffect()`，不改变其它现有逻辑
    - _Requirements: 2.1, 3.4_

- [x] 6. 添加 matchMedia mock 基建并编写 `useThemeEffect` 单元测试
  - [x] 6.1 在测试 setup 中新增 `installMockMatchMedia` helper
    - 修改 `src/test/setup.ts`，导出 `installMockMatchMedia({ prefersDark })`，返回带 `matches`、`addEventListener`/`removeEventListener`、可手动触发的 `dispatch(change)` 的 mql stub
    - _Requirements: 4.1, 4.2, 4.3_

  - [x]* 6.2 编写 `useThemeEffect` 单元测试
    - 新建 `src/hooks/useThemeEffect.test.ts`（`@testing-library/react` 的 `renderHook` + `installMockMatchMedia`）
    - 用例：初次挂载写正确 `data-theme`；`theme` `'dark'`→`'light'` 同步更新（不刷新）；`'system'` 时 `change` 跟随更新；`'system'`→`'dark'` 后再 `change` 不变且 `removeEventListener` 被调用；`matchMedia` 缺失时不抛错回退默认
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 7. Checkpoint - 类型检查与首轮测试
  - 运行 `tsc --noEmit` 与 `vitest --run`，确保编译通过、已写测试全部通过
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. 编写持久化往返与内联脚本等价性属性测试
  - [x]* 8.1 编写主题设置持久化往返一致属性测试
    - 新建 `src/store/theme.persistence.test.ts`
    - **Property 5: 主题设置持久化往返一致**
    - 注释标签 `// Feature: appearance-theme-mode, Property 5: 主题设置持久化往返一致`
    - fast-check `{ numRuns: 100 }`；`fc.constantFrom('dark','light','system')`，`updateSetting('theme', v)` 后 `loadSettings()` 断言 `theme` 往返相等，且 `backendUrl`/`modelsDir`/`autoPlay`/`language` 不变
    - **Validates: Requirements 6.1, 6.2, 6.3, 7.1, 7.2**

  - [x]* 8.2 编写启动解析与运行期解析等价性属性测试
    - 新建 `src/lib/theme.inline.test.ts`（将内联脚本解析分支抽为测试内等价函数 / 共享 helper）
    - **Property 6: 启动解析等价于运行期解析（内联脚本与 resolveTheme 一致）**
    - 注释标签 `// Feature: appearance-theme-mode, Property 6: 启动解析等价于运行期解析（内联脚本与 resolveTheme 一致）`
    - fast-check `{ numRuns: 100 }`；对任意持久化 `theme`（含缺失/非法）与任意系统偏好，断言内联解析结果 === `resolveTheme(theme ?? 'dark', systemPrefersDark)`
    - **Validates: Requirements 2.1, 2.4, 2.5**

- [x] 9. Final checkpoint - 全量验证
  - 运行 `tsc --noEmit`、`vitest --run`、`vite build`，确保类型检查、全部测试与生产构建均通过
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- 标注 `*` 的子任务为可选测试任务，可为快速 MVP 跳过；核心实现任务（`lib/theme.ts`、`globals.css`、`index.html`、`useThemeEffect`、`App.tsx` 接入、matchMedia helper）不可跳过。
- 每个任务引用具体需求子条款以保证可追溯性。
- 6 个 Correctness Property 分别映射到 2.1–2.4、8.1、8.2 子任务，均要求 fast-check ≥100 runs 并带 `// Feature: appearance-theme-mode, Property N: ...` 注释标签。
- Checkpoint 任务（7、9）用 `tsc --noEmit` + `vitest --run`（+ task 9 的 `vite build`）做增量验证。
- 纯前端增量：复用既有 `useUIStore` / `loadSettings` / `saveSettings`，不新增存储、不改后端。

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1", "3", "4"] },
    { "id": 1, "tasks": ["2.1", "2.2", "2.3", "2.4", "2.5", "5.1", "6.1", "8.2"] },
    { "id": 2, "tasks": ["5.2", "8.1"] },
    { "id": 3, "tasks": ["6.2"] }
  ]
}
```
