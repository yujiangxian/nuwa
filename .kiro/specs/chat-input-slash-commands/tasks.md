# Implementation Plan: chat-input-slash-commands（对话输入框斜杠命令）

## Overview

在女娲 Nuwa 对话页输入框之上叠加斜杠命令菜单。遵循既有「纯函数核心 + 薄 UI 集成」分层惯例，按「纯逻辑模块 `lib/slashCommand.ts` → 其属性测试（5 条 Correctness Property）与单元测试 → 展示组件 `SlashCommandMenu.tsx` → `ChatPage.tsx` 集成 → 组件/集成测试 → 无回归测试 → 最终检查点」的依赖顺序推进，保证任意阶段 `app/web` 均可编译。

本特性为纯前端、纯增量增强：不改动任何后端（`voxcpm-server`）接口，不改动 `Chat_Store` 既有对外契约。全部任务均为编写、修改、测试代码（仅前端 TypeScript），无后端/Rust 任务。5 条 Correctness Property 各对应一个属性测试任务（fast-check，≥100 runs，沿用 `lib/promptPreset.test.ts` 约定）。

实现指导：将设计转换为一系列可由代码生成 LLM 逐步实现的提示，每一步都建立在前一步之上，并以「接线整合」收尾，不留悬空/孤立代码。仅包含编写、修改、测试代码的任务。

## Tasks

- [x] 1. 纯逻辑模块 `app/web/src/lib/slashCommand.ts`
  - [x] 1.1 实现斜杠命令纯函数核心
    - 新建 `app/web/src/lib/slashCommand.ts`，`import type { PromptPreset } from '@/store/uiStore'`，运行期不依赖 DOM / Chat_Store / IndexedDB
    - 定义 `export interface CommandItem { kind: 'builtin' | 'preset'; commandKey: string; title: string; description: string; presetId?: string }` 与 `export type BuiltinKey = 'clear' | 'retry' | 'presets'`
    - 实现 `isSlashActive(text)`：首字符为 `/` 且不含 `\n`/`\r` 时为 `true`，空串/首字符非 `/`/含换行为 `false`
    - 实现 `parseSlashQuery(text)`：激活态返回首个 `/` 之后到末尾子串（单个 `/` => `''`），否则 `null`
    - 实现 `buildSlashText(query)`：空串 => `"/"`，非空 `q` => `"/" + q`，与 `parseSlashQuery` 互逆
    - 实现 `buildBuiltinCommands()`：固定返回 `clear`/`retry`/`presets` 三条（顺序稳定）
    - 实现 `buildPresetCommands(presets)`：每条预设派生 `kind:'preset'`、`presetId=id`，`commandKey = title.trim().toLowerCase() || id.toLowerCase()`，保持输入顺序
    - 实现 `buildCommandCatalog(presets)`：Builtin 在前，Preset 按原序在后
    - 实现 `filterCommands(catalog, query)`：忽略大小写、子序列匹配 `commandKey` 或 `title`，空 query 返回全量副本，用 `Array.prototype.filter` 保持原序
    - 实现 `clampHighlightIndex(index, length)`：`length===0` => `-1`，否则环绕 `((index % length) + length) % length`
    - 实现 `buildInsertedPresetText(presetContent)`：返回 `presetContent`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 4.3, 5.1, 5.8, 6.1_

  - [x]* 1.2 编写 `isSlashActive` 属性测试（fast-check，`app/web/src/lib/slashCommand.test.ts`，≥100 迭代）
    - **Property 1: 斜杠检测精确性**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 6.2**
    - 注释标签：`// Feature: chat-input-slash-commands, Property 1: 斜杠检测精确性`；以含 ASCII 空白/全角空格/CJK/emoji/换行的 `richChar` 生成器构造任意字符串，断言 `isSlashActive(text)` 为真当且仅当首字符为 `/` 且不含 `\n`/`\r`
    - `fc.assert(fc.property(...), { numRuns: 100 })`

  - [x]* 1.3 编写查询解析往返属性测试（fast-check，`slashCommand.test.ts`，≥100 迭代）
    - **Property 2: 查询解析往返一致性**
    - **Validates: Requirements 1.5, 1.6, 1.7, 6.3**
    - 对任意不含换行字符串 `q` 断言 `parseSlashQuery(buildSlashText(q)) === q`；对任意激活态文本 `text` 断言 `buildSlashText(parseSlashQuery(text)) === text`
    - `{ numRuns: 100 }`

  - [x]* 1.4 编写过滤保序子集属性测试（fast-check，`slashCommand.test.ts`，≥100 迭代）
    - **Property 3: 过滤为保序子集**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.5, 3.7, 6.4**
    - 以随机 `presets` 经 `buildCommandCatalog` 生成 `catalog`、任意 `query`，断言结果每项来自 `catalog`、相对顺序一致、长度 ≤ catalog（空 query 时等于全量），间接覆盖目录长度=builtin+N 与 preset 保序
    - `{ numRuns: 100 }`

  - [x]* 1.5 编写过滤幂等属性测试（fast-check，`slashCommand.test.ts`，≥100 迭代）
    - **Property 4: 过滤幂等性**
    - **Validates: Requirements 3.4, 6.5**
    - 断言 `filterCommands(filterCommands(catalog, query), query)` 与 `filterCommands(catalog, query)` 相等
    - `{ numRuns: 100 }`

  - [x]* 1.6 编写高亮下标有界属性测试（fast-check，`slashCommand.test.ts`，≥100 迭代）
    - **Property 5: 高亮下标有界**
    - **Validates: Requirements 4.3, 4.4, 4.5, 6.6**
    - 对任意整数 `index`（含越界与负数，覆盖 ArrowUp/Down 回绕）与任意非负 `length`，断言 `length>0` 时结果落在 `[0, length-1]`、`length===0` 时返回 `-1`
    - `{ numRuns: 100 }`

  - [x]* 1.7 编写 PBT 不适用场景的单元/示例测试（Vitest，`slashCommand.test.ts`）
    - 内置命令固定为 `clear`/`retry`/`presets` 三条且顺序稳定（Req 2.1）
    - 标题去空白为空的预设仍以 `id` 派生 `commandKey` 并出现在目录中（Req 2.6）
    - `buildInsertedPresetText` 返回传入的 content（Req 5.1）
    - 无匹配 query 时 `filterCommands` 返回空列表（Req 3.6 具体例）
    - _Requirements: 2.1, 2.6, 5.1, 3.6_

- [x] 2. 检查点（纯逻辑层）— 确保类型检查与测试通过
  - 在 `app/web` 下运行 `tsc --noEmit` 与 `vitest --run`（含属性测试 ≥100 迭代）。Ensure all tests pass, ask the user if questions arise.

- [x] 3. 展示组件 `app/web/src/components/SlashCommandMenu.tsx`
  - [x] 3.1 实现无状态受控菜单组件
    - 新建 `SlashCommandMenu.tsx`，`import type { CommandItem } from '@/lib/slashCommand'`
    - Props：`{ items: CommandItem[]; highlightIndex: number; onSelect: (item: CommandItem) => void; onHover: (index: number) => void }`
    - 渲染过滤后的命令列表（绝对定位浮层，置于 Input_Field 之上），对 `highlightIndex` 所指项加视觉强调（复用既有 `--primary` / `--surface-hover` 设计变量）
    - 点击条目调用 `onSelect`，悬停调用 `onHover`；`items.length === 0` 时返回 `null`（防御），不直接读写 store
    - _Requirements: 4.1, 4.2, 4.7_

- [x] 4. `app/web/src/components/ChatPage.tsx` 集成
  - [x] 4.1 在 ChatPage 接入斜杠命令逻辑与菜单
    - 引入纯函数与 `SlashCommandMenu`；新增本地态 `const [slashHighlight, setSlashHighlight] = useState(0)`，不新增 store 字段
    - 渲染期派生：`slashActive = isSlashActive(inputText)`、`slashQuery = parseSlashQuery(inputText)`、`catalog = useMemo(() => buildCommandCatalog(presets), [presets])`、`filtered = slashActive ? filterCommands(catalog, slashQuery ?? '') : []`、`menuVisible = slashActive && filtered.length > 0`、`highlight = clampHighlightIndex(slashHighlight, filtered.length)`
    - 改造 textarea `onKeyDown`：`menuVisible` 时拦截 `ArrowDown`/`ArrowUp`（经 `clampHighlightIndex` 回绕更新高亮）、`Enter`（`preventDefault` + `selectCommand(filtered[highlight])`，不发送）、`Escape`（关闭菜单并保留文本）；否则走既有 `Enter` 无 Shift 发送 / `Shift+Enter` 换行逻辑
    - 实现 `selectCommand(item)`：preset 时由 `presetId` 查 `presets`，`buildInsertedPresetText(preset.content)` 后若码点数 > `INPUT_MAX_LENGTH` 则 `addToast({ type:'warning' })` 保持原文，否则 `setInputText(text)`；builtin 时按 `commandKey` 分发 `clear`(`setInputText('')`)、`retry`(`regenerateLast()` 返回 `null` 不生成)、`presets`(`setPage('presets')`)；末尾统一关闭菜单并 `setSlashHighlight(0)`
    - 实现 `closeSlashMenu()`（Escape/选中后隐藏菜单且不改文本）；在 textarea 上方按 `menuVisible` 条件渲染 `SlashCommandMenu`，传入 `filtered` / `highlight` / `onSelect=selectCommand` / `onHover=setSlashHighlight`
    - 复用既有 `INPUT_MAX_LENGTH`（`@/lib/promptPreset`）、`useToastStore` 的 `addToast`，未激活斜杠模式时输入/发送/换行行为逐字节不变
    - _Requirements: 4.1, 4.2, 4.4, 4.5, 4.6, 4.7, 4.8, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 7.1, 7.2, 7.3_

  - [x]* 4.2 编写菜单展示与交互的组件/集成测试（Vitest + React Testing Library，`SlashCommandMenu.test.tsx` 与 `ChatPage.test.tsx`）
    - 菜单可见性：激活且 filtered 非空展示并高亮（4.1）；filtered 为空不渲染（4.2）
    - 键盘导航：ArrowDown/ArrowUp 移动高亮并越界回绕（4.4/4.5）
    - 选中：Enter 选中高亮项且不发送（断言未调用 `handleSend`，4.6）；鼠标点击选中（4.7）；Escape 关闭且 `inputText` 不变（4.8）
    - 内置命令分发（mock `setInputText`/`regenerateLast`/`setPage`/`addToast`）：`clear` 清空关闭（5.4）、`retry` 有/无 Last_Assistant_Message 分支（5.5/5.6）、`presets` 切页（5.7）、选中后关闭菜单（5.2）
    - 预设插入：选中 Preset_Command 写入 content（5.1）；插入文本超 `INPUT_MAX_LENGTH` 保持原文并 toast（5.3）
    - _Requirements: 4.1, 4.2, 4.4, 4.5, 4.6, 4.7, 4.8, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

- [x] 5. 无回归保障
  - [x]* 5.1 运行既有功能无回归测试套件
    - 复用既有对话发送/流式输出/停止/会话持久化、提示词预设管理、语音输入/朗读、角色与模型管理测试，确保全绿；未激活斜杠模式时 Enter 发送 / Shift+Enter 换行的既有测试保持通过
    - 后端契约与 `Chat_Store` 公共签名不变，由 TypeScript 编译期保证
    - _Requirements: 7.4, 7.5, 7.6, 7.7_

- [x] 6. 最终检查点 — 前端整体验证
  - 在 `app/web` 下运行 `tsc --noEmit`、`vitest --run`（含属性测试 ≥100 迭代）、`vite build` 全部通过。Ensure all tests pass, ask the user if questions arise.

## Notes

- 标记 `*` 的子任务为可选（属性测试 / 单元 / 集成 / 组件 / 回归测试），可为更快 MVP 跳过；顶层任务与检查点不带 `*`。
- 每个任务标注对应 Requirements 子条款以保证可追溯。
- 5 条属性测试任务（1.2–1.6）一一对应设计的 Property 1–5，均标注 Validates 与 ≥100 迭代要求，统一用 fast-check 并沿用 `lib/promptPreset.test.ts` 的 `richChar` 生成器约定。
- 依赖顺序保证任意时刻 `app/web` 均可编译：纯函数先行，展示组件次之，`ChatPage` 集成后置，测试随后。
- 本特性为纯前端、纯增量增强：无后端/Rust 任务，不改 `POST /api/chat` 等后端接口契约，不改 `Chat_Store` 既有对外契约（`inputText`/`setInputText`/`presets` 及既有消息动作）。
- 长时进程（`vite dev` / `vitest --watch`）请勿在自动化中启动；测试统一用 `vitest --run` 单次执行。

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "3.1"] },
    { "id": 2, "tasks": ["1.3", "4.1"] },
    { "id": 3, "tasks": ["1.4"] },
    { "id": 4, "tasks": ["1.5"] },
    { "id": 5, "tasks": ["1.6"] },
    { "id": 6, "tasks": ["1.7", "4.2"] },
    { "id": 7, "tasks": ["5.1"] }
  ]
}
```
