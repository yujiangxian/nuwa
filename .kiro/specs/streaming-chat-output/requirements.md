# Requirements Document

## Introduction

「流式对话输出」(streaming-chat-output) 特性把女娲 Nuwa 对话页（Chat_Page）的 AI 回复，从「等待完整生成后一次性显示」改为「逐块流式显示」，让 assistant 消息随 Ollama 生成的 token 增量渲染（打字机效果），提升交互即时感。

本特性为纯增量增强：后端 Voxcpm_Server 新增一个流式对话接口 `POST /api/chat/stream`，转发 Ollama 的 `stream:true` 请求并把 Ollama 返回的 NDJSON 流逐块下发给前端；既有非流式接口 `POST /api/chat` 的请求与响应契约保持不变，作为降级路径保留。前端 Nuwa_Web 在 Chat_Page 改用流式消费替换原有一次性 `apiClient.post('/api/chat')` 调用：发送后立即出现一个「生成中」的 assistant 占位消息，随 token 到达增量更新其内容，完成（或被停止）后定型为最终消息。

本特性必须与两个已交付特性集成且不回归：
- chat-session-persistence（会话历史持久化）：流式完成或停止后，最终 assistant 消息通过 Chat_Store 的 `appendMessage` 等价路径持久化；用户消息照常持久化；流式过程中的中间态不逐 token 持久化。
- voice-interaction-loop（语音交互闭环）：autoPlay 开启时，在流式生成完成后对最终文本做一次 TTS 朗读，而不在生成过程中逐字朗读。

本特性覆盖以下相互关联的目标，作为一个整体交付：

1. 后端流式接口：新增 `POST /api/chat/stream`，转发 Ollama `stream:true`，逐块下发增量 token 与结束标志，错误也能在流中传达；保留 `POST /api/chat` 不变。
2. 前端流式渲染：发送后立即出现「生成中」占位消息，随 token 增量更新（打字机效果），完成后定型。
3. 停止生成：生成中可停止（中断流），停止后保留已生成的部分内容作为最终消息。
4. 与持久化集成：流式完成或停止后最终 assistant 消息持久化，用户消息照常持久化，中间态不逐 token 持久化。
5. 与 TTS 集成：autoPlay 时在流式完成后对最终文本朗读一次。
6. 错误与降级：流式接口不可用或出错时展示错误并退出生成态；Ollama 未启动时给出友好提示；流式失败时可降级到非流式 `POST /api/chat`。
7. 无回归：模型选择回退、对话历史持久化、语音输入/朗读、模型管理与下载等既有功能不受影响，且不破坏 `POST /api/chat` 既有契约。

## Glossary

- **Nuwa_Web**: 前端 React 19 + Vite 应用，源码位于 `app/web/src`。
- **Voxcpm_Server**: 后端 Rust + Axum 服务（crate `voxcpm-server`），监听 8080，源码位于 `backend/server/src`。
- **Chat_Page**: Nuwa_Web 的「对话」页面，组件 `app/web/src/components/ChatPage.tsx`。
- **Chat_Store**: Nuwa_Web 的全局状态存储（Zustand），位于 `app/web/src/store/uiStore.ts`，提供 `messages`、`appendMessage` 等。
- **Chat_Message**: 一条消息记录，字段为 `{ id, role, content, audioUrl?, voiceName?, duration? }`。
- **Ollama**: 本地大模型推理服务，HTTP 端点为 `http://localhost:11434`，对话端点为 `http://localhost:11434/api/chat`。
- **Ollama_Stream**: Ollama 在请求体 `stream:true` 时返回的响应流，按 NDJSON 编码，每行一个 JSON 对象，含 `message.content` 增量与 `done` 布尔标志。
- **Chat_Endpoint**: 既有非流式对话接口 `POST /api/chat`，请求体 `{ messages, model?, system? }`，响应 `{ role, content, model, done }`，错误响应 `{ error }`。
- **Stream_Endpoint**: 本特性新增的流式对话接口 `POST /api/chat/stream`，转发 Ollama `stream:true` 并向 Nuwa_Web 逐块下发增量内容。
- **Stream_Chunk**: Stream_Endpoint 下发给 Nuwa_Web 的单个数据块，承载本次增量文本（`delta`）、结束标志（`done`）或错误信息（`error`）之一。
- **Stream_Reader**: Nuwa_Web 中消费 Stream_Endpoint 响应流的客户端逻辑（基于 `fetch` + `ReadableStream`），负责按块解析并触发增量渲染。
- **Streaming_Message**: Chat_Page 在流式生成期间展示的 assistant Chat_Message，处于「生成中」状态并随 Stream_Chunk 增量更新其 `content`。
- **Placeholder_Message**: Streaming_Message 在尚无任何增量内容时的初始空内容形态（显示生成中指示）。
- **Final_Message**: 流式生成正常完成或被用户停止后定型的 assistant Chat_Message。
- **Stop_Action**: 用户在生成过程中触发停止生成的操作（Chat_Page 停止按钮 `handleStop`，经 AbortController 中断流）。
- **Generating_State**: Chat_Page 表示「正在生成回复」的状态（对应 `isTyping` 等价状态），期间禁止再次发送。
- **Model_Selection**: Voxcpm_Server 选择对话模型的回退顺序：`current_llm_model` → `current_model_id` → 请求体 `model`（默认 `gemma4:e4b`）。
- **Fallback_Strategy**: 当 Stream_Endpoint 无法建立流式连接或在产生任何内容前失败时，Nuwa_Web 改用 Chat_Endpoint 完成本次回复的降级策略。
- **System_Prompt**: 当前 Character 的 `systemPrompt`，随对话请求作为 `system` 字段传给后端。
- **Voice_Loop**: 已交付的「语音交互闭环」能力，含麦克风语音输入（ASR）与 assistant 回复 TTS 朗读（autoPlay）。
- **Session_Persistence**: 已交付的「会话历史持久化」能力，由 Chat_Store 的 `appendMessage` 等价路径将消息与会话持久化到本地存储。

## Requirements

### Requirement 1: 后端流式对话接口

**User Story:** 作为女娲用户，我想让后端以流式方式转发模型生成的内容，以便前端能够逐块接收并即时显示回复。

#### Acceptance Criteria

1. THE Voxcpm_Server SHALL 提供 `POST /api/chat/stream` 接口（Stream_Endpoint），接受与 Chat_Endpoint 相同结构的请求体 `{ messages, model?, system? }`。
2. WHEN Stream_Endpoint 收到一个对话请求，THE Voxcpm_Server SHALL 按 Model_Selection 的回退顺序确定对话模型。
3. WHEN Stream_Endpoint 处理一个对话请求，THE Voxcpm_Server SHALL 向 Ollama 端点 `http://localhost:11434/api/chat` 发送请求体 `{ model, messages, stream: true }`，其中 `messages` 在存在 System_Prompt 时以一条 `role:"system"` 消息作为首条。
4. WHEN Ollama 返回 Ollama_Stream，THE Voxcpm_Server SHALL 逐行解析 NDJSON，并将每行中的 `message.content` 作为增量文本通过 Stream_Chunk 下发给 Nuwa_Web。
5. WHEN Ollama_Stream 中某一行的 `done` 为 `true`，THE Voxcpm_Server SHALL 下发一个标记结束的 Stream_Chunk 并结束响应流。
6. IF Voxcpm_Server 无法连接 Ollama，THEN THE Voxcpm_Server SHALL 通过 Stream_Chunk 下发一条包含友好提示且指明 Ollama 未启动或模型未加载的错误信息。
7. IF Ollama 返回非成功状态码，THEN THE Voxcpm_Server SHALL 通过 Stream_Chunk 下发一条包含 Ollama 错误内容的错误信息并结束响应流。
8. THE Voxcpm_Server SHALL 保持 Chat_Endpoint 的请求与响应契约不变。

### Requirement 2: 前端流式渲染（打字机效果）

**User Story:** 作为女娲用户，我想在发送消息后立即看到回复逐字出现，以便获得即时的对话反馈。

#### Acceptance Criteria

1. WHEN 用户在 Chat_Page 发送一条文本消息，THE Chat_Page SHALL 进入 Generating_State 并立即在消息列表末尾展示一条 assistant Placeholder_Message。
2. WHEN Stream_Reader 接收到携带增量文本的 Stream_Chunk，THE Chat_Page SHALL 将该增量文本按到达顺序追加到 Streaming_Message 的 `content` 并更新渲染。
3. WHILE Chat_Page 处于 Generating_State，THE Chat_Page SHALL 禁止发起新的对话发送操作。
4. WHEN Stream_Reader 接收到标记结束的 Stream_Chunk，THE Chat_Page SHALL 将 Streaming_Message 定型为 Final_Message 并退出 Generating_State。
5. WHEN Stream_Reader 完成消费流，THE Chat_Page SHALL 使 Final_Message 的 `content` 等于所有已接收增量文本按到达顺序拼接的结果。
6. THE Chat_Page SHALL 通过 `fetch` 配合 `ReadableStream` 消费 Stream_Endpoint 的响应流。

### Requirement 3: 停止生成

**User Story:** 作为女娲用户，我想在回复生成过程中随时停止，以便不必等待我已不需要的内容并保留已生成的部分。

#### Acceptance Criteria

1. WHILE Chat_Page 处于 Generating_State，THE Chat_Page SHALL 提供 Stop_Action 入口。
2. WHEN 用户触发 Stop_Action，THE Chat_Page SHALL 通过 AbortController 中断对 Stream_Endpoint 的请求并停止消费后续 Stream_Chunk。
3. WHEN 用户触发 Stop_Action，THE Chat_Page SHALL 将 Streaming_Message 已接收的增量文本作为 Final_Message 的 `content` 予以保留。
4. WHEN Stop_Action 完成，THE Chat_Page SHALL 退出 Generating_State。
5. IF Stop_Action 触发时 Streaming_Message 尚无任何增量文本，THEN THE Chat_Page SHALL 移除该 Placeholder_Message 而不产生空内容的 Final_Message。

### Requirement 4: 与会话持久化集成

**User Story:** 作为女娲用户，我想让流式生成的回复在完成或停止后被保存，以便刷新或重启后仍能看到完整对话历史。

#### Acceptance Criteria

1. WHEN 用户在 Chat_Page 发送一条文本消息，THE Chat_Page SHALL 通过 Chat_Store 的 `appendMessage` 等价路径将该用户 Chat_Message 持久化（沿用 Session_Persistence）。
2. WHEN 流式生成正常完成，THE Chat_Page SHALL 通过 Chat_Store 的 `appendMessage` 等价路径将 Final_Message 持久化。
3. WHEN 用户通过 Stop_Action 停止生成且 Final_Message 含非空内容，THE Chat_Page SHALL 通过 Chat_Store 的 `appendMessage` 等价路径将 Final_Message 持久化。
4. WHILE 流式生成进行中，THE Chat_Page SHALL 不对 Streaming_Message 的每个增量进行持久化写入。
5. THE Chat_Page SHALL 在持久化 Final_Message 时复用 Session_Persistence 既有的会话 `updatedAt` 更新与首条用户消息自动标题行为。

### Requirement 5: 与 TTS 朗读集成

**User Story:** 作为女娲用户，我想在开启自动朗读时听到完整回复被朗读一次，以便获得连贯的语音体验而非逐字断续。

#### Acceptance Criteria

1. WHERE autoPlay 处于开启状态，WHEN 流式生成正常完成，THE Chat_Page SHALL 对 Final_Message 的完整文本触发一次 TTS 朗读。
2. WHILE 流式生成进行中，THE Chat_Page SHALL 不对 Streaming_Message 的增量内容触发 TTS 朗读。
3. WHERE autoPlay 处于关闭状态，WHEN 流式生成完成，THE Chat_Page SHALL 不自动触发 TTS 朗读。
4. WHEN 用户通过 Stop_Action 停止生成且 Final_Message 含非空内容且 autoPlay 处于开启状态，THE Chat_Page SHALL 对 Final_Message 的文本触发一次 TTS 朗读。

### Requirement 6: 错误处理与降级

**User Story:** 作为女娲用户，我想在流式回复出错或服务未就绪时得到清晰提示并仍能获得回复，以便对话不被中断。

#### Acceptance Criteria

1. WHEN Stream_Reader 接收到携带错误信息的 Stream_Chunk，THE Chat_Page SHALL 展示该错误信息并退出 Generating_State。
2. IF Nuwa_Web 在产生任何增量文本之前无法建立到 Stream_Endpoint 的流式连接，THEN THE Chat_Page SHALL 按 Fallback_Strategy 改用 Chat_Endpoint 完成本次回复。
3. WHEN Fallback_Strategy 经 Chat_Endpoint 成功返回回复，THE Chat_Page SHALL 将该回复作为 Final_Message 渲染并按 Requirement 4 持久化。
4. IF Fallback_Strategy 经 Chat_Endpoint 仍然失败，THEN THE Chat_Page SHALL 展示错误提示并退出 Generating_State。
5. IF 错误信息源于无法连接 Ollama，THEN THE Chat_Page SHALL 展示指明 Ollama 未启动或模型未加载的友好提示。
6. WHEN 流式生成因错误而退出 Generating_State 且尚无任何增量文本，THE Chat_Page SHALL 移除对应的 Placeholder_Message。

### Requirement 7: 无回归约束

**User Story:** 作为女娲维护者，我想确保引入流式输出后既有功能保持可用，以便本特性以纯增量方式安全交付。

#### Acceptance Criteria

1. THE Voxcpm_Server SHALL 在本特性变更后保持 Chat_Endpoint（`POST /api/chat`）的请求与响应契约可正常使用。
2. THE Voxcpm_Server SHALL 在本特性变更后保持 Model_Selection 的回退顺序行为不变。
3. THE Chat_Page SHALL 在本特性变更后保持 Voice_Loop 的麦克风语音输入功能可正常使用。
4. THE Chat_Page SHALL 在本特性变更后保持 Voice_Loop 的手动 TTS 朗读功能可正常使用。
5. THE Nuwa_Web SHALL 在本特性变更后保持 Session_Persistence 的会话新建、切换、删除、重命名与历史恢复功能可正常使用。
6. THE Nuwa_Web SHALL 在本特性变更后保持模型管理与模型下载相关功能可正常使用。
