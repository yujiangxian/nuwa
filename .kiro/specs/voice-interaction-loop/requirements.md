# Requirements Document

## Introduction

「语音交互闭环」(voice-interaction-loop) 特性把女娲 Nuwa 平台已有但割裂的语音能力整合为一个端到端可用的有机整体，并清理历史 VoxCPM 遗留代码。后端 ASR/TTS 推理引擎（Rust 经 Python 子进程调用）已就绪且不在本特性重写范围内；本特性聚焦前端 React 与后端 Rust 的对接、配置统一与死代码清理。

本特性覆盖六个相互关联的目标，作为一个整体交付：

1. 把占位的「录音转写」页面替换为可用页面（浏览器录音/上传 → ASR → 展示转写文字）。
2. 让「声音工坊」语音合成接通真实 TTS 接口（`/api/inference/tts`），支持选择 TTS 模型与参考音色，移除 VoxCPM 专有参数。
3. 打通「对话页」语音闭环：麦克风语音输入（ASR）+ assistant 回复用选定音色 TTS 朗读。
4. 统一 ASR/TTS 引擎的当前模型选择与持久化，并把前端后端地址默认值修正为 8080。
5. 清理 VoxCPM 遗留：废弃后端 `services/voxcpm.rs` 与 `POST /api/tts/generate` 死接口，移除前端 `voxcpm_*` 配置字段、`GenerationMode`/`current_mode`/`default_cfg`/`default_timesteps` 以及对死接口的调用。
6. 在以上变更中保证统一的错误处理与现有可用功能（对话、模型管理、下载）不回归，且所有推理仅经后端 `/api/inference/*` 完成。

## Glossary

- **Nuwa_Web**: 前端 React 19 + Vite 应用，源码位于 `app/web/src`。
- **Voice_Backend**: 后端 Rust + Axum 服务（crate `voxcpm-server`），监听 `http://localhost:8080`，源码位于 `backend/server/src`。
- **ASR_Engine**: Voice_Backend 经 Python 子进程调用的语音识别能力，HTTP 入口为 `POST /api/inference/asr` 与 `POST /api/inference/asr/upload`。
- **TTS_Engine**: Voice_Backend 经 Python 子进程调用的语音合成能力，HTTP 入口为 `POST /api/inference/tts`。
- **Transcribe_Page**: Nuwa_Web 的「录音转写」页面，路由 `/transcribe`，当前为占位组件。
- **Voice_Studio**: Nuwa_Web 的「声音工坊」页面，路由 `/voice`，组件 `VoiceStudioPage`。
- **Chat_Page**: Nuwa_Web 的「对话」页面，路由 `/chat`，组件 `ChatPage`。
- **Config_Store**: Voice_Backend 的应用配置（`AppConfig`），经 `GET/POST /api/config` 与 `POST /api/config/set-model` 读写，并持久化到磁盘。
- **Current_ASR_Model**: Config_Store 中记录的当前 ASR 模型 ID（如 `asr/paraformer-large`），存于 `current_models["asr"]` 并兼容旧字段 `current_asr_model`。
- **Current_TTS_Model**: Config_Store 中记录的当前 TTS 模型 ID（如 `tts/cosyvoice3`），存于 `current_models["tts"]` 并兼容旧字段 `current_tts_model`。
- **Reference_Voice**: 参考音色条目，来自 `GET /api/voices`，含 `id`、`name`、`path`、`transcript`，用于 TTS 的 `ref_audio` 与 `ref_text`。
- **Transcription_Text**: ASR_Engine 对输入音频识别得到的文字结果。
- **Synthesized_Audio**: TTS_Engine 合成的音频文件，经 `GET /api/audio/{filename}` 提供。
- **Auto_Play_Setting**: Nuwa_Web 设置项 `autoPlay`，控制 assistant 回复是否自动 TTS 朗读播放。
- **VoxCPM_Legacy**: 历史 VoxCPM 相关死代码与字段，包括后端 `services/voxcpm.rs`、`POST /api/tts/generate`、`/api/tts/tasks/*`，以及前端 `voxcpm_tts_path`、`voxcpm_server_path`、`default_cfg`、`default_timesteps`、`GenerationMode`、`current_mode` 等。

## Requirements

### Requirement 1: 录音转写页面

**User Story:** 作为女娲用户，我想在「录音转写」页面通过浏览器录音或上传音频得到文字结果，以便快速把语音转成可编辑文本。

#### Acceptance Criteria

1. THE Nuwa_Web SHALL 在路由 `/transcribe` 渲染功能性的 Transcribe_Page，替换原有占位组件。
2. WHEN 用户在 Transcribe_Page 点击开始录音且浏览器授予麦克风权限，THE Transcribe_Page SHALL 开始采集麦克风音频并显示录音进行中的状态。
3. WHEN 用户在 Transcribe_Page 停止录音，THE Transcribe_Page SHALL 将录制音频以 multipart 字段 `audio` 提交至 `POST /api/inference/asr/upload`。
4. WHEN 用户在 Transcribe_Page 选择本地音频文件并提交，THE Transcribe_Page SHALL 将该文件以 multipart 字段 `audio` 提交至 `POST /api/inference/asr/upload`。
5. WHEN `POST /api/inference/asr/upload` 返回 `success` 为 true，THE Transcribe_Page SHALL 展示返回的 Transcription_Text 以及本次请求所用模型与耗时（单位毫秒）。
6. IF `POST /api/inference/asr/upload` 返回 `success` 为 false，THEN THE Transcribe_Page SHALL 展示返回的 `error` 文本且不展示 Transcription_Text。
7. IF 浏览器拒绝麦克风权限或麦克风不可用，THEN THE Transcribe_Page SHALL 展示无法访问麦克风的提示信息并保留文件上传方式作为替代。
8. WHEN Transcription_Text 已展示且用户触发复制操作，THE Transcribe_Page SHALL 将 Transcription_Text 写入系统剪贴板。
9. WHILE ASR 请求处于等待响应状态，THE Transcribe_Page SHALL 显示识别处理中的状态并禁用重复提交。
10. THE Nuwa_Web SHALL 在首页将「录音转写」入口标记为可用并允许导航至 Transcribe_Page。

### Requirement 2: 声音工坊接通真实 TTS

**User Story:** 作为女娲用户，我想在「声音工坊」用选定的 TTS 模型和参考音色把文本合成为语音并播放，以便生成自定义语音。

#### Acceptance Criteria

1. WHEN 用户在 Voice_Studio 输入合成文本并触发合成，THE Voice_Studio SHALL 调用 `POST /api/inference/tts` 而非已停用的 `POST /api/tts/generate`，并提交 `text`、`model_id`、`ref_audio`、`ref_text` 字段。
2. WHEN Voice_Studio 调用 `POST /api/inference/tts`，THE Voice_Studio SHALL 以 Current_TTS_Model 作为 `model_id` 字段值。
3. WHERE 用户在 Voice_Studio 选择了某个 Reference_Voice，THE Voice_Studio SHALL 将该 Reference_Voice 的 `path` 作为 `ref_audio`、`transcript` 作为 `ref_text` 提交至 `POST /api/inference/tts`。
4. THE Voice_Studio SHALL 从 `GET /api/voices` 获取并展示可选的 Reference_Voice 列表。
5. WHEN `POST /api/inference/tts` 返回 `success` 为 true 且包含 `output_path`，THE Voice_Studio SHALL 通过 `GET /api/audio/{output_path}` 加载并提供 Synthesized_Audio 的播放控件。
6. WHERE Auto_Play_Setting 为开启状态，WHEN Synthesized_Audio 加载完成，THE Voice_Studio SHALL 自动播放 Synthesized_Audio。
7. IF `POST /api/inference/tts` 返回 `success` 为 false，THEN THE Voice_Studio SHALL 展示返回的 `error` 文本且不提供音频播放。
8. THE Voice_Studio SHALL 从合成界面移除 `cfg`、`timesteps`、`seed` 以及生成模式（VoiceDesign/ControllableClone/UltimateClone）等 VoxCPM 专有参数控件。
9. WHILE TTS 请求处于等待响应状态，THE Voice_Studio SHALL 显示合成处理中的状态并禁用重复提交。

### Requirement 3: 对话页语音闭环

**User Story:** 作为女娲用户，我想在对话页用语音说话作为输入，并让 AI 回复用我选定的音色朗读出来，以便进行端到端的语音对话。

#### Acceptance Criteria

1. WHEN 用户在 Chat_Page 完成一次麦克风录音，THE Chat_Page SHALL 将录制音频以 multipart 字段 `audio` 提交至 `POST /api/inference/asr/upload`，并以 Current_ASR_Model 作为 `model_id` 字段值。
2. WHEN `POST /api/inference/asr/upload` 返回 `success` 为 true，THE Chat_Page SHALL 将返回的 Transcription_Text 填入对话输入框。
3. WHILE Auto_Play_Setting 为开启状态，WHEN Chat_Page 收到一条 assistant 回复消息，THE Chat_Page SHALL 以该消息文本调用 `POST /api/inference/tts`，并附带当前 Character 绑定音色对应的 `ref_audio` 与 `ref_text`，且以 Current_TTS_Model 作为 `model_id` 字段值。
4. WHEN 朗读请求返回 `success` 为 true 且包含 `output_path` 且 Auto_Play_Setting 为开启状态，THE Chat_Page SHALL 通过 `GET /api/audio/{output_path}` 自动播放 Synthesized_Audio。
5. WHILE Auto_Play_Setting 为关闭状态，WHEN Chat_Page 收到一条 assistant 回复消息，THE Chat_Page SHALL 提供该消息的手动朗读控件且不自动播放。
6. WHEN 用户对某条 assistant 消息触发手动朗读且其 Synthesized_Audio 可用，THE Chat_Page SHALL 播放该消息对应的 Synthesized_Audio。
7. WHILE 一条 assistant 消息的 Synthesized_Audio 正在播放，WHEN 用户再次触发同一消息的朗读控件，THE Chat_Page SHALL 停止该消息的播放。
8. IF ASR 或 TTS 请求返回 `success` 为 false，THEN THE Chat_Page SHALL 展示返回的 `error` 文本。
9. IF 浏览器拒绝麦克风权限或麦克风不可用，THEN THE Chat_Page SHALL 展示无法访问麦克风的提示信息并保留文本输入方式作为替代。
10. WHILE ASR 请求处于等待响应状态，THE Chat_Page SHALL 显示识别处理中的状态并禁用重复的语音输入触发。

### Requirement 4: ASR/TTS 引擎配置与持久化

**User Story:** 作为女娲用户，我想分别选择当前的 ASR 与 TTS 模型并让选择被保存，以便各页面在不显式指定模型时一致地使用我选定的引擎。

#### Acceptance Criteria

1. THE Nuwa_Web SHALL 从 `GET /api/models` 获取模型列表并按模型类型分别展示可选的 ASR 模型与 TTS 模型。
2. WHEN 用户选择某个 ASR 模型，THE Nuwa_Web SHALL 调用 `POST /api/config/set-model` 并提交 `model_type` 为 `asr` 与对应 `model_id`。
3. WHEN 用户选择某个 TTS 模型，THE Nuwa_Web SHALL 调用 `POST /api/config/set-model` 并提交 `model_type` 为 `tts` 与对应 `model_id`。
4. WHEN `POST /api/config/set-model` 处理 ASR 或 TTS 选择，THE Voice_Backend SHALL 将选择写入 `current_models` 并同步到兼容字段 `current_asr_model` 或 `current_tts_model`，且持久化到磁盘使其在服务重启后保留。
5. WHEN Nuwa_Web 加载模型相关界面，THE Nuwa_Web SHALL 从 `GET /api/config` 读取并回显 Current_ASR_Model 与 Current_TTS_Model。
6. WHEN 一个 ASR 请求未显式提供 `model_id`，THE Voice_Backend SHALL 使用 Current_ASR_Model 处理该请求。
7. WHEN 一个 TTS 请求未显式提供 `model_id`，THE Voice_Backend SHALL 使用 Current_TTS_Model 处理该请求。
8. THE Nuwa_Web SHALL 将默认后端地址配置值设为 `http://localhost:8080`。
9. WHEN Nuwa_Web 向 Voice_Backend 发起 API 请求，THE Nuwa_Web SHALL 使用经 Vite 代理处理的 `/api` 前缀路径。

### Requirement 5: 清理 VoxCPM 遗留

**User Story:** 作为女娲平台维护者，我想移除 VoxCPM 历史死代码与无效字段，以便代码库只保留真实可用的接口与配置。

#### Acceptance Criteria

1. THE Voice_Backend SHALL 移除 `POST /api/tts/generate`、`GET /api/tts/tasks/{id}`、`POST /api/tts/tasks/{id}/cancel` 死接口路由及其处理函数。
2. THE Voice_Backend SHALL 移除空实现的 `services/voxcpm.rs` 模块及其模块引用。
3. WHERE VoxCPM_Legacy 后端代码被移除，THE Voice_Backend SHALL 编译成功且无对已移除模块的悬空引用。
4. THE Nuwa_Web SHALL 从前端 `AppConfig` 类型与默认配置中移除 `voxcpm_tts_path`、`voxcpm_server_path`、`default_cfg`、`default_timesteps`、`current_mode` 字段。
5. THE Nuwa_Web SHALL 移除 `GenerationMode` 类型及其在界面中的所有引用。
6. THE Nuwa_Web SHALL 移除调用 `POST /api/tts/generate` 的 `useGenerateTTS` 与 `useGenerationStore`，以及对 `GET /api/tts/tasks/{id}` 的 `useTaskStatus` 死接口轮询。
7. WHERE VoxCPM_Legacy 前端代码已清理，THE Nuwa_Web SHALL 通过 TypeScript 类型检查与构建且无对已移除符号的引用。

### Requirement 6: 错误处理与无回归约束

**User Story:** 作为女娲用户与维护者，我想在引擎未配置或推理失败时得到清晰反馈，并确保现有功能不被破坏，以便系统在本特性交付后保持稳定可用。

#### Acceptance Criteria

1. IF 用户在未配置 ASR 引擎且 Voice_Backend 无可用 ASR 回退的情况下发起转写，THEN THE Nuwa_Web SHALL 展示 ASR_Engine 返回的未选择模型错误信息。
2. IF 用户在未配置 TTS 引擎且 Voice_Backend 无可用 TTS 回退的情况下发起合成，THEN THE Nuwa_Web SHALL 展示 TTS_Engine 返回的未选择模型错误信息。
3. IF 对 Voice_Backend 的推理请求发生网络错误或返回非成功响应，THEN THE Nuwa_Web SHALL 展示错误提示并退出加载状态。
4. WHEN 用户发起任意语音推理操作，THE Nuwa_Web SHALL 仅经由 Voice_Backend 的 `/api/inference/*` 接口完成，且不直接连接 Python 推理进程。
5. THE Nuwa_Web SHALL 在本特性变更后保持对话功能（`POST /api/chat`）可正常使用。
6. THE Nuwa_Web SHALL 在本特性变更后保持模型管理功能（`GET /api/models`、`POST /api/models/scan`、`POST /api/config/set-model`）可正常使用。
7. THE Nuwa_Web SHALL 在本特性变更后保持模型下载功能（`/api/downloads/*`）可正常使用。
