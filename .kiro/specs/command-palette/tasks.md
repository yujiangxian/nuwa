# Implementation Plan: Command Palette（命令面板与键盘快捷键系统）

## Overview

本实现计划将设计拆解为一系列增量、测试驱动的编码任务，严格沿用既有分层约定（`app/web/src/lib/*.ts` 纯逻辑 + 同名 `*.test.ts`、`store/uiStore.ts` UI 切片、`hooks/*.ts` 运行期副作用、`components/*.tsx` + RTL 测试）。

实现顺序遵循依赖关系：先落地两层无副作用纯函数（`keyCombo`、`commandPalette`），它们承载设计中的两条 Correctness Properties（Property 1 / Property 2），可被 fast-check 属性测试覆盖；再实现 store 切片、注册表 builder；随后实现运行期 Keybinding_Engine Hook 与覆盖层组件；最后接线进 `App.tsx` 并清理零散导航 hack，整体构建与测试收口。

约定：
- 所有源码与测试位于 `app/web/src/` 下；测试运行器为 vitest（`npm test` 已配置 `vitest --run`，jsdom 环境）。
- 属性测试使用 **fast-check**，每个属性 `fc.assert(..., { numRuns: 100 })`（最少 100 次迭代）。
- 每个属性测试以注释标注其设计属性，格式：`// Feature: command-palette, Property N: ...`。
- 标记 `*` 的子任务为可选测试任务，可为快速 MVP 跳过；核心实现任务不带 `*`。

## Tasks

- [x] 1. 实现 `lib/keyCombo.ts` 按键组合纯逻辑层
  - [x] 1.1 实现 KeyCombo 类型与解析/格式化/归一化/平台判定函数
    - 在 `app/web/src/lib/keyCombo.ts` 定义 `Platform` 类型与 `KeyCombo` 接口（`ctrl`/`meta`/`shift`/`alt`/`key`）
    - 实现 `parseKeyCombo(input, platform)`：`trim` + `toLowerCase` + 按 `+` 切分去空段；修饰键 token 别名归一（`ctrl/control`→ctrl、`meta/cmd/command`→meta、`shift`→shift、`alt/option`→alt、`mod`→依平台 meta/ctrl）；恰好一个主键返回结构，空串/全空白/仅修饰键/未知 token/重复主键返回 `null`
    - 实现 `formatKeyCombo(combo)`：严格按 `ctrl → meta → shift → alt → key` 顺序以 `+` 拼接，保证规范形式唯一
    - 实现 `keyComboEquals(a, b)`：四个修饰标志 + `key` 全等比较
    - 实现 `eventToKeyCombo(e, platform)`：读取 `ctrlKey/metaKey/shiftKey/altKey` 与 `e.key`（转小写）做纯数据转换
    - 实现 `detectPlatform()`：运行期一次性探测（仅供 Hook/组件调用，纯函数不依赖它）
    - _Requirements: 7.1, 7.2, 7.3, 7.6, 7.7_

  - [x]* 1.2 编写 `keyCombo.test.ts` 的 fast-check 属性测试（Property 2）
    - 使用 fast-check，`{ numRuns: 100 }`（≥100 次迭代）
    - 注释标签：`// Feature: command-palette, Property 2: Key_Combo 解析/格式化往返与规范幂等`
    - 往返：用 `fc.record` 直接构造规范 `KeyCombo`（具体 ctrl/meta 标志，规避 `mod` 别名歧义），断言 `parseKeyCombo(formatKeyCombo(x), platform)` 结构等于 `x`
    - 规范幂等：从修饰键 token 子集（随机大小写/顺序/多余空白）+ 一个主键拼出合法字符串 `s`，断言 `parseKeyCombo(formatKeyCombo(parseKeyCombo(s, platform)!), platform)` 等于 `parseKeyCombo(s, platform)`
    - 纯性/确定性：断言两次调用结果相等、调用不改外部状态
    - 对 `'mac'` 与 `'other'` 两个平台各跑一遍
    - **Property 2: Key_Combo 解析/格式化往返与规范幂等**
    - **Validates: Requirements 7.1, 7.3, 7.4, 7.5, 7.7**

  - [x]* 1.3 编写 `keyCombo.test.ts` 的边界单元测试
    - 非法输入返回 `null`：`''`、`'   '`、`'ctrl+'`（缺主键）、`'foo+k'`（未知 token）、`'a+b'`（重复主键）
    - `mod` 平台归一：`parseKeyCombo('mod+k','mac')` → `meta===true && ctrl===false`；`'other'` 反之
    - `formatKeyCombo` 固定顺序：`{ctrl,meta,shift,alt,key:'p'}` → `'ctrl+meta+shift+alt+p'`
    - _Requirements: 7.2, 7.3, 7.6_

- [x] 2. 实现 `lib/commandPalette.ts` 命令类型与过滤纯逻辑层
  - [x] 2.1 实现 CommandItem 类型、子序列匹配与过滤/高亮纯函数
    - 在 `app/web/src/lib/commandPalette.ts` 定义 `CommandGroup` 类型与 `CommandItem` 接口（`id`/`title`/`subtitle?`/`keywords`/`group`/`combo?`/`run`）
    - 实现 `isSubsequenceMatch(query, text)`：大小写无关子序列匹配，空 query 命中一切
    - 实现 `filterCommands(query, items)`：query 经 `trim` 为空返回保序全量副本；非空时用单次 `Array.prototype.filter` 保留 `title` 或任一 `keyword` 子序列匹配 query 的项，保持相对顺序、输出为输入子集，不读写外部状态
    - 实现 `clampHighlight(index, length)`：`length<=0` 返回 -1，否则夹到 `[0, length-1]`
    - 实现 `moveHighlightIndex(current, delta, length)`：`length<=0` 返回 -1，否则 `(current + delta)` 对 length 取模回绕
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1, 4.2, 4.3_

  - [x]* 2.2 编写 `commandPalette.test.ts` 的 fast-check 属性测试（Property 1）
    - 使用 fast-check，`{ numRuns: 100 }`（≥100 次迭代）
    - 注释标签：`// Feature: command-palette, Property 1: Command_Filter 契约（保序子集选择 + 匹配语义 + 幂等 + 纯性）`
    - 生成器：`fc.array(fc.record({ id, title, subtitle?, keywords: fc.array(fc.string()), group, run: () => {} }))` 生成随机 `CommandItem[]`；query 用 `fc.string()`（含空串、含从标题/关键字采样的子序列以提升命中率）
    - 单一属性内综合校验：输出下标在 items 中严格递增（保序）；每个输出元素按引用 ∈ items 且无重复引用（子集）；空 query → 输出深等 items（保序全量）；每元素「是否在输出」== 「title 或某 keyword 子序列匹配 query（忽略大小写）」（匹配语义双向）；`filterCommands(q, filterCommands(q, items))` 深等 `filterCommands(q, items)`（幂等）；调用前后 items 不变、两次调用结果深等（纯性/确定性）
    - **Property 1: Command_Filter 契约**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**

  - [x]* 2.3 编写 `commandPalette.test.ts` 的边界单元测试
    - `clampHighlight`：index 越界 / 负值 / `length=0`（返回 -1）
    - `moveHighlightIndex`：末尾 +1 回绕到 0、0 处 -1 回绕到末尾、空列表返回 -1
    - `isSubsequenceMatch`：空 query 命中、顺序敏感、非相邻命中
    - _Requirements: 4.1, 4.2, 4.3_

- [x] 3. 在 `store/uiStore.ts` 新增 Palette_Store 切片
  - [x] 3.1 添加 palette 状态字段与 actions
    - 在 `app/web/src/store/uiStore.ts` 的 `UIState` 接口新增 `paletteOpen: boolean`、`paletteQuery: string`、`highlightIndex: number`
    - 在 `create<UIState>` 工厂返回对象新增初始值与 actions：`paletteOpen:false` / `paletteQuery:''` / `highlightIndex:-1`；`openPalette()` 置 `{paletteOpen:true, paletteQuery:'', highlightIndex:-1}`；`closePalette()` 置 `paletteOpen:false`；`setPaletteQuery(query)`；`moveHighlight(delta, listLength)` 复用 `moveHighlightIndex`；`setHighlightIndex(index)`
    - 从 `@/lib/commandPalette` 导入 `moveHighlightIndex`
    - _Requirements: 1.2, 1.3, 4.1, 4.2, 4.3, 5.6_

  - [x]* 3.2 编写 uiStore Palette 切片测试
    - 在对应的 store 测试文件中直接调用 actions 断言状态迁移：`openPalette` 后 `paletteOpen===true && paletteQuery==='' && highlightIndex===-1`；`closePalette` 后 `paletteOpen===false`；`setPaletteQuery` 写入；`moveHighlight` 回绕；`setHighlightIndex` 直接设值
    - _Requirements: 1.2, 1.3, 4.1, 4.2, 4.3_

- [x] 4. 实现 `lib/commandRegistry.ts` 注册表 builder
  - [x] 4.1 实现 buildCommandRegistry
    - 在 `app/web/src/lib/commandRegistry.ts` 定义 `CommandRegistryContext` 接口（`setPage`/`setSettingsOpen`/`updateSetting`/`createSession`/`currentCharacterId`/`platform`/可选 `t`）
    - 实现 `buildCommandRegistry(ctx)` 返回有序 `CommandItem[]`：7 个导航命令（home/chat/voice/transcribe/models/characters/presets，run 调 `setPage`）、1 个打开设置（run 调 `setSettingsOpen(true)`）、3 个主题（dark/light/system，run 调 `updateSetting('theme', …)`）、每个 `SUPPORTED_LOCALES` 一个语言命令（run 调 `updateSetting('language', LOCALE_LABELS[code])`）、1 个新建会话（run 调 `createSession(currentCharacterId)` 后 `setPage('chat')`）
    - id 采用稳定前缀（`nav.home`/`settings.open`/`theme.dark`/`locale.zh-CN`/`session.new` 等）保证唯一；关联快捷键的命令在 `combo` 上记录 `formatKeyCombo(parseKeyCombo(src, platform)!)` 规范字符串
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x]* 4.2 编写 `commandRegistry.test.ts` 单元测试
    - 用注入 mock actions 的上下文构建注册表，断言：每项含 `id/title/keywords/group/run`；7 个 App_Page 各有导航命令；存在打开设置、3 个主题、每个 `SUPPORTED_LOCALES` 一个语言命令、新建会话命令
    - id 唯一：`new Set(ids).size === items.length`
    - 带 `combo` 的命令其 `combo === formatKeyCombo(parseKeyCombo(src, platform)!)`
    - 调用各类命令 `run` 断言触发对应 mock action（导航 `setPage`、设置 `setSettingsOpen`、主题/语言 `updateSetting`、新建会话 `createSession` + `setPage('chat')`）
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 5.1, 5.2, 5.3, 5.4, 5.5_

- [x] 5. 检查点 - 确保纯逻辑层、store 与注册表测试全部通过
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. 实现 `hooks/useKeybindings.ts`（Keybinding_Engine）
  - [x] 6.1 实现全局 keydown 引擎 Hook
    - 在 `app/web/src/hooks/useKeybindings.ts` 实现 `useKeybindings()`：`useEffect` 内 `const platform = detectPlatform()`，在 `document` 注册单个 `keydown` 监听器，依赖数组为空 `[]`，cleanup 中 `removeEventListener`
    - handler 经 `eventToKeyCombo(e, platform)` 归一化，通过 `useUIStore.getState()` 实时读取状态/actions（避免闭包过期）
    - 匹配 `mod+k`：`paletteOpen` 为 false 时 `openPalette()`、为 true 时 `closePalette()`，并 `preventDefault()`
    - 匹配 `Escape`：关闭最上层模态（Command_Palette 优先于 SettingsModal）
    - Editable_Target 守卫：`document.activeElement` 为 `input`/`textarea`/`select`/`contenteditable` 且 Key_Combo 不含 `ctrl`/`meta` 时不触发任何动作
    - _Requirements: 1.1, 1.4, 1.6, 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x]* 6.2 编写 `useKeybindings.test.tsx` 集成测试
    - 在宿主组件中调用 Hook；spy `document.addEventListener`/`removeEventListener` 断言注册与卸载清理
    - 派发 `mod+k`（按平台用 metaKey/ctrlKey）断言 `openPalette`/`closePalette` 切换且 `defaultPrevented`
    - 聚焦 `<input>` 后派发裸 `'k'`（不触发）与 `'mod+k'`（仍触发）验证 Editable_Target 守卫
    - 模态打开时 `Escape` 关闭最上层（面板优先于设置）
    - 卸载组件断言监听器被移除
    - _Requirements: 1.1, 1.4, 1.6, 6.1, 6.2, 6.3, 6.4, 6.5_

- [x] 7. 实现 `components/CommandPalette.tsx` 覆盖层组件
  - [x] 7.1 实现命令面板组件
    - 在 `app/web/src/components/CommandPalette.tsx` 实现默认导出组件：`paletteOpen` 为 false 返回 `null`
    - 用 `useUIStore` 订阅 `paletteOpen`/`paletteQuery`/`highlightIndex` 及 actions；`useMemo` 基于上下文 `buildCommandRegistry`，基于 `paletteQuery` 计算 `filtered = filterCommands(...)`
    - 渲染遮罩 + 居中面板：搜索输入框 + 按 `CommandGroup` 分组的结果列表，组内保持 filtered 相对顺序
    - 每项显示 `title`（及存在的 `subtitle`）；关联 `combo` 时经 `formatKeyCombo` 显示；高亮项施加高亮样式；空结果显示空状态提示
    - 键盘：ArrowDown/ArrowUp 经 `moveHighlight` 回绕移动，Enter 执行 `filtered[highlightIndex]?.run()` 后 `closePalette()`（空结果不执行且保持打开），Escape 关闭
    - `useEffect` 在 `filtered.length`/`paletteQuery` 变化时 `setHighlightIndex(clampHighlight(highlightIndex, filtered.length))`，打开时若为 -1 落到 0；`useRef` + `useEffect` 聚焦并保持搜索框焦点
    - 点击遮罩（列表/搜索框之外）`closePalette()`
    - _Requirements: 1.2, 1.3, 1.5, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.6, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

  - [x]* 7.2 编写 `CommandPalette.test.tsx` 组件测试
    - 渲染：`paletteOpen=false` 不渲染；`true` 渲染搜索框 + 分组列表
    - 展示：断言 `title`/`subtitle` 出现；带 `combo` 命令显示 `formatKeyCombo` 文本；高亮项有高亮样式；无匹配显示空状态；分组标题出现且组内顺序符合注册表
    - 键盘：`user-event` 输入过滤；ArrowDown/ArrowUp 移动并回绕；query 变化后高亮规整；Enter 调用高亮项 `run`（mock）并关闭；空结果 Enter 不执行且保持打开；打开后 `document.activeElement` 为搜索框且持续保持；Escape 与遮罩外点击关闭；打开时 query 重置为空、高亮落首项
    - 副作用接线：注入 mock `setPage`/`setSettingsOpen`/`updateSetting`/`createSession`，断言各类命令 `run` 调用对应 action
    - _Requirements: 1.2, 1.3, 1.5, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

- [x] 8. 在 `App.tsx` 接线并清理零散 hack
  - [x] 8.1 集成 Keybinding_Engine 与命令面板组件
    - 在 `app/web/src/App.tsx` 既有 `useThemeEffect()`/`useLangEffect()` 旁新增一次 `useKeybindings()` 调用
    - 在 `<SettingsModal />` 旁渲染 `<CommandPalette />`
    - 移除 App 内仅处理 `Escape` 关闭设置的临时 `keydown` 监听（职责并入 `useKeybindings` 的 Escape 分支）
    - 清理 `window.__nuwa_switchPage` 导航 hack，确认命令 `run` 直接经 `setPage` 导航，移除对该全局的所有读写引用
    - _Requirements: 5.1, 6.1, 6.4_

- [x] 9. 最终检查点 - 全量构建与测试收口
  - 运行 `npm run build`（在 `app/web` 目录）确保 TypeScript 编译与构建通过
  - 运行 `npm test`（`vitest --run`）确保全部单元测试、属性测试与组件测试通过，修复任何失败
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- 标记 `*` 的子任务为可选测试任务，可为快速 MVP 跳过；核心实现任务（不带 `*`）必须实现。
- 每个任务引用具体需求子项以保证可追溯性。
- 属性测试覆盖 `filterCommands`（Property 1）与 `keyCombo` 解析/格式化（Property 2）的全输入空间，各 ≥100 次迭代，并带 `// Feature: command-palette, Property N: ...` 注释标签。
- 单元/集成/组件测试覆盖注册表结构、store 迁移、Keybinding 引擎与 DOM 交互、副作用接线等示例与边界。
- 检查点用于增量验证；纯逻辑层先行落地以尽早暴露错误。

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["1.2", "2.2", "3.1", "4.1"] },
    { "id": 2, "tasks": ["1.3", "2.3", "3.2", "4.2", "6.1", "7.1"] },
    { "id": 3, "tasks": ["6.2", "7.2", "8.1"] }
  ]
}
```
