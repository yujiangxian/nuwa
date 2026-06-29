# Implementation Plan: 音色库管理（voice-library-management）

## Overview

本实现计划在 voice-interaction-loop 之上增量交付参考音色端到端管理能力。任务按依赖顺序编排，保证任意时刻前后端均可编译：

- 后端先落地纯逻辑模块 `services/voice_library.rs`（校验/MIME/probe_audio/持久化/对账/分配 id），再扩展 `state.rs` 的 `VoiceInfo`，随后改造 `handlers/voices.rs`、注册路由、接线启动恢复，最后补 `[dev-dependencies]`。
- 前端先补 `Voice` 类型字段，再扩展 `useApi.ts`（mutation + 试听 URL），最后重写/增强 `VoiceStudioPage` 的声音克隆与声音库两个 Tab。
- 8 条 Correctness Property 各对应一个 proptest 后端属性测试任务（标注 Property 编号、Validates 子句、≥100 次迭代）；前端 Vitest 单元测试与后端单元/集成测试覆盖交互、边界与回归。
- 构建/验证任务覆盖后端 `cargo build`/`cargo test` 与前端 `tsc --noEmit`/`vitest --run`/`vite build`。

实现语言：后端 Rust（crate `voxcpm-server`，`backend/server`），前端 TypeScript + React 19（`app/web`）。

## Tasks

- [x] 1. 新增后端纯逻辑模块 `services/voice_library.rs` 骨架与常量
  - 在 `backend/server/src/services/voice_library.rs` 创建模块，定义常量 `SUPPORTED_EXTENSIONS`（`.wav .mp3 .m4a .flac .ogg .webm`）、`MAX_UPLOAD_SIZE = 20 * 1024 * 1024`、`STORE_FILENAME = "voices.json"`
  - 实现 `is_supported_extension(filename: &str) -> bool`（大小写不敏感，接受文件名或扩展名）
  - 实现 `mime_for_extension(filename: &str) -> &'static str`（各受支持扩展名映射到音频 MIME，未知回退 `application/octet-stream`）
  - 实现 `store_path(voices_dir: &Path) -> PathBuf`（拼接 `voices_dir/voices.json`）
  - 在 `backend/server/src/services/mod.rs` 注册 `pub mod voice_library;`
  - 暂以 `use crate::state::VoiceInfo;` 引用现有 `VoiceInfo`（字段扩展在任务 3 完成，本任务不依赖新字段即可编译）
  - _Requirements: 6.3, 3.6_

- [x] 2. 实现音频探测、持久化、对账与 id 分配纯逻辑
  - [x] 2.1 实现 `probe_audio(bytes: &[u8], filename: &str) -> (i32, Option<f64>)`
    - WAV：手动解析 RIFF 头与 `fmt ` 块得到 `sample_rate`，结合 `data` 块字节数、声道数、位深计算 `duration_seconds`
    - 非 WAV 或解析失败：返回 `(0, None)`，不 panic、不报错
    - _Requirements: 1.6_

  - [x]* 2.2 编写 Property 2 属性测试（采样率与时长探测往返）
    - **Property 2: 采样率与时长探测往返**
    - **Validates: Requirements 1.6**
    - 生成随机合法 WAV 字节（随机 sample_rate/时长/声道/位深），断言 `probe_audio` 返回的 `sample_rate` 等于原值、`duration_seconds` 在数值容差内相等；对随机非 WAV 字节断言返回 `(0, None)`
    - 使用 proptest，迭代次数 ≥100；注释标注 `// Feature: voice-library-management, Property 2`
    - _Requirements: 1.6_

  - [x] 2.3 实现 `save_library` 与 `load_store`
    - `save_library(voices_dir: &Path, voices: &[VoiceInfo]) -> Result<(), String>`：serde_json pretty 写入 `store_path`
    - `load_store(voices_dir: &Path) -> Vec<VoiceInfo>`：文件不存在/为空/解析失败均返回空 Vec，不报错
    - _Requirements: 2.1, 2.3_

  - [x]* 2.4 编写 Property 3 属性测试（音色库持久化往返）
    - **Property 3: 音色库持久化往返**
    - **Validates: Requirements 2.1, 2.2, 4.5**
    - 生成随机 `Vec<VoiceInfo>`，写入 tempfile 临时目录后再 `load_store`，断言条目集合按 `id` 与字段一致
    - 使用 proptest + tempfile，迭代次数 ≥100；注释标注 `// Feature: voice-library-management, Property 3`
    - _Requirements: 2.1, 2.2, 4.5_

  - [x]* 2.5 编写 `load_store` 边界单元测试
    - 不存在文件、空文件、损坏 JSON 三种情形均返回空 Vec 且不 panic
    - _Requirements: 2.3_

  - [x] 2.6 实现 `reconcile_library` 与 `allocate_id`
    - `reconcile_library(store_entries: Vec<VoiceInfo>, existing_files: &[String]) -> Vec<VoiceInfo>`：保留 `path` 文件名仍在 `existing_files` 的条目、丢弃缺失条目；为受支持且未被保留条目覆盖的目录文件补登记（`name=去扩展文件名`、`transcript=""`、`path=voices_dir/<file>` 相对项目根形式、唯一 `id`）
    - `allocate_id(existing: &[VoiceInfo]) -> String`：生成不与现有 `id` 冲突的唯一标识
    - _Requirements: 2.2, 2.4, 2.5_

  - [x]* 2.7 编写 Property 4 属性测试（启动恢复对账）
    - **Property 4: 启动恢复对账**
    - **Validates: Requirements 2.2, 2.4, 2.5**
    - 生成随机 store 条目集合与随机"目录现存受支持文件名"集合，断言输出仅保留文件仍存在的 store 条目、为未覆盖的受支持文件补登记且 `name` 为去扩展名、`transcript` 为空
    - 使用 proptest，迭代次数 ≥100；注释标注 `// Feature: voice-library-management, Property 4`
    - _Requirements: 2.2, 2.4, 2.5_

  - [x]* 2.8 编写 Property 5 属性测试（试听 MIME 类型映射）
    - **Property 5: 试听 MIME 类型映射**
    - **Validates: Requirements 3.6**
    - 对每个受支持扩展名（含随机大小写与随机文件名主干）断言 `mime_for_extension` 返回对应音频 MIME 类型
    - 使用 proptest，迭代次数 ≥100；注释标注 `// Feature: voice-library-management, Property 5`
    - _Requirements: 3.6_

- [x] 3. 扩展 `state.rs` 的 `VoiceInfo` 新增 `duration_seconds`
  - 在 `backend/server/src/state.rs` 为 `VoiceInfo` 新增 `pub duration_seconds: Option<f64>` 字段，标注 `#[serde(default)]`
  - 保持 `id`、`name`、`path`、`transcript`、`sample_rate` 字段语义不变（需求 5.5）
  - 更新所有现有 `VoiceInfo` 构造点（如 `handlers/voices.rs::add_voice`、`main.rs` 等）以包含新字段，保证编译通过
  - _Requirements: 1.6, 5.5_

- [x]* 4. 编写 Property 7 属性测试（核心字段语义保真）
  - **Property 7: 核心字段语义保真**
  - **Validates: Requirements 5.5, 5.2**
  - 对随机 `VoiceInfo` 序列化为 JSON，断言始终包含 `id`、`name`、`path`、`transcript`、`sample_rate` 五个字段且 `duration_seconds` 仅为附加字段
  - 使用 proptest，迭代次数 ≥100；注释标注 `// Feature: voice-library-management, Property 7`
  - _Requirements: 5.5, 5.2_

- [x] 5. 检查点 - 后端纯逻辑层编译与测试
  - 在 `backend/server` 运行 `cargo build` 与 `cargo test` 确保模块与现有代码编译通过、已写属性/单元测试通过
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. 改造 `handlers/voices.rs` 实现上传/试听/删除
  - [x] 6.1 实现 `upload_voice`（multipart 编排）
    - 收集 `audio`（字节 + 原文件名）、`name`、`transcript` 字段
    - 校验：缺 audio → 400「需要音频文件」；扩展名不受支持 → 400「不支持的音频格式」；字节数 > `MAX_UPLOAD_SIZE` → 413「文件过大」；缺 name → 400「需要音色名称」（纵深防御）
    - 调用 `probe_audio` 提取 `sample_rate`/`duration_seconds`，`allocate_id` 分配 id，写入 `voices_dir`（文件名 `<id>` + 原扩展名）
    - 构造相对项目根 `path` 的 `VoiceInfo`，push 进 `AppState.voices`，调用 `save_library` 落盘（落盘失败仅 warn，不阻断成功）
    - 成功返回完整 `VoiceInfo`；失败返回 `(StatusCode, Json<{"error": String}>)`
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 6.3, 6.4_

    - [x]* 6.2 编写 Property 1 属性测试（合法上传创建可检索且字段保真）
      - **Property 1: 合法上传创建可检索且字段保真**
      - **Validates: Requirements 1.4, 1.5, 1.7**
      - 对随机合法音频内容与随机 name/transcript，经上传创建逻辑后断言：分配的 id 在库内唯一、文件写入临时 `voices_dir`、`path` 指向该文件、name/transcript 保真、随后可在 voices 列表检索到且字段一致
      - 使用 proptest + tempfile，迭代次数 ≥100；注释标注 `// Feature: voice-library-management, Property 1`
      - _Requirements: 1.4, 1.5, 1.7_

    - [x]* 6.3 编写 Property 8 属性测试（非法上传被拒且库不变）
      - **Property 8: 非法上传被拒且库不变**
      - **Validates: Requirements 6.3, 6.4**
      - 对随机不受支持扩展名输入或超过 `MAX_UPLOAD_SIZE` 的输入，断言上传校验返回错误且 Voice_Library 保持不变（不写文件、不登记）
      - 使用 proptest，迭代次数 ≥100；注释标注 `// Feature: voice-library-management, Property 8`
      - _Requirements: 6.3, 6.4_

    - [x]* 6.4 编写大小边界单元测试
      - 恰好 20MB 被接受、20MB + 1 字节被拒绝
      - _Requirements: 6.4_

  - [x] 6.5 实现 `serve_voice_audio`（按 id 服务音频）
    - 按 `id` 在 `AppState.voices` 查条目，缺失返回 404 且无音频体
    - 解析 `path` 为绝对路径（相对则拼项目根），读字节，设 `Content-Type = mime_for_extension(path)` 返回；读取失败 500
    - _Requirements: 3.5, 3.6, 3.7_

    - [x]* 6.6 编写试听 404 集成/单元测试
      - 请求不存在 id → 返回 404 且无音频内容
      - _Requirements: 3.7_

  - [x] 6.7 改造 `delete_voice`（连带删除磁盘文件 + 落盘 + 幂等）
    - 查条目：不存在 → 返回 `{"success": true}`（幂等，库不变）
    - 存在 → 解析绝对路径 `remove_file`（忽略文件已不存在错误），从 `voices` 移除，`save_library` 落盘
    - _Requirements: 4.4, 4.5, 4.6_

    - [x]* 6.8 编写 Property 6 属性测试（删除清理条目与文件）
      - **Property 6: 删除清理条目与文件**
      - **Validates: Requirements 4.4, 4.5**
      - 对随机 Voice_Library 与任一已存在条目 id，删除后断言库中不含该 id 且其 `voices_dir` 中文件被移除
      - 使用 proptest + tempfile，迭代次数 ≥100；注释标注 `// Feature: voice-library-management, Property 6`
      - _Requirements: 4.4, 4.5_

    - [x]* 6.9 编写删除幂等单元测试
      - 删除不存在 id → 返回 `{"success": true}` 且库不变
      - _Requirements: 4.6_

- [x] 7. 在 `routes/mod.rs` 注册新增/改造路由
  - 新增 `POST /api/voices/upload` → `upload_voice`
  - 新增 `GET /api/voices/{id}/audio` → `serve_voice_audio`
  - 将 `DELETE /api/voices/{id}` 指向改造后的 `delete_voice`
  - 保留既有 `GET /api/voices`、`POST /api/voices`，确认路由顺序不冲突
  - _Requirements: 1.2, 3.5, 4.2, 4.4_

- [x] 8. 在 `main.rs` 接线启动恢复
  - 在模型扫描之后、构建 `state` 之前：解析 `voices_dir` 绝对路径（复用已有 `project_root`），`load_store` 读取 store，列出目录内受支持音频文件名，调用 `reconcile_library` 对账
  - 若发生补登记则 `save_library` 回写，将结果赋值 `app_state.voices`
  - _Requirements: 2.2, 2.3, 2.4, 2.5_

- [x] 9. 更新 `Cargo.toml` 开发依赖
  - 在 `backend/server/Cargo.toml` 的 `[dev-dependencies]` 增加 `proptest` 与 `tempfile`
  - _Requirements: 1.6, 2.1, 2.4, 4.4_

- [x] 10. 检查点 - 后端整体编译与测试
  - 在 `backend/server` 运行 `cargo build` 与 `cargo test`，确保全部后端属性测试与单元/集成测试通过
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. 前端 `Voice` 类型补充 `duration_seconds`
  - 在 `app/web/src/store/index.ts` 的 `Voice` 接口新增 `duration_seconds?: number | null`
  - 在 `app/web/src/lib/voice.ts` 的 `Voice` 接口同样补充可选 `duration_seconds`，保持 `resolveVoiceRef` 行为不变（仅依赖 `path`/`transcript`）
  - _Requirements: 3.2, 5.5_

  - [x]* 11.1 补充 `lib/voice.ts` 单元测试
    - 断言含 `duration_seconds` 的条目不影响 `resolveVoiceRef` 解析的 `ref_audio`/`ref_text`
    - _Requirements: 5.2, 5.5_

- [x] 12. 扩展 `hooks/useApi.ts`：上传/删除 mutation 与试听 URL
  - 新增 `voiceAudioUrl(id: string): string` 返回 `/api/voices/${id}/audio`
  - 新增 `useUploadVoice`：multipart 提交 `audio`/`name`/`transcript`，成功后失效 `['voices']`
  - 新增 `useDeleteVoice`：DELETE `/api/voices/${id}`，成功后失效 `['voices']`
  - _Requirements: 1.2, 1.3, 1.8, 3.5, 4.2, 4.7_

- [x] 13. 实现 `VoiceStudioPage` 声音克隆 Tab
  - 在 `app/web/src/components/VoiceStudioPage.tsx` 重写声音克隆 Tab：本地文件选择（隐藏 `<input type="file" accept="audio/*">`）或录音（复用 `useRecorder`）二选一形成 `audio: Blob`；名称输入、参考文本输入；提交按钮调用 `useUploadVoice`
  - 提交前校验：无音频 → toast「请先选择或录制音频」且不提交（独立于名称/文本）；无名称 → toast「请填写音色名称」且不提交
  - 成功 → toast 成功并依赖 `['voices']` 失效自动刷新列表；失败 → 展示后端 `error` 文本且不向列表插入新条目
  - _Requirements: 1.1, 1.2, 1.3, 1.8, 6.1, 6.2, 6.5_

  - [x]* 13.1 编写声音克隆 Tab 单元测试（Vitest）
    - 控件存在（1.1）；选文件提交构造正确 multipart 字段（1.2）；录音提交携带 Blob（1.3）；无音频拦截不调用上传（6.1）；无名称拦截不调用上传（6.2）；成功失效 `['voices']`（1.8）；上传错误展示后端文本（6.5）
    - 使用 `vi.mock` 隔离 `useUploadVoice`/`useRecorder`
    - _Requirements: 1.1, 1.2, 1.3, 1.8, 6.1, 6.2, 6.5_

- [x] 14. 增强 `VoiceStudioPage` 声音库 Tab（展示/试听/删除）
  - 每条展示 `name`、`transcript`、`sample_rate`，存在时展示 `duration_seconds`（格式化为 `mm:ss` 或 `x.x s`）
  - 试听按钮调用 `useAudioPlayer.play(voiceKey, voiceAudioUrl(v.id))`，再次点击同条目 toggle 停止
  - 删除按钮 → 二次确认（确认对话/内联确认态），确认后调用 `useDeleteVoice`、取消则不调用；成功后依赖 `['voices']` 失效刷新列表
  - 沿用既有加载中/空列表状态展示；`useVoices` 出错时展示错误提示并退出加载态
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.8, 4.1, 4.2, 4.3, 4.7, 6.6_

  - [x]* 14.1 编写声音库 Tab 单元测试（Vitest）
    - 展示 name/transcript/sample_rate（3.1）；有/无 duration 展示（3.2）；加载态（3.3）；空态（3.4）；试听以 `voiceAudioUrl(id)` 调用 player 且 toggle 停止（3.5/3.8）；删除二次确认—确认调用/取消不调用（4.1/4.2/4.3）；删除成功失效 `['voices']`（4.7）；`useVoices` 出错展示并退出加载（6.6）
    - 使用 `vi.mock` 隔离 `useVoices`/`useDeleteVoice`/`useAudioPlayer`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.8, 4.1, 4.2, 4.3, 4.7, 6.6_

- [x]* 15. 编写无回归前端测试
  - 确认既有 `ChatPage.test.tsx`（`resolveVoiceRef` 链路、对话功能）与 `VoiceStudioPage.test.tsx` 既有用例保持通过；验证合成 Tab `selectedVoice.path/transcript` 选用链路不变
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 6.7_

- [x] 16. 最终检查点 - 前后端构建与全量测试
  - 后端：`backend/server` 运行 `cargo build` 与 `cargo test`
  - 前端：`app/web` 运行 `tsc --noEmit`、`vitest --run`、`vite build`
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- 标记 `*` 的子任务为可选测试任务，可为快速 MVP 跳过；实现型 subagent 不实现 `*` 子任务，但必须实现未标 `*` 的子任务。
- 8 条 Correctness Property 各有独立属性测试任务（2.2/2.4/2.7/2.8/4/6.2/6.3/6.8），均使用 proptest 且迭代 ≥100 次。
- 后端单元/集成测试覆盖：`load_store` 边界（2.5）、大小边界（6.4）、试听 404（6.6）、删除幂等（6.9）。
- 任务按依赖编排，每个检查点处前后端均可编译；前端任务（11–14）依赖后端字段/接口语义但通过 Vite proxy 解耦，前端类型补充先行避免编译断裂。
- 每个任务标注对应 Requirements 子句以保证可追溯性。

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1", "3", "9", "11"] },
    { "id": 1, "tasks": ["2.1", "4", "11.1", "12"] },
    { "id": 2, "tasks": ["2.2", "2.3", "13"] },
    { "id": 3, "tasks": ["2.4", "2.5", "2.6", "14"] },
    { "id": 4, "tasks": ["2.7", "2.8", "6.1", "13.1", "14.1", "15"] },
    { "id": 5, "tasks": ["6.2", "6.3", "6.4", "6.5"] },
    { "id": 6, "tasks": ["6.6", "6.7"] },
    { "id": 7, "tasks": ["6.8", "6.9", "7"] },
    { "id": 8, "tasks": ["8"] }
  ]
}
```
