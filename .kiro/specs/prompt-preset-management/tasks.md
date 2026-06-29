# Implementation Plan: 提示词预设管理 (prompt-preset-management)

## Overview

按「纯逻辑层 → 持久化数据层 → 状态层 → UI 层与集成 → 检查点与构建验证」的依赖顺序实现，保证任意一个任务完成后 `app/web` 仍可 `npx tsc --noEmit` 通过。

实现语言：**TypeScript**（沿用 `app/web` 的 React 19 + Vite 技术栈；设计文档使用 TypeScript，非伪代码）。

编译安全策略（参照 character-persona-management / chat-session-persistence）：
- 先在 `uiStore.ts` 仅新增并导出 `PromptPreset` 类型（type-only，非破坏性），使纯逻辑层 `lib/promptPreset.ts` 与数据层 `lib/promptPresetDb.ts` 可独立先行实现并持续编译。
- 纯逻辑层（`lib/promptPreset.ts`）与数据层（`lib/promptPresetDb.ts`）仅依赖 `uiStore.ts` 已导出的 `PromptPreset` 类型，不触碰现有状态与 actions，不破坏现有编译。
- `uiStore.ts` 状态层改造（新增 `presets` / `presetsLoading` / `presetsPersistent` 状态与 `loadPresets` / `createPreset` / `updatePreset` / `deletePreset` / `insertPresetIntoInput` actions、`setPresetDbForTesting` 注入点）在纯逻辑层与数据层就绪后进行；`PromptPreset` 类型改造后仍由 `uiStore.ts` 导出，保证 `lib/*` 持续编译。
- UI 集成（PromptPresetsPage / HomePage / ChatPage / App）在状态层就绪后接入：先落地自包含的 `PromptPresetsPage.tsx`，再在 `App.tsx` 扩展 `AppPage` 联合类型与路由并挂载 `loadPresets()`，最后接入依赖 `'presets'` 页与新 actions 的 HomePage / ChatPage 入口，确保任意时刻 `tsc --noEmit` 通过。

测试约定：
- 属性测试使用 **fast-check 3**（已装，不自行实现 PBT），每个属性独立一个测试、`{ numRuns: 100 }`（最少 100 次迭代），并以注释标注 `// Feature: prompt-preset-management, Property {n}: {property_text}`。
- 数据层与 store 往返/删除/插入等不变式测试使用 **fake-indexeddb**（已装），通过 `createPresetDb(fakeIndexedDB)` 或 `setPresetDbForTesting(db)` 注入，每个用例独立数据库名并在 `afterEach` 清理。
- 带 `*` 的子任务为可选测试任务（可跳过以加速 MVP），但仍纳入依赖图。

## Tasks

- [x] 1. 纯逻辑层与类型基础
  - [x] 1.1 在 `app/web/src/store/uiStore.ts` 新增并导出 `PromptPreset` 类型
    - 仅新增 `export interface PromptPreset { id: string; title: string; content: string }`（与 `Character` / `ChatSession` / `ChatMessage` 并列导出），不改动任何现有状态、actions 或导出，保持非破坏性
    - 该类型供纯逻辑层、数据层、UI 层共用
    - _Requirements: 1.4_

  - [x] 1.2 实现 `app/web/src/lib/promptPreset.ts` 纯函数与常量
    - 导出常量 `TITLE_MAX_LENGTH = 30`、`CONTENT_MAX_LENGTH = 2000`、`INPUT_MAX_LENGTH = 2000`
    - 导出接口 `PresetValidation { ok: boolean; title: string; content: string }`、`InsertResult { ok: boolean; text: string }`
    - 实现 `validatePreset(rawTitle: string, rawContent: string): PresetValidation`：`title` 与 `content` 各自 trim 后均非空返回 `{ ok: true, title: 去空白值, content: 去空白值 }`，否则 `{ ok: false, ... }`（只判空，长度上限由 UI 层 maxLength 强制）
    - 实现 `generatePresetId(existing: PromptPreset[]): string`：基于时间戳 + 随机后缀，与 `existing` 的 `id` 去重，冲突则重试，保证返回值不在集合内
    - 实现 `buildInsertedText(prev: string, content: string, maxLen = INPUT_MAX_LENGTH): InsertResult`：`prev.trim()` 为空时目标文本为 `content`，否则为 `prev + '\n' + content`；目标文本码点数 ≤ `maxLen` 返回 `{ ok: true, text: 目标文本 }`，否则返回 `{ ok: false, text: prev }`（按码点计算，使用 `Array.from` 避免破坏多字节字符）
    - 从 `@/store/uiStore` 复用 `PromptPreset` 类型
    - _Requirements: 3.2, 6.3, 6.4, 6.5_

  - [x]* 1.3 为 `validatePreset` 编写属性测试 `app/web/src/lib/promptPreset.test.ts`
    - **Property 3: 字段 trim 校验语义**
    - **Validates: Requirements 3.6, 3.7, 4.3, 4.4**
    - 生成含纯空白 / 多字节 / 首尾空白 / 普通文本的随机 `rawTitle` 与 `rawContent`；断言当且仅当二者各自 `trim()` 后均非空时返回 `{ ok: true }` 且 `title`/`content` 为各自 trim 后值，否则 `ok === false`

  - [x]* 1.4 为 `generatePresetId` 编写属性测试（追加到 `app/web/src/lib/promptPreset.test.ts`）
    - **Property 2: 新建预设分配集内唯一 id**
    - **Validates: Requirements 3.2**
    - 生成任意预设集合 `existing`；断言 `generatePresetId(existing)` 返回的 id 不等于 `existing` 中任何预设的 `id`

  - [x]* 1.5 为 `buildInsertedText` 编写属性测试（追加到 `app/web/src/lib/promptPreset.test.ts`）
    - **Property 6: 插入文本构造与长度上限（纯函数部分）**
    - **Validates: Requirements 6.2, 6.3, 6.4, 6.5**
    - 生成随机 `prev`（含空 / 纯空白 / 非空）、随机 `content` 与随机 `maxLen`（含恰好等于、略超上限的边界）；断言目标文本在 `prev.trim()` 为空时等于 `content`、否则等于 `prev + '\n' + content`；目标文本长度 ≤ `maxLen` 时返回 `{ ok: true, text: 目标文本 }`，否则 `{ ok: false, text: prev }`

- [x] 2. 持久化数据层 Preset_DB
  - [x] 2.1 实现 `app/web/src/lib/promptPresetDb.ts`
    - 导出 `interface PresetDb`：`init()`、`getAllPresets(): Promise<PromptPreset[]>`、`savePreset(preset): Promise<void>`、`deletePreset(presetId): Promise<void>`，全部异步、失败 reject
    - 实现 `createPresetDb(factory?: IDBFactory): PresetDb`，`getFactory()` 返回 `factory ?? globalThis.indexedDB`；构造时不抛错
    - IndexedDB 结构：库名 `nuwa-prompt-preset` 版本 `1`；object store `presets`（keyPath `id`，无额外索引）
    - 复用 `characterDb.ts` 同款 `requestToPromise` / `txDone` 风格辅助；`savePreset`（put，幂等）/ `deletePreset` 使用 `readwrite` 事务并以 `txDone(tx)` 等待完成；`getAllPresets` 使用 `readonly` 事务 `getAll()`
    - `init()` 在 `globalThis.indexedDB` 缺失或 `open` 失败时 reject
    - 从 `@/store/uiStore` 复用 `PromptPreset` 类型
    - _Requirements: 1.1, 1.5_

  - [x]* 2.2 为 Preset_DB 编写 schema 与接口存在性单元测试 `app/web/src/lib/promptPresetDb.test.ts`
    - 使用 `fake-indexeddb` 注入；断言 `init()` 后 `presets` store 存在，且 `getAllPresets` / `savePreset` / `deletePreset` 方法齐全
    - _Requirements: 1.1, 1.5_

  - [x]* 2.3 为预设往返编写属性测试（追加到 `app/web/src/lib/promptPresetDb.test.ts`）
    - **Property 1: 预设持久化往返**
    - **Validates: Requirements 1.2, 1.3, 1.4, 3.4, 4.2**
    - 使用 `fake-indexeddb`；生成预设集合依次 `savePreset` 后 `getAllPresets` 按 `id` 等价（`id`/`title`/`content` 三字段逐一相等、不丢不增）；对同一 `id` 再次 `savePreset`（编辑后）读取得到最新值；`deletePreset` 后该 `id` 不再被 `getAllPresets` 返回

- [x] 3. 检查点 - 确保纯逻辑层与数据层测试通过
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Preset_Store 改造
  - [x] 4.1 改造 `app/web/src/store/uiStore.ts` 接入预设持久化
    - 新增状态：`presets: []`、`presetsLoading: true`、`presetsPersistent: true`
    - 通过 `createPresetDb()` 持有 Preset_DB 实例；新增 `setPresetDbForTesting(db)` 注入点（参照 `setCharacterDbForTesting`）
    - 实现 `loadPresets()`：`init` → 失败进入 Memory_Fallback_Mode（`presetsPersistent=false`、`presets=[]` 内存维护、toast「预设无法保存」）；成功则 `getAllPresets` 恢复到 `presets`（保持持久层顺序），读取失败按空 `presets` 继续且保持 `presetsPersistent=true`；最终 `presetsLoading=false`
    - 实现 `createPreset(rawTitle, rawContent)`：`validatePreset` 不通过则整体 no-op；通过则用 `generatePresetId(presets)` 分配集内唯一 id、记录 trim 后的 `title`/`content`、追加到 `presets` 末尾（稳定顺序），先更新内存后 `savePreset` 持久化
    - 实现 `updatePreset(id, rawTitle, rawContent)`：`validatePreset` 不通过则整体 no-op；通过则只改目标预设的 `title`/`content` 为 trim 后值、保持 `id` 不变、其余预设不变，先更新内存后 `savePreset` 持久化
    - 实现 `deletePreset(id)`：从 `presets` 移除该项，受持久化守卫调用 `Preset_DB.deletePreset(id)`（确认在 UI 层完成）
    - 实现 `insertPresetIntoInput(id): boolean`：从 `presets` 查 `id`（未命中 no-op 返回 `false`）；调用 `buildInsertedText(inputText, preset.content, INPUT_MAX_LENGTH)`；`ok` 为真时 `setInputText(result.text)` 返回 `true`，`ok` 为假时不修改 `inputText`、toast「内容超出长度上限，无法插入」返回 `false`；任一分支均不修改 `presets`
    - 降级：任一写操作 reject 时保留内存中的 `presets` 状态并 toast「保存失败」；遵循「先更新内存、后持久化」，持久化守卫为 `presetsPersistent`，复用 `toastSaveFailed()`
    - 保持 `PromptPreset` 类型继续导出
    - _Requirements: 1.2, 1.3, 2.3, 3.2, 3.3, 3.4, 4.1, 4.2, 5.2, 6.2, 6.3, 6.4, 6.5, 6.7, 8.1, 8.2, 8.3, 8.4_

  - [x]* 4.2 为新建/编辑字段保真与隔离编写属性测试 `app/web/src/store/uiStore.preset.test.ts`
    - **Property 4: 新建/编辑字段保真且隔离**
    - **Validates: Requirements 3.3, 4.1**
    - 使用 `fake-indexeddb` 注入；生成预设集合、目标 `id` 与任意使校验通过的原始 `title`/`content`；`createPreset` 后新预设的 `title`/`content` 等于输入的 trim 后值；`updatePreset(id, title, content)` 后该预设字段等于输入 trim 后值且 `id` 不变、其余预设保持不变

  - [x]* 4.3 为删除语义编写属性测试（追加到 `app/web/src/store/uiStore.preset.test.ts`）
    - **Property 5: 删除语义**
    - **Validates: Requirements 5.2**
    - 使用 `fake-indexeddb` 注入；生成预设集合与任一 `id`，`deletePreset(id)` 后 `presets` 不再包含该预设、其余预设保持不变，且其持久化记录被删除（持久模式下 `getAllPresets` 不再返回该 `id`）

  - [x]* 4.4 为插入只读预设编写属性测试（追加到 `app/web/src/store/uiStore.preset.test.ts`）
    - **Property 7: 插入不修改预设集合**
    - **Validates: Requirements 6.7**
    - 生成预设集合与任一 `id`（无论结果长度是否超过 Input_Max_Length）；断言 `insertPresetIntoInput(id)` 执行前后 `presets` 保持不变（不增、不删、不改），并据 `buildInsertedText` 结果验证 `ok` 为真时 `inputText` 写为目标文本、为假时 `inputText` 不变

  - [x]* 4.5 为错误降级分支编写单元测试 `app/web/src/store/uiStore.preset.error.test.ts`
    - 注入会 reject 的 Preset_DB stub：`init` 失败 → Memory_Fallback_Mode（`presetsPersistent=false`、`presets=[]` 内存维护、toast「预设无法保存」）；读取失败 → 以空 `presets` 继续运行（保持 `presetsPersistent=true`）；写入失败（`savePreset` / `deletePreset` reject）→ 内存中的 `presets` 状态保留 + toast「保存失败」
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

- [x] 5. 检查点 - 确保 Preset_Store 测试通过
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. UI 层与集成
  - [x] 6.1 实现 `app/web/src/components/PromptPresetsPage.tsx`（路由 `/presets`）
    - 列表：按 `presets` 顺序渲染每条的 `title` 与 `content`；`presets` 为空时展示空状态提示「还没有预设，点击新建一条」
    - 新建/编辑表单：`title` 用 `<input maxLength={TITLE_MAX_LENGTH}>`，`content` 用 `<textarea maxLength={CONTENT_MAX_LENGTH}>`；编辑时预填目标预设字段
    - 提交校验：提交前用 `validatePreset`，任一字段 trim 后为空时分别展示「请填写标题」/「请填写内容」并禁用提交；通过则调用 `createPreset` / `updatePreset`，列表即时反映
    - 删除：内联二次确认（确认 / 取消），确认调 `deletePreset` 并从列表移除，取消则不删除、不调 Preset_DB
    - 降级提示：`presetsPersistent === false` 时在页面顶部显示非阻断提示条「预设无法保存」
    - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.5, 3.6, 3.7, 3.8, 3.9, 4.3, 4.4, 4.5, 5.1, 5.3, 5.4, 8.2_

  - [x] 6.2 在 `app/web/src/App.tsx` 接入路由与启动初始化
    - `AppPage` 联合类型新增 `'presets'`；`pathToPage` 增加 `'/presets': 'presets'`；URL 同步 `targetPath` 增加 `currentPage === 'presets' ? '/presets'`；`renderPage` switch 增加 `case 'presets': return <PromptPresetsPage />`（导入 6.1 的组件）
    - 启动 `useEffect` 增加 `void loadPresets()`（与既有 `loadSessions()` / `loadCharacters()` 并列）
    - _Requirements: 1.3, 7.2_

  - [x] 6.3 在 `app/web/src/components/HomePage.tsx` 新增提示词入口
    - `features` 数组新增一项 `{ id: 'presets', title: '提示词', desc: '管理与复用常用提示词', icon: ..., ... }`，点击 `setPage('presets')`
    - _Requirements: 7.1, 7.2_

  - [x] 6.4 改造 `app/web/src/components/ChatPage.tsx` 新增插入入口与管理入口
    - 在 Input_Field 旁新增 Preset_Insert_Entry（如「提示词」按钮 + 下拉/弹层列出 `presets`），选择某条调用 `insertPresetIntoInput(preset.id)`；返回 `true` 时对 Input_Field（`textarea`）调用 `.focus()`；返回 `false` 时不聚焦（store 已 toast 超长提示）
    - 新增进入 Preset_Manager 的入口（`setPage('presets')`）
    - Input_Field 既有 `maxLength={2000}` 与 `inputText`/`setInputText` 接线保持不变，插入仅通过 `insertPresetIntoInput` 写 `inputText`；保持既有流式输出与 TTS 调用不回归
    - _Requirements: 6.1, 6.2, 6.6, 7.3, 7.4_

  - [x]* 6.5 为 PromptPresetsPage 编写组件测试 `app/web/src/components/PromptPresetsPage.test.tsx`
    - 覆盖：列表渲染 title/content 与顺序（Req 2.1, 2.3）、空状态（Req 2.2）；表单控件存在与 `title`/`content` 的 maxLength（Req 3.1, 3.8, 3.9）、创建后列表展示（Req 3.5）、空字段禁用提交与提示（Req 3.6, 3.7, 4.3, 4.4）、编辑后展示更新（Req 4.5）；删除二次确认（确认 / 取消）与列表移除（Req 5.1, 5.3, 5.4）；降级提示（Req 8.2）
    - 通过 mock 网络与既有 `src/test/setup.ts` 验证
    - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.5, 3.6, 3.7, 3.8, 3.9, 4.3, 4.4, 4.5, 5.1, 5.3, 5.4, 8.2_

  - [x]* 6.6 为 HomePage 入口与 ChatPage 插入补充组件测试
    - HomePage 提示词入口存在且点击导航至 Preset_Manager（Req 7.1, 7.2，追加到既有 HomePage 测试或新建）
    - ChatPage Preset_Insert_Entry 存在与选择插入（Req 6.1, 6.2）、成功插入后 Input_Field 聚焦（Req 6.6）、进入管理页入口与导航（Req 7.3, 7.4），并验证既有流式输出 / TTS 无回归（追加到 `ChatPage.test.tsx`）
    - _Requirements: 6.1, 6.2, 6.6, 7.1, 7.2, 7.3, 7.4_

- [x] 7. 最终检查点与构建验证
  - [x] 7.1 运行类型检查、测试与构建
    - 在 `app/web` 执行 `npx tsc --noEmit` 确认无类型错误
    - 执行 `npm test`（`vitest --run`）确认全部单元/属性/组件测试通过，且既有 `ChatPage` / `CharactersPage` / 会话 / 语音 / 角色相关测试无回归
    - 执行 `npm run build`（`tsc && vite build`）确认构建通过
    - 确认未改动后端及 `POST /api/chat` / `GET /api/voices` / `GET /api/models` / `/api/downloads/*` 契约
    - _Requirements: 8.5, 8.6, 8.7, 8.8_

- [x] 8. 检查点 - 确保所有测试与构建通过
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- 带 `*` 的子任务为可选测试任务，可跳过以加速 MVP；核心实现任务不可跳过。
- 每个任务标注对应 Requirements 子句以保证可追溯；每个属性测试显式引用设计文档中的 Property 编号与 Validates 子句。
- 7 条 Correctness Property 与测试任务对应：Property 1 → 2.3、Property 2 → 1.4、Property 3 → 1.3、Property 4 → 4.2、Property 5 → 4.3、Property 6 → 1.5、Property 7 → 4.4。
- 属性测试用 fast-check（`{ numRuns: 100 }`）；数据层往返与 store 删除/字段保真等不变式用 `fake-indexeddb` 注入。
- 编译安全：先在 `uiStore.ts` 仅新增导出 `PromptPreset` 类型（非破坏），纯逻辑层与数据层先行且仅依赖该类型；状态层改造后再接入 UI（`PromptPresetsPage` → `App` 路由与 `loadPresets()` 挂载 → HomePage / ChatPage 入口），确保任意时刻 `tsc --noEmit` 通过。
- 检查点用于增量验证；属性测试验证通用正确性，单元/组件测试覆盖 schema、错误降级与 UI 交互；IndexedDB schema、UI 渲染交互、入口导航、错误降级分支与无回归约束以 schema / 示例 / 组件测试覆盖。

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1"] },
    { "id": 2, "tasks": ["1.3", "2.2", "4.1"] },
    { "id": 3, "tasks": ["1.4", "2.3", "4.2", "6.1"] },
    { "id": 4, "tasks": ["1.5", "4.3", "6.2"] },
    { "id": 5, "tasks": ["4.4", "4.5", "6.3", "6.4"] },
    { "id": 6, "tasks": ["6.5", "6.6"] },
    { "id": 7, "tasks": ["7.1"] }
  ]
}
```
