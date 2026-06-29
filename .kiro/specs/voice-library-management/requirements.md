# Requirements Document

## Introduction

「音色库管理」(voice-library-management) 特性在已交付的 voice-interaction-loop 之上做增强，目标是让用户能够端到端地管理 TTS 参考音色库：上传本地音频或浏览器录音、标注参考文本与名称，保存为可复用的参考音色（Reference_Voice），并在声音工坊与对话页中选用；同时支持音色库列表展示、试听、删除，以及音色数据持久化（服务重启后保留）。

本特性需要补齐当前参考音色能力的三处缺口：

1. 现有 `POST /api/voices` 仅把 JSON 元数据压入内存数组，既不接收音频文件，也不持久化；本特性引入 multipart 音频上传与磁盘登记。
2. 现有参考音色不从磁盘扫描、服务重启即丢失；本特性引入元数据持久化与启动恢复。
3. 现有 `DELETE /api/voices/{id}` 仅从内存移除、不删除磁盘音频文件；本特性让删除同时清理磁盘文件，并在前端做二次确认。

本特性还需与 voice-interaction-loop 已实现的「TTS 使用所选音色的 `path` 作为 `ref_audio`、`transcript` 作为 `ref_text`」无缝集成，且不得回归对话、模型管理、下载等既有功能，以及 `GET /api/voices` 既有消费方。后端推理脚本与 Python 引擎不在本特性范围内。

## Glossary

- **Nuwa_Web**: 前端 React 19 + Vite 应用，源码位于 `app/web/src`。
- **Voice_Backend**: 后端 Rust + Axum 服务（crate `voxcpm-server`），监听 `http://localhost:8080`，源码位于 `backend/server/src`。
- **Voice_Library**: 由 Voice_Backend 管理的参考音色集合，每个条目为一个 Reference_Voice。
- **Reference_Voice**: 参考音色条目，含 `id`、`name`、`path`、`transcript`、`sample_rate`、`duration_seconds`，其音频文件存放于 Voices_Directory，用于 TTS 的 `ref_audio` 与 `ref_text`。
- **Voices_Directory**: Voice_Backend 配置项 `voices_dir`（默认 `assets/datasets/voices`）所指向的目录，用于存放 Reference_Voice 的音频文件与元数据。
- **Voice_Library_Store**: Voice_Library 元数据的磁盘持久化载体，使 Reference_Voice 在 Voice_Backend 重启后保留。
- **Voice_Studio**: Nuwa_Web 的「声音工坊」页面，路由 `/voice`，组件 `VoiceStudioPage`，含「声音库」与「声音克隆」两个 Tab。
- **Chat_Page**: Nuwa_Web 的「对话」页面，路由 `/chat`，组件 `ChatPage`。
- **Upload_Endpoint**: Voice_Backend 接收参考音频与元数据的 multipart 接口 `POST /api/voices/upload`，字段含 `audio`（音频文件）、`name`（音色名称）、`transcript`（参考文本）。
- **Voice_Audio_Endpoint**: Voice_Backend 提供 Reference_Voice 音频用于试听的接口 `GET /api/voices/{id}/audio`。
- **List_Endpoint**: Voice_Backend 返回 Voice_Library 全部 Reference_Voice 的接口 `GET /api/voices`。
- **Delete_Endpoint**: Voice_Backend 删除指定 Reference_Voice 的接口 `DELETE /api/voices/{id}`。
- **Supported_Audio_Format**: Upload_Endpoint 接受的音频文件扩展名集合：`.wav`、`.mp3`、`.m4a`、`.flac`、`.ogg`、`.webm`。
- **Max_Upload_Size**: Upload_Endpoint 接受的单个音频文件大小上限，为 20 MB。
- **TTS_Engine**: Voice_Backend 经 Python 子进程调用的语音合成能力，HTTP 入口为 `POST /api/inference/tts`，其 `ref_audio`/`ref_text` 取自所选 Reference_Voice。

## Requirements

### Requirement 1: 上传或录制参考音频以创建音色

**User Story:** 作为女娲用户，我想上传本地音频文件或用浏览器录音并标注名称与参考文本，把语音保存为可复用的参考音色，以便在合成与对话中选用。

#### Acceptance Criteria

1. THE Voice_Studio SHALL 在「声音克隆」Tab 提供选择本地音频文件、填写音色名称、填写参考文本，以及提交创建参考音色的功能性控件。
2. WHEN 用户在 Voice_Studio 选择本地音频文件并填写音色名称与参考文本后提交创建，THE Voice_Studio SHALL 以 multipart 形式向 Upload_Endpoint 提交 `audio`、`name`、`transcript` 字段。
3. WHEN 用户在 Voice_Studio 完成一次浏览器录音并填写音色名称与参考文本后提交创建，THE Voice_Studio SHALL 将录制音频以 multipart 字段 `audio` 向 Upload_Endpoint 提交，并附带 `name` 与 `transcript` 字段。
4. WHEN Upload_Endpoint 接收到一个扩展名属于 Supported_Audio_Format 且大小不超过 Max_Upload_Size 的音频文件，THE Voice_Backend SHALL 将该音频文件写入 Voices_Directory，并登记一条 Reference_Voice，其 `path` 指向该已保存音频文件。
5. WHEN Voice_Backend 登记一条新的 Reference_Voice，THE Voice_Backend SHALL 为该 Reference_Voice 分配在 Voice_Library 内唯一的 `id`，并记录提交的 `name` 与 `transcript`。
6. WHEN Voice_Backend 保存一个音频文件为 Reference_Voice，THE Voice_Backend SHALL 记录该音频的 `sample_rate` 与 `duration_seconds`。
7. WHEN Upload_Endpoint 成功创建一条 Reference_Voice，THE Voice_Backend SHALL 返回该 Reference_Voice 的完整元数据，且该元数据可被后续 List_Endpoint 返回。
8. WHEN Upload_Endpoint 成功创建一条 Reference_Voice，THE Voice_Studio SHALL 刷新音色库展示，使新建的 Reference_Voice 出现在列表中。

### Requirement 2: 音色库持久化与启动恢复

**User Story:** 作为女娲用户，我想让已创建的参考音色在服务重启后依然存在，以便长期复用我的音色库。

#### Acceptance Criteria

1. WHEN Voice_Backend 创建、修改或删除一条 Reference_Voice，THE Voice_Backend SHALL 将 Voice_Library 元数据写入 Voice_Library_Store。
2. WHEN Voice_Backend 启动，THE Voice_Backend SHALL 从 Voice_Library_Store 与 Voices_Directory 恢复 Voice_Library，使重启前已存在的 Reference_Voice 可被 List_Endpoint 返回。
3. IF Voice_Library_Store 在 Voice_Backend 启动时不存在或为空，THEN THE Voice_Backend SHALL 以空的 Voice_Library 启动且不产生启动错误。
4. IF Voice_Library_Store 中某条 Reference_Voice 的 `path` 在 Voices_Directory 中对应的音频文件已不存在，THEN THE Voice_Backend SHALL 在恢复时跳过该条目，使 List_Endpoint 仅返回音频文件可用的 Reference_Voice。
5. WHEN Voice_Backend 在启动时于 Voices_Directory 发现尚未登记到 Voice_Library_Store 的扩展名属于 Supported_Audio_Format 的音频文件，THE Voice_Backend SHALL 为每个此类文件登记一条 Reference_Voice，以文件名（去扩展名）作为 `name`、空字符串作为 `transcript`。

### Requirement 3: 音色库列表展示与试听

**User Story:** 作为女娲用户，我想浏览音色库中的参考音色并试听其参考音频，以便确认与选择合适的音色。

#### Acceptance Criteria

1. THE Voice_Studio SHALL 从 List_Endpoint 获取 Voice_Library 并展示每条 Reference_Voice 的 `name`、`transcript` 与 `sample_rate`。
2. WHERE 某条 Reference_Voice 含 `duration_seconds`，THE Voice_Studio SHALL 展示该 Reference_Voice 的时长。
3. WHILE List_Endpoint 请求处于等待响应状态，THE Voice_Studio SHALL 显示音色加载中的状态。
4. WHEN List_Endpoint 返回的 Voice_Library 为空，THE Voice_Studio SHALL 展示音色库为空的提示信息。
5. WHEN 用户对某条 Reference_Voice 触发试听，THE Voice_Studio SHALL 通过 Voice_Audio_Endpoint 加载该 Reference_Voice 的音频并播放。
6. WHEN Voice_Audio_Endpoint 收到指向某条已存在 Reference_Voice 的请求，THE Voice_Backend SHALL 返回该 Reference_Voice 在 Voices_Directory 中的音频文件内容及其对应的音频 MIME 类型。
7. IF Voice_Audio_Endpoint 收到的 `id` 在 Voice_Library 中不存在，THEN THE Voice_Backend SHALL 返回未找到状态码且不返回音频内容。
8. WHILE 一条 Reference_Voice 的试听音频正在播放，WHEN 用户再次触发同一 Reference_Voice 的试听控件，THE Voice_Studio SHALL 停止该 Reference_Voice 的播放。

### Requirement 4: 删除参考音色

**User Story:** 作为女娲用户，我想删除不再需要的参考音色并连同其音频文件一起清理，以便保持音色库整洁。

#### Acceptance Criteria

1. WHEN 用户在 Voice_Studio 对某条 Reference_Voice 触发删除，THE Voice_Studio SHALL 先展示二次确认提示，且在用户确认前不调用 Delete_Endpoint。
2. WHEN 用户在二次确认提示中确认删除，THE Voice_Studio SHALL 调用 Delete_Endpoint 并传入该 Reference_Voice 的 `id`。
3. IF 用户在二次确认提示中取消删除，THEN THE Voice_Studio SHALL 保留该 Reference_Voice 且不调用 Delete_Endpoint。
4. WHEN Delete_Endpoint 收到指向某条已存在 Reference_Voice 的请求，THE Voice_Backend SHALL 从 Voice_Library 移除该 Reference_Voice 并删除其在 Voices_Directory 中对应的音频文件。
5. WHEN Voice_Backend 删除一条 Reference_Voice，THE Voice_Backend SHALL 将更新后的 Voice_Library 写入 Voice_Library_Store，使该 Reference_Voice 在服务重启后不再出现。
6. IF Delete_Endpoint 收到的 `id` 在 Voice_Library 中不存在，THEN THE Voice_Backend SHALL 返回成功响应且不改变 Voice_Library。
7. WHEN Delete_Endpoint 返回成功，THE Voice_Studio SHALL 刷新音色库展示，使被删除的 Reference_Voice 不再出现在列表中。

### Requirement 5: 在声音工坊与对话页选用音色库音色

**User Story:** 作为女娲用户，我想在声音工坊与对话页中选用音色库里的参考音色用于 TTS，以便复用我管理的音色而不破坏既有语音功能。

#### Acceptance Criteria

1. THE Voice_Studio SHALL 从 List_Endpoint 提供可选的 Reference_Voice 列表供用户选择用于合成。
2. WHERE 用户在 Voice_Studio 选择了某条 Reference_Voice，THE Voice_Studio SHALL 在调用 `POST /api/inference/tts` 时以该 Reference_Voice 的 `path` 作为 `ref_audio`、`transcript` 作为 `ref_text`。
3. THE Chat_Page SHALL 从 List_Endpoint 获取 Reference_Voice 列表用于解析当前 Character 绑定音色对应的 `ref_audio` 与 `ref_text`。
4. WHEN Voice_Library 中新增一条 Reference_Voice，THE Voice_Studio SHALL 使该 Reference_Voice 可被选择用于合成。
5. WHEN List_Endpoint 返回的 Reference_Voice 字段集合较 voice-interaction-loop 交付时新增字段，THE Voice_Backend SHALL 保持 `id`、`name`、`path`、`transcript`、`sample_rate` 字段语义不变，使既有 `GET /api/voices` 消费方不回归。

### Requirement 6: 上传校验、错误处理与无回归约束

**User Story:** 作为女娲用户与维护者，我想在上传不合法或操作失败时得到清晰反馈，并确保既有功能不被破坏，以便系统在本特性交付后保持稳定可用。

#### Acceptance Criteria

1. IF 用户在 Voice_Studio 未选择音频文件或未完成录音即提交创建，THEN THE Voice_Studio SHALL 立即展示需要提供音频的提示信息且不调用 Upload_Endpoint，且该校验独立于音色名称与参考文本是否已填写。
2. IF 用户在 Voice_Studio 未填写音色名称即提交创建，THEN THE Voice_Studio SHALL 展示需要填写名称的提示信息且不调用 Upload_Endpoint。
3. IF Upload_Endpoint 收到的音频文件扩展名不属于 Supported_Audio_Format，THEN THE Voice_Backend SHALL 返回描述不支持格式的错误且不创建 Reference_Voice。
4. IF Upload_Endpoint 收到的音频文件大小超过 Max_Upload_Size，THEN THE Voice_Backend SHALL 返回描述文件过大的错误且不创建 Reference_Voice。
5. IF Upload_Endpoint 返回错误响应，THEN THE Voice_Studio SHALL 展示返回的错误文本且不将新条目加入音色库展示。
6. IF 对 Voice_Backend 的音色库请求发生网络错误或返回非成功响应，THEN THE Nuwa_Web SHALL 展示错误提示并退出加载状态。
7. THE Nuwa_Web SHALL 在本特性变更后保持对话功能（`POST /api/chat`）可正常使用。
8. THE Nuwa_Web SHALL 在本特性变更后保持模型管理功能（`GET /api/models`、`POST /api/models/scan`、`POST /api/config/set-model`）可正常使用。
9. THE Nuwa_Web SHALL 在本特性变更后保持模型下载功能（`/api/downloads/*`）可正常使用。
