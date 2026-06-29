# Implementation Plan: conversation-export-import

## Overview

按设计的「纯逻辑 / 状态 / UI」三层顺序增量实现，保证任意时刻 `tsc --noEmit` 通过：

1. 先建 Export_Module 纯逻辑层（`conversationExport.ts`），它对 DOM / Chat_Store / IndexedDB 零依赖，可被 fast-check 直接驱动。
2. 再在 Chat_Store（`uiStore.ts`）新增 `importSessions` action，复用既有 id 生成、Chat_DB 写入与 Memory_Fallback_Mode 降级语义。
3. 最后在 `ChatPage.tsx` 会话侧边栏接线导出 / 导入 UI 入口，复用 File_Download。

14 条 Correctness Property 各对应一个 fast-check 属性测试子任务（标 `*`），每条 ≥100 次迭代，并加注释标签 `// Feature: conversation-export-import, Property N: ...`。Export_Module 属性（P1–P8）为纯函数测试；Chat_Store 属性（P9–P14）经 `setChatDbForTesting` 注入 fake-indexeddb 包装的 `FakeChatDb`（`createFakeChatDb`）驱动。

## Tasks

- [x] 1. 实现 Export_Module 纯逻辑层（`app/web/src/lib/conversationExport.ts`）
  - [x] 1.1 定义导出/导入类型并实现 `buildExportBundle`
    - 新建 `app/web/src/lib/conversationExport.ts`，定义并导出 `FORMAT_VERSION = '1'`、`SUPPORTED_VERSIONS`、`ExportedSession`、`ExportBundle`、`ImportErrorKind`、`ImportError`、`ParseResult` 等类型
    - 实现纯函数 `buildExportBundle(sessions, exportedAt)`：顶层写入 `formatVersion = FORMAT_VERSION`、注入的 `exportedAt`、`sessions` 数组；每个 `ExportedSession` 保留 `title`/`characterId`/`voiceId`/`updatedAt` 与消息的 `role`/`content`（可选字段 `audioUrl`/`voiceName`/`duration` 透传），会话与消息顺序原样保留
    - 不读取时钟/随机源，`exportedAt` 由参数注入以保证可测
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 8.3_

  - [x] 1.2 实现 `toMarkdown` 确定性序列化
    - 在 `conversationExport.ts` 实现纯函数 `toMarkdown(sessions, characterNameOf)`：每个会话以 `title` 为标题段，按数组（追加）顺序排版消息；user 显示名固定为「我」，assistant 显示名取 `characterNameOf(characterId)`，未命中（`undefined`）回退「助手」
    - 固定行分隔与转义规则，不读取时钟/随机源，确保相同输入逐字符确定
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 8.3_

  - [x] 1.3 实现 `parseImportBundle` 解析与校验
    - 在 `conversationExport.ts` 实现纯函数 `parseImportBundle(text)`：依次执行 `JSON.parse`（失败→`{ ok:false, error.kind:'syntax' }`）、结构校验（非对象 / 缺 `formatVersion` / `sessions` 非数组 / 条目缺 `session` 或 `messages` / 字段类型非法→`structure`）、版本校验（`formatVersion ∉ SUPPORTED_VERSIONS`→`version`）
    - 校验顺序固定为 syntax → structure → version；通过后产出规范化 `ExportedSession[]`（session 仅留 `title`/`characterId`/`voiceId`/`updatedAt`，message 仅留 `role`（限 `'user'|'assistant'`）/`content` 及合法可选字段，顺序原样）；失败分支绝不携带任何会话数据
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x]* 1.4 编写往返一致属性测试
    - 新建 `app/web/src/lib/conversationExport.test.ts`，用 fast-check 生成随机 `ExportedSession[]`（含 CJK 与特殊字符）
    - **Property 1: JSON 导出—导入往返一致**（`buildExportBundle`+`JSON.stringify`+`parseImportBundle` → `ok===true`，条目数、`title`/`characterId`/`voiceId` 一致，消息 `role`/`content` 逐条相等且顺序不变）
    - **Validates: Requirements 1.1, 1.2, 1.4, 3.5, 3.6, 5.1, 5.2, 5.3**

  - [x]* 1.5 编写 Export_Bundle 顶层结构属性测试
    - **Property 2: Export_Bundle 顶层结构**（任意会话列表与注入 `exportedAt`，`formatVersion === FORMAT_VERSION`、`exportedAt` 等于注入值、`sessions` 为数组）
    - **Validates: Requirements 1.3**

  - [x]* 1.6 编写 Markdown 内容与顺序属性测试
    - **Property 3: Markdown 包含全部内容且按追加顺序**（输出含每个会话 `title`、每条消息 `content`，content 出现顺序与会话内追加顺序一致，会话间按输入顺序）
    - **Validates: Requirements 2.1, 2.2, 2.4**

  - [x]* 1.7 编写 Markdown 发送方显示名属性测试
    - **Property 4: Markdown 发送方显示名规则**（user→「我」，assistant→`characterNameOf(characterId)`，`undefined`→「助手」）
    - **Validates: Requirements 2.3**

  - [x]* 1.8 编写 Markdown 确定性属性测试
    - **Property 5: Markdown 确定性输出**（固定输入与 `characterNameOf`，连续两次 `toMarkdown` 逐字符相同）
    - **Validates: Requirements 2.5**

  - [x]* 1.9 编写非法 JSON 语法错误属性测试
    - **Property 6: 非法 JSON 返回语法错误且不产出数据**（不可 `JSON.parse` 的字符串 → `{ ok:false, error.kind:'syntax' }`，无会话数据）
    - **Validates: Requirements 3.2**

  - [x]* 1.10 编写结构错误属性测试
    - **Property 7: 结构不符返回结构错误且不产出数据**（合法 JSON 但缺 `formatVersion` / `sessions` 非数组 / 条目缺 `session`、`messages` 或字段类型非法 → `error.kind:'structure'`，无会话数据）
    - **Validates: Requirements 3.3**

  - [x]* 1.11 编写版本错误属性测试
    - **Property 8: 版本不符返回版本错误且不产出数据**（结构合法但 `formatVersion ∉ SUPPORTED_VERSIONS` → `error.kind:'version'`，无会话数据）
    - **Validates: Requirements 3.4**

  - [x]* 1.12 编写 Export_Module 边界单元测试
    - 在 `conversationExport.test.ts` 覆盖：空会话列表、空消息会话、含可选字段（`audioUrl`/`voiceName`/`duration`）消息往返保留、`role` 非法值归为 structure 错误
    - _Requirements: 1.4, 3.3, 3.5, 5.1_

- [x] 2. 实现 Chat_Store `importSessions` action（`app/web/src/store/uiStore.ts`）
  - [x] 2.1 在 UIState 新增并实现 `importSessions(text)`
    - 在 `uiStore.ts` 的 `UIState` 接口与 store 中新增 `importSessions: (text: string) => Promise<ImportError | null>`，内部先调用 `parseImportBundle(text)`
    - 失败：不调用 `set(...)`，保持 `sessions`/`messages`/`currentSessionId` 与持久层不变，按 `error.kind` 展示对应错误 toast（语法/结构/版本），返回该 `ImportError`
    - 成功：为每个 `ExportedSession` 分配库内唯一新 id（复用 `createSession` 的 `Date.now()+随机后缀` + 「已占用 id 集合」去重重试，库内与批内均不冲突）；`updatedAt` 缺失时回退 `new Date().toISOString()`；消息按原序追加并各分配会话内唯一 id；保留全部现有会话与消息；持久模式（`isPersistent===true`）经 `chatDb.saveSession`/`saveMessage` 持久化（`try/catch + toastSaveFailed()`），降级模式跳过 DB 仅内存维护；用 `pickLatestSession` 将 `currentSessionId` 切到导入会话中 `updatedAt` 最新者并加载其消息；展示含数量的成功 toast；返回 null
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 6.1, 6.2, 6.3, 6.4, 6.5, 8.1, 8.2_

  - [x]* 2.2 编写会话 id 唯一性属性测试
    - 新建 `app/web/src/store/uiStore.import.test.ts`，用 fast-check 生成随机现有 sessions 与导入批，经 `setChatDbForTesting(createFakeChatDb())` 注入数据层
    - **Property 9: 导入后会话 id 库内唯一且数量正确**（成功导入后 `sessions` 所有 id 互不相同，数量 = 原数量 + 导入条目数）
    - **Validates: Requirements 4.2, 4.3**

  - [x]* 2.3 编写消息保序与会话内 id 唯一属性测试
    - **Property 10: 导入消息保序且会话内 id 唯一**（每个新建会话消息 `role`/`content` 与条目逐条相等、顺序不变，会话内消息 id 互不相同）
    - **Validates: Requirements 4.4**

  - [x]* 2.4 编写保留现有数据属性测试
    - **Property 11: 成功导入保留全部现有数据**（成功导入后全部现有会话与消息不被修改或删除，仅新增）
    - **Validates: Requirements 4.5**

  - [x]* 2.5 编写切换最新会话属性测试
    - **Property 12: 导入后切换到最新会话**（非空导入批成功后 `currentSessionId` = 批内 `updatedAt` 最新者，`messages` 为该会话消息序列）
    - **Validates: Requirements 4.7**

  - [x]* 2.6 编写非法导入不改数据属性测试
    - **Property 13: 非法导入不修改现有数据**（任意触发三类 Import_Error 的文本，`importSessions` 返回该错误，`sessions`/`messages`/`currentSessionId` 与持久层全部不变）
    - **Validates: Requirements 6.1**

  - [x]* 2.7 编写降级模式仅内存属性测试
    - **Property 14: 降级模式导入仅维护内存**（`isPersistent===false` 成功导入后，`FakeChatDb` 的 `saveSession`/`saveMessage` 计数为 0，而内存 `sessions`/`messages` 已据导入更新）
    - **Validates: Requirements 8.1**

  - [x]* 2.8 编写 `importSessions` 边界单元测试
    - 在 `uiStore.import.test.ts` 覆盖：`updatedAt` 缺失回退当前时间（4.1）；持久模式写入失败保留内存 + 「保存失败」toast（8.2）；成功导入发含数量成功 toast（6.5）；三类错误各自 toast 文案（6.2–6.4）
    - _Requirements: 4.1, 6.2, 6.3, 6.4, 6.5, 8.2_

- [x] 3. Checkpoint — 确保纯逻辑层与状态层测试通过
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. 接线 Session_Sidebar 导出与导入 UI（`app/web/src/components/ChatPage.tsx`）
  - [x] 4.1 实现导出入口与 File_Download
    - 在 `ChatPage.tsx` 新增 `downloadText(filename, text, mime)`（Blob + 锚点 + `URL.revokeObjectURL`）
    - 在 Session_Sidebar 新增「导出当前会话」（JSON / Markdown）与「导出全部」（JSON / Markdown）入口：JSON 调 `buildExportBundle(...)`+`JSON.stringify`，文件名 `.json`；Markdown 调 `toMarkdown(..., characterNameOf)`，文件名 `.md`；导出全部时持久模式经 Chat_DB 取全量会话与消息、降级模式用内存会话；`sessions.length === 0` 时禁用导出入口
    - _Requirements: 1.5, 2.6, 7.1, 7.2, 7.5_

  - [x] 4.2 实现导入入口与文件读取接线
    - 在 Session_Sidebar 新增「导入」按钮触发隐藏 `<input type="file" accept=".json">`；`onChange` 中 `await file.text()` 后调用 `importSessions(text)`，读取后重置 input value 以便重复选择同一文件；文件读取异常时捕获并展示通用读取失败 toast、不调用 `importSessions`
    - _Requirements: 6.1, 7.3, 7.4_

  - [x]* 4.3 编写 ChatPage 组件测试
    - 新建/扩展 ChatPage 组件测试（@testing-library/react，沿用既有 `ChatPage.test.tsx` 模式，mock `URL.createObjectURL`）：导出当前/全部入口含 JSON/Markdown 选项（7.1, 7.2）；隐藏 `input[type=file][accept='.json']` 存在（7.3）；模拟文件选择触发 `importSessions(文本)`（7.4）；触发导出创建带 `.json`/`.md` `download` 属性的锚点并 `click`（1.5, 2.6）；无会话时导出入口禁用（7.5）
    - _Requirements: 1.5, 2.6, 7.1, 7.2, 7.3, 7.4, 7.5_

- [x] 5. Final checkpoint — 无回归与类型检查
  - 运行 `npm test`（`vitest --run`）确认对话、语音、会话持久化、搜索等既有能力不回归（8.4），并运行 `tsc --noEmit`（`npm run build` 的 tsc 步骤）确认类型检查通过（8.6）；确认未修改 `api/client.ts` 及后端契约（8.5）
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- 标 `*` 的子任务为可选测试任务，可为加速 MVP 跳过；核心实现任务（无 `*`）必须实现。
- 每条 Correctness Property 各对应一个独立测试子任务，注释标签格式 `// Feature: conversation-export-import, Property N: ...`，fast-check 每条 ≥100 次迭代。
- P1–P8 为纯函数测试，无需数据层；P9–P14 经 `setChatDbForTesting(createFakeChatDb())` 注入 fake-indexeddb 包装的 `FakeChatDb`（P14 用其调用计数断言）。
- 每个任务引用具体 Requirements 子句以保证可追溯；checkpoint 任务保障增量验证。
- Export_Module 对 DOM / Chat_Store / IndexedDB 零依赖（8.3），id 分配与持久化/降级语义集中在 Chat_Store。

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.5"] },
    { "id": 2, "tasks": ["1.3", "1.6"] },
    { "id": 3, "tasks": ["1.4", "2.1"] },
    { "id": 4, "tasks": ["1.7", "2.2", "4.1"] },
    { "id": 5, "tasks": ["1.8", "2.3", "4.2"] },
    { "id": 6, "tasks": ["1.9", "2.4", "4.3"] },
    { "id": 7, "tasks": ["1.10", "2.5"] },
    { "id": 8, "tasks": ["1.11", "2.6"] },
    { "id": 9, "tasks": ["1.12", "2.7"] },
    { "id": 10, "tasks": ["2.8"] }
  ]
}
```
