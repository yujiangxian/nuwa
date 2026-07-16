# 设计与实施方案：角色并入 Agent（Chat / Agent / 角色 三合二）

> 状态：**已实施**（2026-07-16）  
> 本文档是完整交接规格：不依赖任何对话上下文，按文中步骤即可实施。  
> 「决策记录」保持不变；验收清单已勾选。

---

## 1. 背景与目标

当前产品有三个概念：**智能对话 Chat**、**Agent**、**角色 Character**。其中角色与 Agent 是包含关系而非并列关系：

- 角色 = 系统提示 + 音色 + 采样参数（"谁在说话"）
- Agent = 同样的人设字段 **+ 执行方式**（本地流水线 / 工作流步骤 / 外部 API）

Chat 顶栏现在只认 Agent，角色页成了"改了也不生效"的孤岛。

**目标概念模型（对齐 ChatGPT：Chat = 对话界面，Agent = GPTs）：**

```
智能对话 Chat（对话壳）
 └─ 每个会话绑定一个 Agent（agentId）

Agent（唯一的智能体概念 = 原角色 + 执行方式）
 ├─ 人设层：name / avatar / systemPrompt / voiceId / temperature / topP / mood
 └─ 执行层：kind = local | workflow | external
```

**角色页删除**，现有角色数据一次性迁移为 `kind: 'local'` 的 Agent。

---

## 2. 现状盘点（关键文件）

全部在 `app/web/src/` 下（另有 `docs/`）：

| 文件 | 现状 |
|------|------|
| `store/types.ts` | `Character` / `CharacterInput` / `Agent` / `AgentInput` / `AgentStep` / `ChatSession`（含 `characterId: string` 必填 + `agentId?: string`）/ `AppPage`（含 `'characters'` 与 `'agents'`） |
| `store/characterStore.ts` | 角色 zustand store；`defaultCharacters` 种子（id：`assistant`(季莹莹)、`socrates`、`counselor`）；IndexedDB `nuwa-character` |
| `store/agentStore.ts` | Agent zustand store；`defaultAgents` 种子（`agent-assistant` 通用助手、`agent-jyy` 季莹莹、`agent-voice-workflow` 语音工作流）；IndexedDB `nuwa-agent`；create/update/delete 已处理 workflow steps 与 external 密钥（localStorage） |
| `store/uiStore.ts` | 聚合 store：角色域与 Agent 域都在此代理；`createSession(characterId)` 会从 `currentAgentId` 快照 `agentId`；`switchSession` **不**恢复 agent/角色；`loadSessions`/`deleteSession` 空状态时 `createSession(get().currentCharacterId)`；`importSessions` 已回填 `agentId` |
| `lib/character.ts` | `validateName` / `generateCharacterId` / `needsSeeding` / `pickNextCurrentId`（纯函数） |
| `lib/characterDb.ts` | IndexedDB 封装（`nuwa-character` / store `characters`） |
| `lib/agent.ts` | Agent 纯函数；`validateName` 从 `lib/character` 复用导出 |
| `lib/agentDb.ts` | IndexedDB 封装（`nuwa-agent` / store `agents`） |
| `lib/agentWorkflow.ts` | `makeSteps` / `resolvePipelineFromSteps` / `shouldAutoTts` / `WORKFLOW_PRESETS` |
| `lib/externalAgent.ts` | OpenAI 兼容流式客户端 + 连通性探测 + 密钥 localStorage（`nuwa_agent_secret:{id}`） |
| `components/CharactersPage.tsx` (+ `CharactersPage.test.tsx`) | 角色管理页（CRUD / 导入导出） |
| `components/AgentsPage.tsx` | Agent 管理页（三类 kind、工作流步骤编辑、外部配置、**「从角色导入」按钮读取 uiStore.characters**） |
| `components/chat/ChatPage.tsx` | `activePersona = currentAgent ?? currentCharacter`；顶栏 Agent 下拉；`Ctrl+N` 调 `createSession(currentCharacterId)` |
| `components/chat/useAssistantStream.ts` | 入参 `currentCharacter`（人设回退）+ `currentAgent`（驱动 external/workflow/local） |
| `components/chat/SessionSidebar.tsx` | `createSession: (characterId: string) => void` prop |
| `components/chat/MessageList.tsx` | 已解耦为 `ChatPersona` 结构类型，无需改 |
| `App.tsx` | 路由含 `'/characters'`；`/workflow` 已重定向到 `/agents` |
| `components/HomePage.tsx` | 首页卡片含「角色管理」与「Agent」 |
| `lib/commandRegistry.ts` (+ test) | 导航命令含 `characters` 与 `agents` |
| `lib/conversationExport.ts` | 导出/导入会话，`ExportedSession.session.characterId` 存在于导出格式 |

**已知既有缺口（本次一并修复）：** `switchSession` 切换会话时不恢复该会话绑定的人设/Agent。

---

## 3. 目标设计

### 3.1 数据模型（`store/types.ts`）

1. `Agent` 增加可选字段 `mood?: string`（承接角色的 mood，不丢数据；暂无运行时消费方）。
2. `ChatSession.characterId` **保留**（导入导出兼容），语义降级为「历史遗留别名」：新会话写入 `characterId = agentId`。在类型注释中标注 `@deprecated use agentId`。
3. `AppPage` 移除 `'characters'`。
4. `Character` / `CharacterInput` 类型**保留**（迁移读取与 `lib/character` 纯函数仍引用）。

### 3.2 会话与 Agent 绑定规则（ChatGPT 式）

| 场景 | 行为 |
|------|------|
| 新建会话 | 绑定当前 `currentAgentId`；`voiceId` 取该 Agent 的 `voiceId`（回退 `'jyy'`） |
| 切换会话 | 若 `session.agentId ?? session.characterId` 在 `agents` 中存在 → 恢复为 `currentAgentId`；不存在则保持当前不变 |
| 会话中途换 Agent（顶栏下拉） | 更新**当前会话**的 `agentId`（和 `characterId` 别名）并持久化 `saveSession`；历史消息不动，后续回复用新 Agent |
| 旧会话（只有 characterId） | 迁移后角色 id 即 Agent id，`characterId` 直接当 `agentId` 用 |

### 3.3 Agent 默认种子（`store/agentStore.ts` 的 `defaultAgents`）

替换为 5 个（**删除 `agent-jyy`**，它与迁移后的 `assistant` 重复）：

| id | name | kind | 说明 |
|----|------|------|------|
| `agent-assistant` | 通用助手 | local (`text_chat_stream`) | 保持现状；`currentAgentId` 默认值不变 |
| `assistant` | 季莹莹 | local (`text_chat_stream`) | 从 `defaultCharacters[0]` 原样搬运（完整 systemPrompt、voiceId `jyy`、mood/temperature/topP） |
| `socrates` | 苏格拉底 | local | 同上搬运 |
| `counselor` | 心理咨询师 | local | 同上搬运 |
| `agent-voice-workflow` | 语音工作流 | workflow (asr→llm→tts) | 保持现状 |

> id 直接沿用角色 id（`assistant`/`socrates`/`counselor`），这样旧会话的 `characterId` 天然就是有效的 Agent id。

### 3.4 一次性迁移（老用户的自建角色）

位置：`store/agentStore.ts` 的 `loadAgents()` 内，在读取 stored agents 之后、种子判断之前执行：

```
if (localStorage['nuwa_agent_character_migrated'] !== '1') {
  尝试 createCharacterDb().init() + getAllCharacters()（失败则静默跳过，不 toast）
  for each character c:
    - 若 agents 中已存在 id === c.id → 跳过
    - 若 agents 中已存在 name === c.name → 跳过（防止「季莹莹」等重复人设）
    - 否则转换并写入 agentDb + 内存：
      { id: c.id, name, avatar, systemPrompt, voiceId, description,
        kind: 'local', pipeline: 'text_chat_stream',
        mood: c.mood, temperature: c.temperature, topP: c.topP }
  localStorage['nuwa_agent_character_migrated'] = '1'
}
```

要点：

- **必须有 localStorage 完成标记**：否则用户删除迁移来的 Agent 后每次启动都会复活。
- 迁移只读 `nuwa-character`，**不删除**该库（保留回滚可能）。
- `charactersPersistent === false`（IndexedDB 不可用）场景：迁移整体 try/catch 跳过即可。

### 3.5 Chat 改造（`components/chat/`）

`ChatPage.tsx`：

- 删除 `characters` / `currentCharacterId` / `currentCharacter` 相关订阅与推导；`activePersona` 直接等于 `currentAgent`（agents 至少保留 1 个，由 store 保证非空）。
- `Ctrl+N` 与空状态新建：`createSession(currentAgentId)`。
- 顶栏 Agent 下拉选择时：除 `setCurrentAgent(id)` 外，若存在当前会话则调用新增的 `bindSessionAgent(sessionId, agentId)`（见 3.6）。

`useAssistantStream.ts`：

- 删除 `currentCharacter` 入参，人设统一读 `currentAgent`（`system = tempSystemPrompt ?? currentAgent?.systemPrompt`；TTS 音色 `resolveVoiceRef(currentAgent?.voiceId, voices)`）。
- 其余逻辑（external 分支、wantTts、降级 `/api/chat`）不变。

`SessionSidebar.tsx`：prop 改名 `createSession: (agentId: string) => void`，调用处传 `currentAgentId`。

### 3.6 uiStore 改造（`store/uiStore.ts`）

1. **删除角色域**：`characters` / `currentCharacterId` / `charactersLoading` / `charactersPersistent` / `setCurrentCharacter` / `loadCharacters` / `createCharacter` / `updateCharacter` / `deleteCharacter` 字段与实现，及对 `characterStore` 的 import/re-export（`defaultCharacters` / `setCharacterDbForTesting` 的 re-export 一并删除）。
2. `createSession(agentId: string)`：
   - `voiceId = agents.find(a => a.id === agentId)?.voiceId || 'jyy'`
   - 写入 `{ agentId, characterId: agentId, ... }`
3. `switchSession(sessionId)`：加载消息后，按 3.2 规则恢复 `currentAgentId`（同时同步 `agentStore.setCurrentAgent`）。
4. 新增 action `bindSessionAgent(sessionId: string, agentId: string)`：更新内存中该 session 的 `agentId` 与 `characterId` 别名、`saveSession` 持久化（沿用 toastSaveFailed 处理）。
5. `loadSessions` / `deleteSession` 空状态自动建会话处：`createSession(get().currentAgentId)`。
6. `importSessions`：`agentId = entry.session.agentId ?? entry.session.characterId ?? get().currentAgentId`（`characterId` 别名同步写）。

### 3.7 删除角色页及入口

- 删除文件:`components/CharactersPage.tsx`、`components/CharactersPage.test.tsx`、`store/characterStore.ts`。
- **保留**：`lib/character.ts`（`lib/agent.ts` 复用 `validateName`；纯函数测试 `character.test.ts` 保留）、`lib/characterDb.ts`（迁移读取用；`characterDb.test.ts` 保留）。`defaultCharacters` 数据常量迁至何处：直接在 `agentStore.ts` 内联新 `defaultAgents`（3.3），不再需要导出 `defaultCharacters`；若测试需要可从 agentStore 导出。
- `App.tsx`：移除 import 与 `'/characters'` 路由、`renderPage` case；`'/characters'` 加入 legacy 重定向到 `/agents`（与 `/workflow` 同样处理）。
- `HomePage.tsx`：移除「角色管理」卡片（`Users` 图标 import 一并清理）。
- `lib/commandRegistry.ts`：`NAV_ITEMS` 移除 characters 项；文件头注释数量描述同步更新。
- `AgentsPage.tsx`：删除「从角色导入」按钮与 `characters` 订阅（迁移已把角色变成 Agent，无需再导入）。

### 3.8 i18n

`home.feature.characters.*` 键从语言文件中移除（若 `lib/i18n` 存在对应词条）；无则跳过。

---

## 4. 实施步骤（建议顺序）

1. **类型层**：`types.ts` 改动（3.1）。跑 `npx tsc --noEmit` 列出全部报错点作为改动清单。
2. **agentStore**：新 `defaultAgents`（3.3）+ 迁移逻辑（3.4）+（如需）导出 `defaultAgents` 供测试。
3. **uiStore**：删除角色域 + session 绑定规则（3.6）。
4. **Chat**：ChatPage / useAssistantStream / SessionSidebar（3.5）。
5. **删除角色页与入口**（3.7）+ i18n（3.8）。
6. **测试修复与新增**（第 5 节）。
7. **文档同步**：`docs/roadmap.md`（角色管理条目改为「已并入 Agent」）、`docs/module-landscape.md` §11 角色管理标注「已合并入 Agent（15）」、`docs/features/agents.md` 增加「角色已并入」一节、本文件勾选完成。

> 查找遗漏统一用：`rg "characterId|currentCharacterId|defaultCharacters|CharactersPage|characterStore" app/web/src`

---

## 5. 测试

### 5.1 需要修复的既有测试

| 文件 | 处理 |
|------|------|
| `components/ChatPage.test.tsx` 及 `.markdown` / `.userPlaintext` / `.slashCommand` / `.organize` / `.copySource` 变体 | `useUIStore.setState` 中移除 `characters` / `currentCharacterId`，保留/使用 `agents: defaultAgents, currentAgentId: 'agent-assistant'`；fixture 里 `ChatSession.characterId` 字段保留不动 |
| `components/CharactersPage.test.tsx` | 删除 |
| `store/uiStore.session.test.ts` | `createSession(picked.id)` 传的是人设 id（`assistant` 等）——迁移后这些 id 是合法 Agent id，断言 `created.characterId === picked.id` 仍成立（characterId=agentId 别名）；如有直接引用 `defaultCharacters` 之处改为 agentStore 种子 |
| `store/uiStore.pin.test.ts` / `invariant` / `import` / `messageActions` / `search` | fixture 的 `characterId: 'assistant'` 等无需改；如引用 `defaultCharacters` 改引用 `defaultAgents` |
| `lib/commandRegistry.test.ts` | pages 列表移除 `'characters'` |

### 5.2 新增测试

1. **agentStore 迁移**（注入 fake characterDb + fake agentDb + fake-indexeddb 已有基建）：
   - 角色转换为 local Agent，字段映射正确；
   - id / name 去重（同 id 或同 name 不重复导入）；
   - 迁移标记后二次 load 不再导入（删除后不复活）。
2. **switchSession 恢复 Agent**：会话 A 绑 `socrates`、会话 B 绑 `agent-assistant`，切换后 `currentAgentId` 跟随；agentId 不存在时保持不变。
3. **bindSessionAgent**：更新内存 + 调用 saveSession。
4. **createSession**：`agentId` 与 `characterId` 同值写入；voiceId 取自 Agent。

### 5.3 验证命令

```bash
cd app/web
npx tsc --noEmit
npx vitest run
npx eslint src --max-warnings=0
```

三条全部通过为准（仓库约定：不破坏 90+ 测试文件）。

---

## 6. 决策记录（不要自行更改）

| 决策 | 理由 |
|------|------|
| 角色**并入** Agent 而非互相引用（Agent 不持有 characterId 外键） | 单用户本地应用，间接层只会增加两处编辑困惑 |
| 迁移沿用角色原 id | 旧会话 `characterId` 无需数据迁移即可当 `agentId` 使用 |
| `ChatSession.characterId` 保留为别名而非删除 | 导入导出格式兼容（`conversationExport` 已在用户侧有历史导出文件） |
| 迁移一次性 + localStorage 标记 | 防止用户删除后每次启动复活 |
| name 级去重 | 默认种子 `assistant`(季莹莹) 与既有安装里 `agent-jyy` 人设重复，避免双「季莹莹」再叠一层 |
| `nuwa-character` 库不删除 | 保留回滚路径；后续版本再清理 |
| 「从角色导入」按钮删除 | 迁移后语义消失 |
| `lib/character.ts` / `lib/characterDb.ts` 保留 | 前者被 `lib/agent.ts` 复用，后者迁移要读 |
| 提示词页不动 | 它是消息素材，与人设正交 |

## 7. 明确不做

- 不做角色/Agent 的服务端持久化（维持前端 IndexedDB）
- 不改后端 `agent_scheduler` 与任何 API
- 不做 Agent 分享/市场
- 不引入 `lib/workflow` 画布编辑器（Agent 步骤列表已够用）
- 不改声音工坊、录音转写、模型管理

## 8. 验收清单

- [x] 首页无「角色管理」卡片；`/characters` 重定向到 `/agents`
- [x] 老用户自建角色启动后出现在 Agent 列表（local 类型），删除后重启不复活
- [x] 新会话/切会话/中途换 Agent 三条绑定规则符合 3.2
- [x] Chat 的 system prompt 与 TTS 音色完全来自当前 Agent
- [x] 旧导出 JSON 能导入且会话正确绑定 Agent
- [x] `tsc` / `vitest` / `eslint` 全绿
