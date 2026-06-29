# Implementation Plan: 语音交互闭环 (voice-interaction-loop)

## Overview

按"先底层（纯函数 / 媒体 hooks / 类型与默认值）→ 再页面接线 → 最后死代码清理与编译验证"的顺序增量实施，保证任意时刻前后端均可编译。新增的 API hooks、媒体封装、纯函数为纯增量改动；页面改造完成后再移除 VoxCPM 遗留符号，最终统一做前端 `npm run build` 与后端 `cargo build/test` 验证。

设计文档使用真实语言（TypeScript + Rust）且明确不含 Correctness Properties 章节，故不包含属性测试；测试以 Vitest 单元测试 + 后端集成/编译验证为主，测试子任务标注 `*` 为可选。

## Tasks

- [x] 1. 搭建前端测试基础设施
  - [x]* 1.1 配置 Vitest 与 React Testing Library
    - 安装 `vitest`、`@testing-library/react`、`@testing-library/jest-dom`、`jsdom` 为 devDependencies
    - 新增 `vitest.config.ts`（`environment: 'jsdom'`、`globals: true`、测试 setup 文件）与 `package.json` 的 `test` 脚本（建议 `vitest --run`）
    - 仅作为后续单测的运行环境，不改动现有源码
    - _Requirements: 5.7_

- [x] 2. 实现底层纯函数、媒体封装与配置默认值
  - [x] 2.1 实现 resolveVoiceRef 纯函数
    - 新建 `app/web/src/lib/voice.ts`，按设计实现 `resolveVoiceRef(voiceId, voices)`：命中返回 `{ ref_audio: path, ref_text: transcript ?? '' }`；未命中或空列表返回 `{ ref_audio: '', ref_text: '' }`
    - _Requirements: 3.3_

  - [x]* 2.2 编写 resolveVoiceRef 单元测试
    - 命中音色返回 path/transcript；未命中或空列表返回空串；`transcript` 为 `null` 时映射为 `''`
    - _Requirements: 3.3_

  - [x] 2.3 实现 useRecorder hook
    - 新建 `app/web/src/hooks/useRecorder.ts`，封装 `MediaRecorder` 生命周期、计时、MIME 协商（`audio/webm`→`audio/mp4`→`audio/ogg`）
    - `getUserMedia` 拒绝/无设备时设置 `error` 且不抛出；`stop()` 在 `onstop` 后停止所有轨道，过短录音（<1KB）返回 `null`
    - 暴露 `{ isRecording, recordingTime, error, start, stop }`
    - _Requirements: 1.2, 1.7, 3.9_

  - [x]* 2.4 编写 useRecorder 单元测试
    - mock `navigator.mediaDevices.getUserMedia`：拒绝时设置 `error` 且不抛出；验证 MIME 回退选择顺序
    - _Requirements: 1.7, 3.9_

  - [x] 2.5 实现 useAudioPlayer hook
    - 新建 `app/web/src/hooks/useAudioPlayer.ts`，管理单实例 `HTMLAudioElement`，暴露 `{ playingKey, play(key,url), stop, isPlaying(key) }`
    - 播放新 key 前自动停止旧实例；同 key 再次 `play` 触发停止；`audio.onerror` 重置播放态
    - _Requirements: 2.6, 3.6, 3.7_

  - [x]* 2.6 编写 useAudioPlayer 单元测试
    - 播放新 key 前停止旧实例；`isPlaying(key)` 状态正确；同 key 再次播放→停止
    - _Requirements: 3.7_

  - [x] 2.7 修正后端地址默认值并增加 localStorage 迁移
    - 修改 `app/web/src/store/uiStore.ts`：`defaultSettings.backendUrl` 由 `http://localhost:9880` 改为 `http://localhost:8080`
    - `loadSettings()` 增加一次性迁移：若读取到旧默认值 `http://localhost:9880` 则覆盖为 `http://localhost:8080`，自定义地址不覆盖
    - _Requirements: 4.8_

  - [x]* 2.8 编写 loadSettings 迁移单元测试
    - 旧默认 `9880` → `8080`；自定义地址不被覆盖；默认 `backendUrl === 'http://localhost:8080'`
    - _Requirements: 4.8_

- [x] 3. 扩展前端 API hooks（增量新增）
  - [x] 3.1 在 useApi 新增 useTranscribe / useSynthesize / useSetModel
    - 在 `app/web/src/hooks/useApi.ts` 新增：
      - `useTranscribe`：multipart 提交 `audio`（+可选 `model_id`）到 `POST /api/inference/asr/upload`
      - `useSynthesize`：JSON 提交 `text`/`model_id`/`ref_audio`/`ref_text` 到 `POST /api/inference/tts`
      - `useSetModel`：提交 `{ model_type, model_id }` 到 `POST /api/config/set-model`，`onSuccess` 用返回值 `setQueryData(['config'], cfg)`
    - 暂不删除旧 hooks（保持构建绿色）
    - _Requirements: 1.3, 1.4, 2.1, 2.2, 2.3, 3.1, 3.3, 4.2, 4.3, 4.9_

- [x] 4. 扩展后端 ASR 响应字段
  - [x] 4.1 为 ASR 响应增加 model 与 elapsed_ms
    - 修改 `backend/server/src/handlers/inference.rs`：`AsrUploadResponse` 与 `AsrResponse` 增加 `model: String`、`elapsed_ms: u64`
    - 在 handler 侧用 `std::time::Instant` 测量墙钟耗时，`model` 填本次实际使用的 model_id（含 fallback 结果）；不改动 `services/inference.rs` 子进程协议
    - _Requirements: 1.5, 4.6, 4.7_

  - [x]* 4.2 后端编译与样例验证（ASR 字段）
    - 运行 `cargo build`（`backend/server`）确认编译通过
    - 确认 `POST /api/inference/asr/upload` 正常样例响应含 `model`、`elapsed_ms`
    - _Requirements: 1.5_

- [x] 5. 新增录音转写页面并接入路由
  - [x] 5.1 实现 TranscribePage 组件
    - 新建 `app/web/src/components/TranscribePage.tsx`：录音（useRecorder）/文件上传两种输入 → `useTranscribe` 提交 `/api/inference/asr/upload`
    - 成功展示 Transcription_Text、所用 `model`、`elapsed_ms`（毫秒）并提供复制到剪贴板；`success:false` 展示 `error` 且不展示文本
    - 麦克风不可用时展示提示并保留文件上传；请求等待期显示"识别处理中"并禁用重复提交
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 6.1, 6.3_

  - [x] 5.2 接入 /transcribe 路由并启用首页入口
    - 修改 `app/web/src/App.tsx`：`case 'transcribe'` 渲染 `TranscribePage`，替换 `PlaceholderPage`
    - 修改 `app/web/src/components/HomePage.tsx`：将"录音转写"入口由 `disabled` 改为可用并允许导航至 `/transcribe`
    - _Requirements: 1.1, 1.10_

  - [x]* 5.3 编写 TranscribePage 单元测试
    - 成功响应渲染 `text`/`model`/`elapsed_ms` 与复制按钮；`success:false` 渲染 `error` 且不渲染文本；加载态禁用提交
    - _Requirements: 1.5, 1.6, 1.9_

- [x] 6. 检查点 - 录音转写链路验证
  - 确保已实现任务的测试通过，如有疑问请询问用户。

- [x] 7. 改造声音工坊接通真实 TTS
  - [x] 7.1 改造 VoiceStudioPage 合成流程
    - 修改 `app/web/src/components/VoiceStudioPage.tsx`：移除硬编码音色假数据，改用 `useVoices()` 展示并选择 Reference_Voice
    - 合成经 `useSynthesize` 调用 `/api/inference/tts`，提交 `text`、`model_id`(=Current_TTS_Model)、`ref_audio`(=所选 voice.path)、`ref_text`(=voice.transcript ?? '')
    - 成功后用 `useAudioPlayer` 加载 `GET /api/audio/{output_path}`；`autoPlay` 开启时自动播放；`success:false` 展示 `error` 且不提供播放
    - 移除 `cfg`/`timesteps`/`seed`/生成模式（VoiceDesign/ControllableClone/UltimateClone）等 VoxCPM 专有控件；等待期禁用重复提交
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 6.2, 6.3_

  - [x]* 7.2 编写 VoiceStudioPage 合成单元测试
    - 提交体包含 `model_id`、`ref_audio`、`ref_text`（来自所选 voice）；不含 `cfg/timesteps/seed/mode` 字段
    - _Requirements: 2.1, 2.3, 2.8_

- [x] 8. 实现 ASR/TTS 引擎选择与回显
  - [x] 8.1 实现引擎选择 UI 与 set-model 往返回显
    - 修改 `app/web/src/components/ModelsPage.tsx`：从 `GET /api/models` 按 `model_type` 分别展示可选 ASR / TTS 模型
    - 选择 ASR/TTS 模型时经 `useSetModel` 提交 `{ model_type, model_id }`；从 `GET /api/config` 读取并回显 Current_ASR_Model / Current_TTS_Model
    - _Requirements: 4.1, 4.2, 4.3, 4.5, 6.6_

- [x] 9. 打通对话页语音闭环
  - [x] 9.1 改造 ChatPage 语音输入与 TTS 朗读
    - 修改 `app/web/src/components/ChatPage.tsx`：录音改用 `useRecorder`；ASR 经 `useTranscribe` 显式带 `model_id=Current_ASR_Model`，成功后 `setInputText(text)`
    - TTS 朗读改用 `useSynthesize`，提交 `model_id=Current_TTS_Model` 与经 `resolveVoiceRef` 解析的当前 Character 绑定音色 `ref_audio`/`ref_text`
    - `autoPlay` 开启：收到 assistant 回复自动合成+播放；关闭：仅渲染手动朗读控件，点击再合成+播放；同一消息播放中再次点击则停止（useAudioPlayer 互斥）
    - ASR/TTS `success:false` 展示 `error`；麦克风不可用展示提示并保留文本输入；ASR 等待期禁用语音触发
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 6.3_

  - [x]* 9.2 编写 ChatPage 语音闭环单元测试
    - ASR 成功 `setInputText`；assistant 回复在 `autoPlay` 开/关下分别自动播放/仅渲染手动按钮；TTS 请求体含 `model_id` 与角色绑定 ref
    - _Requirements: 3.2, 3.3, 3.4, 3.5_

- [x] 10. 检查点 - 语音闭环与引擎选择验证
  - 确保已实现任务的测试通过，如有疑问请询问用户。

- [x] 11. 清理前端 VoxCPM 遗留代码
  - [x] 11.1 移除 useApi 中的死接口 hooks
    - 修改 `app/web/src/hooks/useApi.ts`：移除 `useGenerateTTS`（`POST /api/tts/generate`）与 `useTaskStatus`（轮询 `GET /api/tts/tasks/{id}`）及对 `GenerationTask` 的 import
    - _Requirements: 5.6_

  - [x] 11.2 清理 store/index.ts 类型与 store
    - 修改 `app/web/src/store/index.ts`：按设计将 `AppConfig` 与 `defaultConfig` 对齐后端实际字段，移除 `voxcpm_tts_path`/`voxcpm_server_path`/`default_cfg`/`default_timesteps`/`current_model_id`/`current_mode`
    - 移除 `GenerationTask` 接口与 `useGenerationStore`
    - _Requirements: 5.4, 5.6_

  - [x] 11.3 清理 uiStore.ts 的 GenerationMode
    - 修改 `app/web/src/store/uiStore.ts`：移除 `GenerationMode` 类型及其所有引用；`GenerationParams` 中仅服务于 VoxCPM 的字段不再随请求发送（保留为本地装饰或一并移除）
    - _Requirements: 5.5_

  - [x]* 11.4 前端类型检查与构建验证
    - 运行 `npm run build`（`tsc && vite build`）必须通过，确认无对 `GenerationMode`/`useGenerateTTS`/`useTaskStatus`/`useGenerationStore`/`GenerationTask`/`voxcpm_*` 等已移除符号的引用
    - _Requirements: 5.7_

- [x] 12. 清理后端 VoxCPM 遗留代码
  - [x] 12.1 移除 /api/tts/* 死路由
    - 修改 `backend/server/src/routes/mod.rs`：移除 `POST /api/tts/generate`、`GET /api/tts/tasks/{id}`、`POST /api/tts/tasks/{id}/cancel` 路由注册
    - _Requirements: 5.1_

  - [x] 12.2 删除 handlers/tts.rs 及其模块引用
    - 删除 `backend/server/src/handlers/tts.rs`；从 `backend/server/src/handlers/mod.rs` 移除 `pub mod tts;`
    - _Requirements: 5.1, 5.3_

  - [x] 12.3 删除 services/voxcpm.rs 及其模块引用
    - 删除 `backend/server/src/services/voxcpm.rs`；从 `backend/server/src/services/mod.rs` 移除 `pub mod voxcpm;` 及其文档注释
    - _Requirements: 5.2, 5.3_

  - [x] 12.4 清理 state.rs 的 generation_tasks 与 GenerationTask
    - 修改 `backend/server/src/state.rs`：移除 `AppState.generation_tasks` 字段、`GenerationTask` 结构及 `AppState::default()` 中的初始化；保留 `TaskStatus` 枚举（`DownloadTask` 仍依赖）
    - _Requirements: 5.2, 5.3_

  - [x]* 12.5 后端编译与回归验证
    - 运行 `cargo build` 与 `cargo test`（`backend/server`）必须通过，确认无对已移除模块/字段的悬空引用
    - 确认移除的 `/api/tts/generate` 等路由返回 404；`set-model(asr/tts)` 后 `GET /api/config` 回显并重启后保留
    - _Requirements: 5.3, 4.4, 6.5, 6.6, 6.7_

- [x] 13. 最终检查点 - 全量编译与无回归验证
  - [x]* 13.1 全栈编译与无回归校验
    - 前端 `npm run build` 通过；后端 `cargo build`/`cargo test` 通过
    - 确认所有语音推理仅经 `/api/inference/*`，对话/模型管理/下载契约未变更
    - 确保所有测试通过，如有疑问请询问用户。
    - _Requirements: 5.3, 5.7, 6.4, 6.5, 6.6, 6.7_

## Notes

- 标注 `*` 的子任务为可选（单元测试、编译/集成验证），可为快速 MVP 跳过；核心实现任务不可跳过。
- 设计无 Correctness Properties 章节（UI 交互 / 媒体封装 / 集成接线 / 配置 / 死代码删除），故不含属性测试。
- 任务顺序保证构建绿色：先增量新增（hooks/纯函数/类型默认值/后端字段）→ 页面接线 → 最后移除死代码并统一编译验证。
- 每个任务标注对应需求编号以保证可追溯。

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "2.3", "2.5", "2.7", "4.1"] },
    { "id": 1, "tasks": ["2.2", "2.4", "2.6", "2.8", "3.1", "4.2"] },
    { "id": 2, "tasks": ["5.1", "7.1", "8.1", "9.1"] },
    { "id": 3, "tasks": ["5.2", "5.3", "7.2", "9.2"] },
    { "id": 4, "tasks": ["11.1", "11.2", "11.3"] },
    { "id": 5, "tasks": ["11.4"] },
    { "id": 6, "tasks": ["12.1", "12.2", "12.3", "12.4"] },
    { "id": 7, "tasks": ["12.5"] },
    { "id": 8, "tasks": ["13.1"] }
  ]
}
```
