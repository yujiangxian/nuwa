# Implementation Plan: 角色/人设管理 (character-persona-management)

## Overview

按「纯逻辑层 → 持久化数据层 → 状态层 → UI 层 → 集成挂载与构建验证」的依赖顺序实现，保证任意一个任务完成后 `app/web` 仍可 `npx tsc --noEmit` 通过。

实现语言：**TypeScript**（沿用 `app/web` 的 React 19 + Vite 技术栈；设计文档使用 TypeScript，非伪代码）。

编译安全策略（参照 chat-session-persistence）：
- 纯函数层（`lib/character.ts`）与数据层（`lib/characterDb.ts`）仅依赖 `uiStore.ts` 已导出的 `Character` 类型，可独立先行实现，不破坏现有编译。
- `uiStore.ts` 改造时，先把 `characters: defaultCharacters` 初值改为 `characters: []` 并新增 `charactersLoading` / `charactersPersistent` 状态与 `loadCharacters` / `createCharacter` / `updateCharacter` / `deleteCharacter` actions；**临时保留** 现有 `setCurrentCharacter` 与导出的 `defaultCharacters` 常量，避免 `ChatPage.tsx` / `App.tsx` 在迁移前编译失败。
- `Character` 与 `CharacterInput` 类型在改造后仍由 `uiStore.ts` 导出，保证 `lib/character.ts`、`lib/characterDb.ts` 持续编译。
- UI 集成（CharactersPage / HomePage / ChatPage / App）在状态层就绪后接入，挂载 `loadCharacters()` 放在最后，确保中间任意时刻可编译。

测试约定：
- 属性测试使用 **fast-check 3**（已装，不自行实现 PBT），每个属性独立一个测试、`{ numRuns: 100 }`（最少 100 次迭代），并以注释标注 `// Feature: character-persona-management, Property {n}: {property_text}`。
- 数据层与 store 往返/种子/不变式测试使用 **fake-indexeddb**（已装），通过 `createCharacterDb(fakeIndexedDB)` 或 `setCharacterDbForTesting(db)` 注入，每个用例独立数据库名并在 `afterEach` 清理。
- 带 `*` 的子任务为可选测试任务（可跳过以加速 MVP），但仍纳入依赖图。

## Tasks

- [x] 1. 纯逻辑层 `lib/character.ts`
  - [x] 1.1 实现 `app/web/src/lib/character.ts` 纯函数与常量
    - 导出常量 `NAME_MAX_LENGTH = 20`
    - 导出接口 `NameValidation { ok: boolean; value: string }`
    - 实现 `validateName(raw: string): NameValidation`：trim 后非空返回 `{ ok: true, value: trimmed }`，否则 `{ ok: false, value: '' }`
    - 实现 `generateCharacterId(existing: Character[]): string`：基于时间戳 + 随机后缀，与 `existing` 的 `id` 去重，冲突则重试，保证返回值不在集合内
    - 实现 `needsSeeding(stored: Character[]): boolean`：当且仅当 `stored` 为空返回 `true`
    - 实现 `pickNextCurrentId(chars: Character[], removedId: string, currentId: string): string | null`：currentId 非被删者且仍存在则保持；被删者即 currentId 则返回剩余集合首个 id；剩余为空返回 `null`
    - 从 `@/store/uiStore` 复用 `Character` 类型
    - _Requirements: 2.1, 4.2, 4.6, 5.3, 6.5_

  - [x]* 1.2 为 `needsSeeding` 编写属性测试 `app/web/src/lib/character.test.ts`
    - **Property 3: 种子判定函数**
    - **Validates: Requirements 2.1**
    - 生成任意角色集合 `stored`；断言 `needsSeeding(stored)` 当且仅当 `stored.length === 0` 时为 `true`

  - [x]* 1.3 为 `validateName` 编写属性测试（追加到 `app/web/src/lib/character.test.ts`）
    - **Property 4: 名称 trim 校验语义**
    - **Validates: Requirements 4.6, 5.3**
    - 生成含纯空白 / 多字节 / 首尾空白 / 普通文本的字符串 `raw`；断言 `raw.trim()` 非空时返回 `{ ok: true, value: raw.trim() }`，否则 `ok === false`

  - [x]* 1.4 为 `generateCharacterId` 编写属性测试（追加到 `app/web/src/lib/character.test.ts`）
    - **Property 5: 新建角色分配集内唯一 id**
    - **Validates: Requirements 4.2**
    - 生成任意角色集合 `existing`；断言 `generateCharacterId(existing)` 返回的 id 不等于 `existing` 中任何角色的 `id`

  - [x]* 1.5 为 `pickNextCurrentId` 编写属性测试（追加到 `app/web/src/lib/character.test.ts`）
    - **Property 8: 删除后当前角色重选**
    - **Validates: Requirements 6.5**
    - 生成 ≥ 2 条角色集合、currentId 与 removedId；断言返回值存在于删除后剩余集合中；`removedId !== currentId` 时返回值等于 `currentId`，`removedId === currentId` 时返回剩余集合中的某条角色 id

- [x] 2. 持久化数据层 Character_DB
  - [x] 2.1 实现 `app/web/src/lib/characterDb.ts`
    - 导出 `interface CharacterDb`：`init()`、`getAllCharacters(): Promise<Character[]>`、`saveCharacter(character): Promise<void>`、`deleteCharacter(characterId): Promise<void>`，全部异步、失败 reject
    - 实现 `createCharacterDb(factory?: IDBFactory): CharacterDb`，`getFactory()` 返回 `factory ?? globalThis.indexedDB`；构造时不抛错
    - IndexedDB 结构：库名 `nuwa-character` 版本 `1`；object store `characters`（keyPath `id`，无额外索引）
    - 复用 `requestToPromise` / `txDone` 风格辅助；`saveCharacter`（put，幂等）/ `deleteCharacter` 使用 `readwrite` 事务并以 `txDone(tx)` 等待完成
    - `init()` 在 `globalThis.indexedDB` 缺失或 `open` 失败时 reject
    - 从 `@/store/uiStore` 复用 `Character` 类型
    - _Requirements: 1.1, 1.5_

  - [x]* 2.2 为 Character_DB 编写 schema 与接口存在性单元测试 `app/web/src/lib/characterDb.test.ts`
    - 使用 `fake-indexeddb` 注入；断言 `init()` 后 `characters` store 存在，且 `getAllCharacters` / `saveCharacter` / `deleteCharacter` 方法齐全
    - _Requirements: 1.1, 1.5_

  - [x]* 2.3 为角色往返编写属性测试（追加到 `app/web/src/lib/characterDb.test.ts`）
    - **Property 1: 角色持久化往返**
    - **Validates: Requirements 1.2, 1.3, 1.4, 4.4, 5.2**
    - 使用 `fake-indexeddb`；生成角色集合依次 `saveCharacter` 后 `getAllCharacters` 按 `id` 等价（`id`/`name`/`avatar`/`systemPrompt`/`voiceId`/`description` 六字段一致、不丢不增）；对同一 `id` 再次 `saveCharacter`（编辑后）读取得到最新值

  - [x]* 2.4 为删除编写数据层属性测试（追加到 `app/web/src/lib/characterDb.test.ts`）
    - **Property 7: 删除语义（数据层部分）**
    - **Validates: Requirements 6.2**
    - 使用 `fake-indexeddb`；多角色入库后 `deleteCharacter(id)`，断言 `getAllCharacters` 不再包含该角色、其余角色保持不变

- [x] 3. 检查点 - 确保纯逻辑层与数据层测试通过
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Character_Store 改造
  - [x] 4.1 改造 `app/web/src/store/uiStore.ts` 接入角色持久化
    - 初始状态：`characters: []`、`currentCharacterId: 'assistant'`（加载后由 `pickNextCurrentId` 校正为有效值）、新增 `charactersLoading: true`、`charactersPersistent: true`
    - 保留导出的 `defaultCharacters` 作为 Default_Characters 种子常量；导出可编辑字段类型 `interface CharacterInput { name; systemPrompt; description; avatar; voiceId }`
    - 通过 `createCharacterDb()` 持有 Character_DB 实例；新增 `setCharacterDbForTesting(db)` 注入点（参照 `setChatDbForTesting`）
    - 实现 `loadCharacters()`：`init` → 失败进入 Memory_Fallback_Mode（`charactersPersistent=false`、以 Default_Characters 维护内存、toast「角色无法保存」）；成功则 `getAllCharacters`，`needsSeeding` 为真时以 Default_Characters 初始化并逐条 `saveCharacter` 落库，非空时用持久层恢复且不注入 Default_Characters；读取失败按以 Default_Characters 内存继续；末尾用 `pickNextCurrentId` 校正 `currentCharacterId`；最终 `charactersLoading=false`
    - 实现 `createCharacter(input: CharacterInput)`：`validateName` 通过才创建，`generateCharacterId` 分配唯一 id，记录全部字段（name 取 trim 后值），更新内存后 `saveCharacter` 持久化
    - 实现 `updateCharacter(id, input: CharacterInput)`：`validateName` 通过才更新（id 不变、其余角色不变），更新内存后 `saveCharacter` 持久化
    - 实现 `deleteCharacter(id)`：`characters.length <= 1` 时直接返回并 toast「至少需保留一个角色」（不调 DB）；否则移除该角色、被删者为当前角色时用 `pickNextCurrentId` 重设 `currentCharacterId`、`deleteCharacter` 删除持久记录
    - 降级：任一写操作 reject 时保留内存状态并 toast「保存失败」；遵循「先更新内存、后持久化」
    - 保持 `Character` / `CharacterInput` 类型继续导出；保留 `setCurrentCharacter`
    - _Requirements: 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 4.2, 4.3, 4.4, 5.1, 5.2, 6.2, 6.4, 6.5, 6.6, 6.7, 7.2, 7.4, 9.1, 9.2, 9.3, 9.4_

  - [x]* 4.2 为种子初始化幂等编写属性测试 `app/web/src/store/uiStore.character.test.ts`
    - **Property 2: 种子初始化幂等**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4**
    - 使用 `fake-indexeddb` 注入；持久层为空时 `loadCharacters` 后 `characters` 等于 Default_Characters 且默认角色已全部落库；持久层非空时等于持久层内容且不混入 Default_Characters；连续两次 `loadCharacters` 结果集合相等（不重复追加）

  - [x]* 4.3 为新建/编辑字段保真与隔离编写属性测试（追加到 `app/web/src/store/uiStore.character.test.ts`）
    - **Property 6: 新建/编辑字段保真且隔离**
    - **Validates: Requirements 4.3, 5.1**
    - 生成角色集合、目标 id 与合法 `CharacterInput`；`createCharacter` 后新角色字段等于输入（name 为 trim 值）；`updateCharacter(id, input)` 后该角色字段等于输入且 id 不变，其余角色保持不变

  - [x]* 4.4 为空名称创建/编辑编写属性测试（追加到 `app/web/src/store/uiStore.character.test.ts`）
    - **Property 4: 名称 trim 校验语义（store 部分）**
    - **Validates: Requirements 4.6, 5.3**
    - 对任意纯空白 `name`，`createCharacter` 后角色数量不变、`updateCharacter` 后目标角色不变

  - [x]* 4.5 为删除语义与至少保留一个编写属性测试（追加到 `app/web/src/store/uiStore.character.test.ts`）
    - **Property 7: 删除语义与至少保留一个（store 部分）**
    - **Validates: Requirements 6.2, 6.4, 6.6**
    - 集合 ≥ 2 条时 `deleteCharacter(id)` 后 `characters` 不含该角色、长度减一、其余不变；恰 1 条时 `deleteCharacter` 不移除任何角色且不调用 Character_DB 删除

  - [x]* 4.6 为角色状态不变式编写基于模型的属性测试 `app/web/src/store/uiStore.characterInvariant.test.ts`
    - **Property 9: 角色状态不变式（基于模型）**
    - **Validates: Requirements 6.6, 6.7**
    - 用 `fc.commands` 或随机操作序列（create/update/delete/setCurrentCharacter）配纯内存参考模型；执行后断言 `characters` 至少一条且 `currentCharacterId` 指向 `characters` 中存在的某个角色 `id`

  - [x]* 4.7 为错误降级分支编写单元测试 `app/web/src/store/uiStore.character.error.test.ts`
    - 注入会 reject 的 Character_DB stub：`init` 失败 → Memory_Fallback_Mode（`charactersPersistent=false`、以 Default_Characters 内存维护、提示）；读取失败 → 以 Default_Characters 内存继续；写入失败 → 内存状态保留 + 提示
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

- [x] 5. 检查点 - 确保 Character_Store 测试通过
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. UI 层与集成
  - [x] 6.1 实现 `app/web/src/components/CharactersPage.tsx`（路由 `/characters`）
    - 内置 Gradient_Presets 预设渐变常量（6–8 个，复用 `defaultCharacters` 的 avatar 风格）
    - 列表渲染每条 `name`、`description`、`avatar`（渐变小圆）；经 `useVoices()` 的 `voices` 查 `voiceId` 展示绑定音色名（命中显示 `name`，未命中显示「默认音色」占位）
    - 音色加载态：`isLoading` 显示「音色加载中…」；`isError` 显示「音色加载失败」提示但仍渲染角色其余信息
    - 新建/编辑表单：`name`（`<input maxLength={NAME_MAX_LENGTH}>`）、`systemPrompt`（textarea）、`description`；从 Gradient_Presets 网格选 `avatar`；从 `voices` 下拉选 `voiceId`（含「不绑定」空值项）
    - 提交前用 `validateName`，不通过显示「请填写名称」且不创建/更新；通过则调 `createCharacter` / `updateCharacter`，列表即时反映
    - 删除：内联二次确认（确认/取消），确认且非唯一角色时调 `deleteCharacter`，取消不删除；唯一角色时按钮禁用并提示「至少需保留一个角色」
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 4.1, 4.5, 4.6, 4.7, 5.3, 5.4, 6.1, 6.3, 6.4, 7.1, 7.2, 7.4_

  - [x] 6.2 在 `app/web/src/components/HomePage.tsx` 新增角色管理入口
    - `features` 数组新增一项 `{ id: 'characters', title: '角色管理', desc: '创建与管理 AI 人设', icon: Users, ... }`，点击 `setPage('characters')`
    - _Requirements: 8.1, 8.2_

  - [x] 6.3 在 `app/web/src/App.tsx` 接入路由与启动初始化
    - `AppPage` 联合类型新增 `'characters'`；`pathToPage` 增加 `'/characters': 'characters'`；URL 同步 `targetPath` 增加 `currentPage === 'characters' ? '/characters'`；`renderPage` switch 增加 `case 'characters': return <CharactersPage />`
    - 启动 `useEffect` 增加 `void loadCharacters()`（与既有 `loadSessions()` 并列）
    - _Requirements: 1.3, 2.3, 2.4, 8.2_

  - [x] 6.4 改造 `app/web/src/components/ChatPage.tsx` 角色来源与音色名解析
    - 角色选择从持久化 `useUIStore(s => s.characters)` 读取并渲染可选角色列表；选择某角色调 `setCurrentCharacter(id)`
    - 侧栏写死的 `currentVoice` 名称映射改为经 `voices` 查 `currentCharacter.voiceId` 得名（去写死映射），未命中回退占位；保持既有流式输出与 TTS（`resolveVoiceRef`）调用不回归
    - _Requirements: 5.5, 7.3, 8.3, 8.4_

  - [x]* 6.5 为 CharactersPage 编写组件测试 `app/web/src/components/CharactersPage.test.tsx`
    - 覆盖：列表渲染 name/description/avatar 与绑定音色名（Req 3.1, 3.2）、音色加载态与错误态（Req 3.3, 3.4）；表单控件存在与 `name` maxLength（Req 4.1, 4.7）、创建后列表展示（Req 4.5）、空名提示不创建/不更新（Req 4.6, 5.3）、编辑后展示更新（Req 5.4）；删除二次确认（确认/取消）与唯一角色禁删提示（Req 6.1, 6.3, 6.4）；音色下拉来源与空值允许（Req 7.1, 7.2, 7.4）
    - 通过 mock 网络与既有 `src/test/setup.ts` 验证
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 4.1, 4.5, 4.6, 4.7, 5.3, 5.4, 6.1, 6.3, 6.4, 7.1, 7.2, 7.4_

  - [x]* 6.6 为 HomePage 入口与 ChatPage 选用角色补充组件测试
    - HomePage 角色管理入口存在且点击导航至 Character_Manager（Req 8.1, 8.2，追加到既有 HomePage 测试或新建）
    - ChatPage 从持久化 `characters` 渲染可选角色、选择后 `currentCharacterId` 更新、编辑当前角色即时生效、当前音色名经 `voices` 解析（Req 5.5, 8.3, 8.4，追加到 `ChatPage.test.tsx`）
    - _Requirements: 5.5, 8.1, 8.2, 8.3, 8.4_

- [x] 7. 最终检查点与构建验证
  - [x] 7.1 运行类型检查、测试与构建
    - 在 `app/web` 执行 `npx tsc --noEmit` 确认无类型错误
    - 执行 `npm test`（`vitest --run`）确认全部单元/属性/组件测试通过，且既有 `ChatPage` / `VoiceStudioPage` / 会话与语音相关测试无回归
    - 执行 `npm run build`（`tsc && vite build`）确认构建通过
    - 确认未改动后端及 `POST /api/chat` / `GET /api/voices` / `GET /api/models` / `/api/downloads/*` 契约
    - _Requirements: 9.5, 9.6, 9.7, 9.8_

- [x] 8. 检查点 - 确保所有测试与构建通过
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- 带 `*` 的子任务为可选测试任务，可跳过以加速 MVP；核心实现任务不可跳过。
- 每个任务标注对应 Requirements 子句以保证可追溯；每个属性测试显式引用设计文档中的 Property 编号与 Validates 子句。
- 9 条 Correctness Property 与测试任务对应：Property 1 → 2.3、Property 2 → 4.2、Property 3 → 1.2、Property 4 → 1.3 + 4.4、Property 5 → 1.4、Property 6 → 4.3、Property 7 → 2.4 + 4.5、Property 8 → 1.5、Property 9 → 4.6。
- 属性测试用 fast-check（`{ numRuns: 100 }`）；数据层/store 往返与种子幂等用 `fake-indexeddb` 注入。
- 编译安全：纯逻辑层与数据层先行且仅依赖既有导出的 `Character` 类型；`uiStore` 改造时临时保留 `setCurrentCharacter` 与 `defaultCharacters` 导出，UI 集成（含 `loadCharacters()` 挂载）放在状态层就绪后，确保任意时刻 `tsc --noEmit` 通过。
- 检查点用于增量验证；属性测试验证通用正确性，单元/组件测试覆盖 schema、错误降级与 UI 交互。

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4", "1.5", "2.2", "2.3", "2.4", "4.1"] },
    { "id": 2, "tasks": ["4.2", "4.3", "4.4", "4.5", "4.6", "4.7", "6.1", "6.2", "6.3", "6.4"] },
    { "id": 3, "tasks": ["6.5", "6.6"] },
    { "id": 4, "tasks": ["7.1"] }
  ]
}
```
