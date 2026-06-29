# Design Document

## Overview

「对话导出与导入」(conversation-export-import) 是建立在已交付的 chat-session-persistence 之上的纯前端增量特性。它让 Chat_Page 用户能把会话历史导出为结构化 JSON（可无损往返）或可读 Markdown，并能从 JSON 文件导入会话——以新分配的、库内唯一的 id 作为新会话写入，永不覆盖现有数据。

设计分三层，严格沿用现有架构的「纯逻辑 / 状态 / UI」分层：

1. **Export_Module（纯逻辑层）** — 新建 `app/web/src/lib/conversationExport.ts`，提供 `buildExportBundle`（JSON 序列化）、`toMarkdown`（Markdown 序列化）、`parseImportBundle`（解析 + 校验，返回 `Result | Error` 联合类型）。全部为纯函数，不依赖 DOM / Chat_Store / IndexedDB，可被 fast-check 属性测试直接驱动（满足 Req 8.3）。
2. **Chat_Store（状态层）** — 在 `app/web/src/store/uiStore.ts` 新增 `importSessions` action，复用既有 `createSession` / `appendMessage` 的 id 生成、Chat_DB 写入模式、Memory_Fallback_Mode 降级语义与 toast 提示。
3. **UI 层** — 在 `ChatPage.tsx` 会话侧边栏新增「导出当前会话 / 导出全部 / 导入」入口，复用 File_Download（Blob + 锚点）触发下载，用隐藏 `<input type="file" accept=".json">` 触发文件选择。

设计的核心约束是**不修改后端及 `POST /api/chat`、`/api/inference/*` 契约**，且保持 `tsc --noEmit` 通过（Req 8.4–8.6）。

### 关键设计决策

| 决策 | 选择 | 理由 |
| --- | --- | --- |
| 解析返回类型 | 可辨识联合 `ParseResult = { ok: true; sessions } \| { ok: false; error }` | 让调用方在编译期被迫处理错误分支；错误分三类（语法 / 结构 / 版本）对应 Req 3.2–3.4、6.2–6.4。 |
| 新 id 分配位置 | 放在 Chat_Store（非 Export_Module） | id 唯一性依赖「当前库内 sessions 全集」这一运行时状态；纯逻辑层无该上下文。复用既有 `createSession` 的 id 生成手法。 |
| Markdown 角色名解析 | 由 Chat_Store 传入 `characterNameOf` 映射，Export_Module 不直接读取 store | 保持 Export_Module 对 store 零依赖（Req 8.3），同时满足 Req 2.3 的角色名渲染。 |
| 导入后当前会话 | 复用 `pickLatestSession` 选 `updatedAt` 最新者 | 与 `loadSessions` / `deleteSession` 的既有语义一致（Req 4.7）。 |
| 持久化与降级 | 复用 `appendMessage` 中的 `isPersistent` 分支与 `toastSaveFailed()` | 与既有写入路径同构，自然继承 Memory_Fallback_Mode（Req 8.1–8.2）。 |

## Architecture

```mermaid
flowchart TD
    subgraph UI["UI 层 — ChatPage.tsx (Session_Sidebar)"]
        ExportBtn["导出当前 / 导出全部<br/>(JSON · Markdown)"]
        ImportInput["隐藏 input[type=file]<br/>accept='.json'"]
        Download["File_Download<br/>(Blob + 锚点)"]
    end

    subgraph Store["状态层 — uiStore.ts"]
        ImportAction["importSessions(text)"]
        ExportSelectors["读取 sessions / messages<br/>(经 Chat_DB 取全量)"]
        Persist["createSession/appendMessage 同构写入"]
    end

    subgraph Pure["纯逻辑层 — conversationExport.ts (Export_Module)"]
        Build["buildExportBundle()"]
        Md["toMarkdown()"]
        Parse["parseImportBundle() → ParseResult"]
    end

    subgraph DB["Chat_DB (IndexedDB / fake-indexeddb)"]
        Sessions[(sessions)]
        Messages[(messages)]
    end

    ExportBtn -->|读取会话+消息| ExportSelectors
    ExportSelectors -->|ExportInput| Build
    ExportSelectors -->|ExportInput + characterNameOf| Md
    Build -->|JSON 文本| Download
    Md -->|Markdown 文本| Download

    ImportInput -->|file.text()| ImportAction
    ImportAction -->|文件文本| Parse
    Parse -->|ok: ImportedSession[]| Persist
    Parse -->|err: Import_Error| ImportAction
    Persist -->|isPersistent| Sessions
    Persist -->|isPersistent| Messages
    ImportAction -->|toast| UI
```

### 导出数据流

1. 用户点击侧边栏导出入口（当前会话 / 全部，JSON / Markdown 共四种组合）。
2. ChatPage 从 Chat_Store 取得待导出的 `ExportInput`（一个或多个会话 + 各自消息）。导出全部时经 Chat_DB 跨会话读取全量消息（复用 `assembleSearchCorpus` 同款读取手法）；导出当前会话时直接用内存中 `messages`。
3. 调用 `buildExportBundle(input)` 得到 Export_Bundle 对象，`JSON.stringify` 为文本；或调用 `toMarkdown(input, characterNameOf)` 得到 Markdown 文本。
4. ChatPage 经 File_Download 以 `.json` / `.md` 文件名触发下载。

### 导入数据流

1. 用户经隐藏 `<input type="file" accept=".json">` 选择文件，ChatPage 用 `file.text()` 读取文本。
2. 调用 Chat_Store 的 `importSessions(text)`：内部先调用 `parseImportBundle(text)`。
3. 解析失败 → 返回 Import_Error，Chat_Store 不改动任何状态，ChatPage 按错误类别展示对应 toast（Req 6.1–6.4）。
4. 解析成功 → Chat_Store 为每条 Imported_Session 分配库内唯一新 id，追加为新会话（消息按原序、各自分配会话内唯一 id），持久模式下经 Chat_DB 持久化，最后切换到 `updatedAt` 最新的导入会话，并展示成功 toast（含数量）。

## Components and Interfaces

### Export_Module — `app/web/src/lib/conversationExport.ts`（新建，纯函数）

```typescript
import type { ChatSession, ChatMessage } from '@/store/uiStore';

/** 当前导出格式版本号（Format_Version）。本特性固定为 "1"。 */
export const FORMAT_VERSION = '1';

/** Export_Module 能够导入的 Format_Version 集合（Supported_Version）。 */
export const SUPPORTED_VERSIONS: readonly string[] = ['1'];

/**
 * 单条会话的导出/导入载荷：会话元数据 + 按追加顺序排列的消息。
 * 这是 Export_Module 与 Chat_Store 之间传递会话数据的统一形状。
 */
export interface ExportedSession {
  session: ChatSession;
  messages: ChatMessage[];
}

/** 导出 JSON 文件的顶层结构（Export_Bundle）。 */
export interface ExportBundle {
  formatVersion: string;
  /** ISO 8601 时间戳；由调用方注入（保持纯函数可测，见下方 buildExportBundle）。 */
  exportedAt: string;
  sessions: ExportedSession[];
}

/** parseImportBundle 的错误类别（对应 Req 3.2–3.4 / 6.2–6.4）。 */
export type ImportErrorKind = 'syntax' | 'structure' | 'version';

/** 导入失败结果（Import_Error）。 */
export interface ImportError {
  kind: ImportErrorKind;
  /** 面向用户的中文提示信息。 */
  message: string;
}

/** parseImportBundle 的返回类型：可辨识联合，成功携带规范化会话列表。 */
export type ParseResult =
  | { ok: true; sessions: ExportedSession[] }
  | { ok: false; error: ImportError };

/**
 * 构造 Export_Bundle（JSON 序列化的前一步，返回对象供调用方 JSON.stringify）。
 *
 * 纯函数：exportedAt 由调用方注入而非内部读 Date.now()，从而对相同输入产生
 * 相同输出，便于属性测试。会话顺序与 messages 顺序原样保留（Req 1.2, 1.4）。
 * 每个 ExportedSession 仅保留 Req 1.4 规定的字段（title/characterId/voiceId/
 * updatedAt 与消息的 role/content；其余可选字段如 audioUrl 按设计透传以支持无损往返）。
 *
 * @param sessions 待导出的会话列表（单会话导出时长度为 1）
 * @param exportedAt ISO 8601 时间戳
 */
export function buildExportBundle(
  sessions: ExportedSession[],
  exportedAt: string,
): ExportBundle;

/**
 * 将会话列表渲染为确定性 Markdown 文本（Markdown_Export）。
 *
 * - 每个会话以其 title 作为标题段；
 * - 每条消息渲染「发送方显示名 + content」，user 显示名为「我」，
 *   assistant 显示名由 characterNameOf(characterId) 解析（未命中回退「助手」，Req 2.3）；
 * - 消息按数组顺序（= 追加顺序）排版（Req 2.4）；
 * - 对相同输入逐字符确定（Req 2.5）：不读取时钟/随机源，行分隔与转义固定。
 *
 * @param sessions 待导出的会话列表
 * @param characterNameOf 由 Chat_Store 注入的角色名解析器（characterId → name | undefined）
 */
export function toMarkdown(
  sessions: ExportedSession[],
  characterNameOf: (characterId: string) => string | undefined,
): string;

/**
 * 解析并校验一段文件文本（JSON_Import 的纯逻辑部分）。
 *
 * 顺序：
 * 1. JSON.parse —— 失败返回 { ok:false, error:{ kind:'syntax' } }（Req 3.2）。
 * 2. 结构校验 —— 顶层须为对象且含字符串 formatVersion、sessions 为数组，
 *    且每个元素含对象 session 与数组 messages，否则 { kind:'structure' }（Req 3.3）。
 * 3. 版本校验 —— formatVersion ∉ SUPPORTED_VERSIONS 时 { kind:'version' }（Req 3.4）。
 * 4. 规范化 —— 通过后产出规范化 ExportedSession[]（Req 3.5）：仅保留已知字段、
 *    消息仅保留 role/content（及存在的可选字段），顺序原样保留。
 *
 * 失败时绝不产出任何会话数据（sessions 字段不存在于 error 分支）。
 */
export function parseImportBundle(text: string): ParseResult;
```

设计要点：
- **纯函数与可测性**：`buildExportBundle` 的 `exportedAt` 由调用方注入，`toMarkdown` 的角色名由 `characterNameOf` 注入，从而 Export_Module 对 store / DOM / IndexedDB 零依赖（Req 8.3），并使「相同输入 → 相同输出」成立（Req 2.5）。
- **联合类型强制错误处理**：`ParseResult` 的 `ok` 判别字段使 TypeScript 在 `ok===false` 分支下无 `sessions`，调用方必须先判别再使用（编译期保障 Req 6.1 的「失败不产出数据」）。

### Chat_Store — `importSessions` action（`uiStore.ts` 新增）

```typescript
// UIState 接口新增：
  /**
   * 从一段文件文本导入会话（JSON_Import 的状态层部分）。
   *
   * 调用 parseImportBundle(text)：
   * - 失败：不改动 sessions/messages/currentSessionId 与持久层，
   *   按 error.kind 展示对应错误 toast，返回该 ImportError（Req 6.1–6.4）。
   * - 成功：为每个 ExportedSession 分配库内唯一新 id（不与现有/批内其他会话冲突，
   *   Req 4.2–4.3），消息按原序追加并各分配会话内唯一 id（Req 4.4），
   *   保留全部现有会话与消息（Req 4.5）；持久模式下经 Chat_DB 持久化新会话与消息
   *   （Req 4.6, 8.2 失败 toast）；切换 currentSessionId 到导入会话中 updatedAt 最新者
   *   并加载其消息（Req 4.7）；展示含数量的成功 toast（Req 6.5）。返回 null。
   */
  importSessions: (text: string) => Promise<ImportError | null>;
```

实现复用既有手法：
- **新会话 id 生成**：沿用 `createSession` 的 `Date.now().toString() + Math.random().toString(36).slice(2, 6)`，并以一个「已占用 id 集合」（现有 `sessions` 的 id + 本批已分配 id）做去重重试，保证库内 + 批内唯一（Req 4.2–4.3）。这与 `generateCharacterId` 的「冲突重试」思路一致。
- **消息 id 生成**：每条导入消息分配会话内唯一 id（同款时间戳 + 随机后缀 + 去重）；持久化时构造 `PersistedMessage = { ...msg, sessionId, seq }`，`seq` 取消息在该会话内的下标（与 `appendMessage` 的 `seq = messages.length` 语义一致）。
- **持久化分支**：`if (get().isPersistent) { try { await chatDb.saveSession(...); await chatDb.saveMessage(...) } catch { toastSaveFailed() } }`——与 `appendMessage` 完全同构，自动满足 Memory_Fallback_Mode（`isPersistent===false` 时跳过 DB，仅内存维护，Req 8.1）与写入失败提示（Req 8.2）。
- **当前会话切换**：用 `pickLatestSession(importedSessions)` 选最新者，set `currentSessionId` 并 set `messages` 为该会话消息（Req 4.7）。
- **状态原子性**：先 `parseImportBundle`，仅在 `ok` 时才 `set(...)`；错误分支完全不调用 `set`，确保现有数据不变（Req 6.1）。

### UI — `ChatPage.tsx` 会话侧边栏入口

在 Session_Sidebar「新建会话」按钮区域附近新增一组操作入口：

```typescript
// 导出：构造文本 → File_Download
function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
```

- **导出当前会话**：菜单含「JSON」「Markdown」两项；JSON 调 `buildExportBundle([{session, messages}], new Date().toISOString())` 后 `JSON.stringify`，文件名 `nuwa-chat-{title}-{ts}.json`；Markdown 调 `toMarkdown(...)`，文件名 `.md`（Req 1.5, 2.6）。
- **导出全部**：先经 Chat_DB 取全量会话与消息（持久模式）或用内存会话（降级模式），再按上同样导出。
- **导入**：一个可见按钮触发隐藏 `<input type="file" accept=".json">`（Req 7.3）；`onChange` 读取 `await file.text()` 后调 `importSessions(text)`（Req 7.4）；读取后重置 input 的 value 以便重复选择同一文件。
- **无会话禁用**：`sessions.length === 0` 时禁用导出入口（Req 7.5）。
- **错误/成功提示**：`importSessions` 内部已发 toast；ChatPage 仅负责读文件与调用。

## Data Models

### ExportBundle（导出 JSON 顶层 / Export_Bundle）

```jsonc
{
  "formatVersion": "1",          // Format_Version；导入时校验 ∈ Supported_Version
  "exportedAt": "2025-01-02T03:04:05.000Z", // ISO 8601
  "sessions": [                  // 按导出顺序排列
    {
      "session": {
        "id": "...",             // 原会话 id（导入时被忽略，重新分配）
        "title": "关于希腊哲学",
        "characterId": "socrates",
        "voiceId": "narrator",
        "updatedAt": "2025-01-01T10:00:00.000Z"
      },
      "messages": [              // 按追加顺序
        { "id": "...", "role": "user", "content": "你好" },
        { "id": "...", "role": "assistant", "content": "你好，让我们开始思考。" }
      ]
    }
  ]
}
```

字段映射到既有类型（`ChatSession` / `ChatMessage`，定义于 `uiStore.ts`），不引入后端契约变化。消息的可选字段（`audioUrl` / `voiceName` / `duration`）在导出时透传、导入时若存在则保留，以支持无损往返；`role` 与 `content` 为往返一致性的核心断言字段（Req 5.1）。

### 规范化（normalization）

`parseImportBundle` 在校验通过后产出**规范化**的 `ExportedSession[]`：
- `session`：仅保留 `title` / `characterId` / `voiceId` / `updatedAt`（`updatedAt` 缺失时留空字符串，由 Chat_Store 在写入时回退当前时间，Req 4.1）；导入会忽略原 `id`。
- `messages`：每条仅保留 `role`（限定 `'user' | 'assistant'`，非法值视为结构错误）与 `content`（字符串），可选字段若为合法类型则保留；顺序原样。

### 错误模型（Import_Error）

| kind | 触发条件 | 用户提示（Req） |
| --- | --- | --- |
| `syntax` | `JSON.parse` 抛错 | 「文件格式无法解析」（6.2） |
| `structure` | 非对象 / 缺 `formatVersion` / `sessions` 非数组 / 某条目缺 `session` 或 `messages` / 字段类型非法 | 「文件内容结构不正确」（6.3） |
| `version` | `formatVersion ∉ SUPPORTED_VERSIONS` | 「文件版本不受支持」（6.4） |

校验顺序固定为 syntax → structure → version，确保每段非法输入归入唯一类别。

## Correctness Properties

*属性（property）是一个应在系统所有合法执行中都成立的特征或行为——本质上是关于「系统应当做什么」的形式化陈述。属性是连接人类可读规格与机器可验证正确性保证之间的桥梁。*

下列属性由需求验收标准经 prework 分析转化而来，并经去冗余反思合并。Export_Module 的属性（P1–P8）为纯函数属性，用 fast-check（每条 ≥100 次迭代）直接驱动；Chat_Store 的属性（P9–P14）用 fast-check 驱动 store action，数据层注入 fake-indexeddb（或等价 FakeChatDb）。

### Property 1: JSON 导出—导入往返一致

*For any* 合法的 ChatSession 集合及其 ChatMessage 序列，对其执行 `buildExportBundle` 并 `JSON.stringify` 后再 `parseImportBundle`，结果必为 `ok === true`，且产出的会话条目数量与原始相同，每条会话的 `title` / `characterId` / `voiceId` 与原始一致，每条会话的消息序列在 `role` 与 `content` 上与原始逐条相等且顺序不变。

**Validates: Requirements 1.1, 1.2, 1.4, 3.5, 3.6, 5.1, 5.2, 5.3**

### Property 2: Export_Bundle 顶层结构

*For any* 合法的会话列表与任意注入的 `exportedAt` 时间戳，`buildExportBundle` 产出的 Export_Bundle 顶层 `formatVersion` 恒等于 `FORMAT_VERSION`、`exportedAt` 恒等于注入值、`sessions` 恒为数组。

**Validates: Requirements 1.3**

### Property 3: Markdown 包含全部内容且按追加顺序

*For any* 合法的会话列表，`toMarkdown` 的输出对每个会话都包含其 `title`、包含该会话每条消息的 `content`，且各消息 `content` 在输出中的出现顺序与其在会话内的追加顺序一致（会话之间亦按输入顺序排列）。

**Validates: Requirements 2.1, 2.2, 2.4**

### Property 4: Markdown 发送方显示名规则

*For any* 合法的会话列表与任意 `characterNameOf` 映射，`toMarkdown` 输出中每条 user 消息的发送方显示名为「我」，每条 assistant 消息的发送方显示名为 `characterNameOf(characterId)` 的返回值，当其为 `undefined` 时为「助手」。

**Validates: Requirements 2.3**

### Property 5: Markdown 确定性输出

*For any* 合法的会话列表与固定的 `characterNameOf` 映射，连续两次调用 `toMarkdown` 产出逐字符完全相同的字符串。

**Validates: Requirements 2.5**

### Property 6: 非法 JSON 返回语法错误且不产出数据

*For any* 无法被 `JSON.parse` 解析的字符串，`parseImportBundle` 返回 `{ ok: false, error.kind: 'syntax' }`，且结果中不含任何会话数据。

**Validates: Requirements 3.2**

### Property 7: 结构不符返回结构错误且不产出数据

*For any* 可解析为合法 JSON 但不符合 Export_Bundle 结构的值（缺 `formatVersion`、`sessions` 非数组、或任一条目缺 `session`/`messages` 或字段类型非法），`parseImportBundle` 返回 `{ ok: false, error.kind: 'structure' }`，且不含任何会话数据。

**Validates: Requirements 3.3**

### Property 8: 版本不符返回版本错误且不产出数据

*For any* 结构合法但 `formatVersion` 不属于 `SUPPORTED_VERSIONS` 的 Export_Bundle，`parseImportBundle` 返回 `{ ok: false, error.kind: 'version' }`，且不含任何会话数据。

**Validates: Requirements 3.4**

### Property 9: 导入后会话 id 库内唯一且数量正确

*For any* 现有 sessions 集合与任意一批合法 Imported_Session，成功执行 `importSessions` 后，Chat_Store `sessions` 中所有会话 `id` 互不相同（批内新会话之间、新会话与现有会话之间均不冲突），且 `sessions` 数量等于原数量加上导入条目数。

**Validates: Requirements 4.2, 4.3**

### Property 10: 导入消息保序且会话内 id 唯一

*For any* 一批合法 Imported_Session，成功导入后，每个新建会话的消息序列在 `role` 与 `content` 上与对应条目逐条相等且顺序不变，且该会话内所有消息 `id` 互不相同。

**Validates: Requirements 4.4**

### Property 11: 成功导入保留全部现有数据

*For any* 现有会话与消息集合及任意一批合法 Imported_Session，成功导入后，全部现有会话及其消息均不被修改或删除（仅新增导入会话）。

**Validates: Requirements 4.5**

### Property 12: 导入后切换到最新会话

*For any* 一批非空的合法 Imported_Session，成功导入后，`currentSessionId` 等于该批新建会话中 `updatedAt` 最新的一条，且 `messages` 为该会话的消息序列。

**Validates: Requirements 4.7**

### Property 13: 非法导入不修改现有数据

*For any* 现有 Chat_Store 状态与任意会触发 Import_Error（语法 / 结构 / 版本任一类别）的文件文本，`importSessions` 返回该 Import_Error，且 `sessions`、`messages`、`currentSessionId` 与持久层中的全部数据保持不变。

**Validates: Requirements 6.1**

### Property 14: 降级模式导入仅维护内存

*For any* 一批合法 Imported_Session，当 Chat_Store 处于 Memory_Fallback_Mode（`isPersistent === false`）时成功导入，Chat_DB 的 `saveSession` / `saveMessage` 写入不被调用，而内存中的 `sessions` 与 `messages` 已据导入更新。

**Validates: Requirements 8.1**

## Error Handling

| 场景 | 处理 | 需求 |
| --- | --- | --- |
| 导入文件非合法 JSON | `parseImportBundle` 返回 `kind:'syntax'`；Chat_Store 不改状态，ChatPage 展示「文件格式无法解析」toast | 3.2, 6.1, 6.2 |
| 导入文件结构不符 | 返回 `kind:'structure'`；不改状态，展示「文件内容结构不正确」toast | 3.3, 6.1, 6.3 |
| 导入文件版本不支持 | 返回 `kind:'version'`；不改状态，展示「文件版本不受支持」toast | 3.4, 6.1, 6.4 |
| 导入条目 `updatedAt` 缺失 | Chat_Store 写入时回退 `new Date().toISOString()` | 4.1 |
| 持久模式 Chat_DB 写入失败 | 沿用 `try/catch + toastSaveFailed()`：保留内存状态，展示「保存失败」toast | 8.2 |
| Memory_Fallback_Mode | `isPersistent===false` 时跳过全部 Chat_DB 写入，仅内存维护 | 8.1 |
| 导出时无会话 | 侧边栏导出入口禁用（不触发空导出） | 7.5 |
| 文件读取（`file.text()`）异常 | ChatPage 捕获并展示通用读取失败 toast，不调用 `importSessions` | 6.1 |

错误处理原则：解析与校验全部前置在纯函数 `parseImportBundle` 内完成，Chat_Store 仅在 `ok === true` 时调用 `set(...)`，从根本上保证「任何失败都不触碰现有状态」（Req 6.1）。

## Testing Strategy

本特性同时采用**单元/示例测试**与**属性测试**，二者互补：属性测试覆盖纯逻辑层（序列化/解析/往返/确定性）的普适正确性，示例测试覆盖 UI 渲染、交互连接与具体 toast 文案。

### 属性测试（fast-check，每条 ≥100 次迭代）

- 库：项目已具备 `fast-check@^3` 与 `fake-indexeddb@^6`（见 `package.json` devDependencies），不自行实现 PBT。
- Export_Module（P1–P8）：纯函数，直接用 fast-check 生成随机 `ExportedSession[]`（含随机 title/characterId/voiceId/updatedAt、随机消息 role/content、含 CJK 与特殊字符）驱动，无需 DOM/store/IDB（验证 Req 8.3）。
- Chat_Store（P9–P14）：用 fast-check 生成随机现有状态与导入批，经 `setChatDbForTesting` 注入 fake-indexeddb 包装的 ChatDb 或 `createFakeChatDb()`（`testChatDb.ts`），驱动 `importSessions` 后断言。
- 每个属性测试以一条 property-based test 实现，并加注释标签：
  - 格式：`// Feature: conversation-export-import, Property {number}: {property_text}`
- 测试文件建议：`app/web/src/lib/conversationExport.test.ts`（P1–P8）、`app/web/src/store/uiStore.import.test.ts`（P9–P14）。

属性到测试映射：

| Property | 被测对象 | 数据层 |
| --- | --- | --- |
| P1 往返一致 | `buildExportBundle`+`JSON.stringify`+`parseImportBundle` | 无（纯函数） |
| P2 顶层结构 | `buildExportBundle` | 无 |
| P3 Markdown 内容/顺序 | `toMarkdown` | 无 |
| P4 显示名规则 | `toMarkdown` | 无 |
| P5 确定性 | `toMarkdown` | 无 |
| P6/P7/P8 错误分类 | `parseImportBundle` | 无 |
| P9 id 唯一 | `importSessions` | fake-indexeddb |
| P10 消息保序/唯一 | `importSessions` | fake-indexeddb |
| P11 现有数据保留 | `importSessions` | fake-indexeddb |
| P12 切换最新 | `importSessions` | fake-indexeddb |
| P13 非法导入不改数据 | `importSessions` | fake-indexeddb |
| P14 降级仅内存 | `importSessions` | FakeChatDb 计数 |

### 示例/单元测试

- Export_Module 边界：空会话列表、空消息会话、含可选字段（audioUrl/voiceName/duration）的消息往返保留；`role` 非法值被归为 structure 错误。
- Chat_Store 示例：`updatedAt` 缺失回退当前时间（4.1）；持久模式写入失败保留内存 + 「保存失败」toast（8.2）；成功导入发含数量的成功 toast（6.5）；三类错误各自的 toast 文案（6.2–6.4）。
- ChatPage 组件测试（@testing-library/react，沿用既有 `ChatPage.test.tsx` 模式）：
  - 导出当前会话 / 导出全部入口存在且含 JSON / Markdown 选项（7.1, 7.2）；
  - 导入入口存在，隐藏 `input[type=file][accept='.json']`（7.3）；
  - 模拟文件选择触发 `importSessions(文本)`（7.4）；
  - 触发导出时创建带 `.json` / `.md` `download` 属性的锚点并 `click`（mock `URL.createObjectURL`）（1.5, 2.6）；
  - 无会话时导出入口禁用（7.5）。

### 无回归与类型检查

- 运行既有完整测试套件（`npm test`，即 `vitest --run`）确认对话、语音、会话持久化、搜索等既有能力不回归（Req 8.4）。
- 不修改 `api/client.ts` 及后端契约（Req 8.5）。
- 运行 `tsc --noEmit`（`npm run build` 的 `tsc` 步骤）确认类型检查通过（Req 8.6）。
