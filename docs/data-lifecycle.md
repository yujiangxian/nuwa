# Nuwa 数据生命周期管理

> 最后更新: 2026-07-06

## 概述

Nuwa 的数据分为三类：**运行时生成**（TTS 输出、临时文件）、**用户创建**（会话、消息、角色、预设、设置）、**部署管理**（模型文件、音色库、配置）。每类有不同的生命周期策略。

---

## 1. 运行时生成数据

### 1.1 TTS 合成输出

| 属性 | 值 |
|------|-----|
| 位置 | `output/tts_{uuid}.wav` (可配置: `AppConfig.output_dir`) |
| 创建时机 | 每个 TTS 合成请求 |
| 大小 | 单个文件 50KB-5MB |
| 自动清理 | 启动时删除超过保留期的 WAV |
| 手动清理 | `POST /api/system/cleanup` — 使用相同保留期 |
| 保留期 | 环境变量 `NUWA_TTS_RETENTION_DAYS`（默认 7 天） |
| 前端触发 | SettingsModal "清除数据" 同时调用清理 API |
| 风险 | 被引用文件可能被清理（前端 IndexedDB 存路径但后端不知引用） |

**未来改进**: 跟踪引用计数——消息删除时递减，计数归零才允许清理。

### 1.2 临时文件

| 属性 | 值 |
|------|-----|
| 位置 | 系统临时目录 (`%TEMP%/nuwa_*`) |
| 创建时机 | ASR/TTS 推理子进程 I/O |
| 自动清理 | 启动时删除 >24h 的 `nuwa_*` 文件；关闭时删除所有 |
| 手动清理 | `POST /api/system/cleanup` |

**命名约定**:
- `nuwa_asr_{uuid}.json` — ASR 推理结果 JSON
- `nuwa_tts_{uuid}.json` — TTS 推理结果 JSON
- `nuwa_asr_upload_{uuid}.wav` — ASR 上传音频

### 1.3 Python 环境

| 属性 | 值 |
|------|-----|
| 位置 | `envs/{name}/` (gitignored) |
| 创建 | 手动 `python -m venv` |
| 清理 | 手动，无自动清理 |

---

## 2. 用户创建数据

### 2.1 聊天会话和消息

| 属性 | 值 |
|------|-----|
| 存储 | IndexedDB `nuwa-chat` (前端), version=2 |
| Stores | `sessions` (keyPath=id), `messages` (keyPath=id, index by sessionId) |
| 导出 | JSON bundle (sessions + messages)，通过 SettingsModal "导出全部数据" |
| 导入 | JSON bundle，新 ID 生成，消息从 seq=0 重新编号 |
| 持久化 | 每个 `appendMessage` / `deleteMessage` 即时写入 IndexedDB |
| 降级 | IndexedDB 不可用时进入 Memory_Fallback_Mode——数据仅内存不持久化 |
| 风险 | 导出消息的 audioUrl 是源服务器路径，导入到其他机器产生悬挂引用 |

### 2.2 角色

| 属性 | 值 |
|------|-----|
| 存储 | IndexedDB `nuwa-characters` (前端), version=1 |
| 导出 | 每个角色单独 JSON |
| 降级 | IndexedDB 失败 → 回退到硬编码默认角色 (defaultCharacters) |

### 2.3 提示词预设

| 属性 | 值 |
|------|-----|
| 存储 | IndexedDB `nuwa-prompt-preset` (前端), version=1 |
| 导出 | 每个预设单独 JSON |
| 降级 | IndexedDB 失败 → 回退到空列表 |

### 2.4 应用设置

| 属性 | 值 |
|------|-----|
| 前端设置 | localStorage `nuwa_settings` |
| 包含字段 | backendUrl, modelsDir, theme, autoPlay, language |
| 后端配置 | `config.json` (项目根目录, 可覆盖: `NUWA_CONFIG` 环境变量) |
| 包含字段 | models_dir, output_dir, voices_dir, backend, threads, 模型选择, model_meta |
| 同步状态 | modelsDir 可通过 SettingsModal 同步到后端，theme/language 仅前端 |
| 配置写入 | 原子性 (先写 .json.tmp 再 rename) |

---

## 3. 部署管理数据

### 3.1 模型文件

| 属性 | 值 |
|------|-----|
| 位置 | `models/` (可配置: `AppConfig.models_dir`) |
| 扫描 | 启动时扫描本地文件 + Ollama API |
| 下载 | HTTP chunked download (resume 支持) |
| 删除 | `DELETE /api/models/{id}` — 移除本地文件 + config 更新 |
| 元数据 | `config.json` 的 `model_meta` HashMap (notes, tags, last_used) |
| 来源 | `local` 或 `ollama` |

### 3.2 音色库

| 属性 | 值 |
|------|-----|
| 位置 | `assets/datasets/voices/` (可配置: `AppConfig.voices_dir`) |
| 索引 | `voices.json` (存放在 voices 目录内) |
| 启动恢复 | 将 `voices.json` 索引与磁盘文件对账，删除孤立记录 |
| 上传 | `POST /api/voices/upload` — 支持 wav/mp3/m4a/flac/ogg/webm, 最大 20MB |
| 删除 | `DELETE /api/voices/{id}` — 删除磁盘文件 + 索引条目 |

### 3.3 运行时配置

| 属性 | 值 |
|------|-----|
| 位置 | `config.json` (项目根目录) |
| 写入 | 原子写入 (临时文件 → rename) |
| 环境变量覆盖 | `NUWA_CONFIG` (路径), `NUWA_PORT` (默认 8080), `NUWA_ALLOWED_ORIGINS` (CORS) |
| 校验 | 启动时校验模型配置是否匹配已扫描模型 |

---

## 4. 清理策略总览

| 数据 | 触发条件 | 保留期限 | 实现位置 |
|------|---------|---------|---------|
| TTS 输出 WAV | 启动 | >7 天 | `main.rs` 启动清理 |
| TTS 输出 WAV | 手动 API | >24 小时 | `handlers/system.rs` cleanup |
| 系统临时文件 | 启动 | >24 小时 | `main.rs` 启动清理 |
| 系统临时文件 | 关闭 | 全部 | `main.rs` 关闭清理 |
| 系统临时文件 | 手动 API | 全部 | `handlers/system.rs` cleanup |
| 前端 IndexedDB | 用户手动 | 全部 | SettingsModal "清除数据" |
| 前端 localStorage | 用户手动 | 全部 | SettingsModal "清除数据" |
| 用户草稿 | 会话切换时覆盖 | 无限制 | `localStorage` nuwa_chat_draft:* |
| 模型文件 | 用户手动删除 | n/a | ModelsPage delete handler |
| 推理中临时文件 | 推理完成后 | 即时 | `inference.rs` `remove_file` |

---

## 5. 备份/迁移策略

**全量导出** (SettingsModal "导出全部数据"):
```json
{
  "exportedAt": "2026-07-06T...",
  "version": "nuwa-v0.3.0",
  "sessions": [...],     // 含消息 (含 audioUrl 路径)
  "characters": [...],
  "presets": [...],
  "settings": {...}
}
```

**不包含**: 模型文件、TTS 输出、音色库——这些太大或不可移植。

**恢复**: 导入 JSON bundle → 会话+消息分配到新会话 ID → 角色/预设合并到现有集合。

**跨机器迁移限制**: audioUrl 路径不可移植——导入机器的 TTS 输出目录不包含源机器文件。

---

## 6. 改进计划

| 优先级 | 改进项 |
|--------|--------|
| P1 | TTS 文件引用计数——消息删除时递减，归零才允许清理 |
| P1 | 导出时警告用户 audio 引用不可移植 |
| P1 | 前端草稿设置最大保留时间（30天） |
| P2 | 下载的模型文件支持 MD5/SHA256 校验 |
| P2 | 统一的备份/还原向导（含模型+音色可选） |
| P3 | 模型文件增量更新 (delta download) |
