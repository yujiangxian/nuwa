# 模型管理功能文档

> 维护时间: 2026-05-05  
> 对应后端: `backend/server/src/services/model_scanner.rs`, `backend/server/src/handlers/download.rs`

---

## 目录

- [扫描原理](#扫描原理)
- [模型类型识别](#模型类型识别)
- [预设模型仓库](#预设模型仓库)
- [下载功能](#下载功能)
- [手动导入](#手动导入)
- [API 参考](#api-参考)

---

## 扫描原理

### 扫描路径

模型扫描器递归扫描 `models/` 目录（项目根目录下），扫描规则如下：

```
models/                         # 扫描根目录
├── asr/                        # 一级目录 = 类型目录
│   ├── glm-asr-nano/           # 二级目录 = 独立模型 ✅
│   ├── paraformer-large/       # 二级目录 = 独立模型 ✅
│   └── whisper-tiny/           # 二级目录 = 独立模型 ✅
├── tts/                        # 一级目录 = 类型目录
│   ├── cosyvoice3/             # 二级目录 = 独立模型 ✅
│   ├── glm-tts/                # 二级目录 = 独立模型 ✅
│   └── openvoice/              # 二级目录 = 独立模型 ✅
├── llm/                        # 一级目录 = 类型目录（通常为空，Ollama 外部管理）
└── gpt-sovits/                 # 无二级目录，自身作为模型 ✅
```

### 扫描策略

1. **优先扫描二级子目录**: `models/{type}/{model_name}/` 作为独立模型
2. **Fallback 扫描一级目录**: 如果一级目录自身包含模型文件且无有效二级模型，则自身也作为一个模型
3. **自动推断模型类型**: 根据路径中的关键词（`asr`/`tts`/`llm`）推断
4. **跳过空目录**: 文件数为 0 的目录不产生模型记录
5. **跳过缓存文件**: `.cache/`, `__pycache__/`, `.download` 等不计入

### 识别的模型文件扩展名

```rust
const MODEL_EXTS: &[&str] = &[".pth", ".ckpt", ".safetensors", ".gguf", ".bin", ".onnx", ".pt"];
```

### 生成的 ModelInfo 字段

| 字段 | 说明 | 示例 |
|------|------|------|
| `id` | 唯一标识 `{type_dir}/{model_dir}` | `asr/glm-asr-nano` |
| `name` | 友好显示名称 | `GLM-ASR-Nano` |
| `model_type` | 类型: `asr`/`tts`/`llm`/`other` | `asr` |
| `size_mb` | 目录总大小（MB）| `4313.11` |
| `files` | 文件总数 | `9` |
| `main_files` | 模型文件列表（最多5个）| `["model.safetensors"]` |
| `quant` | 量化格式推断 | `Safetensors`/`GGUF`/`PyTorch` |
| `sample_rate` | 采样率推断 | `16000` |
| `description` | 自动生成的描述 | `1 个模型文件 · 4.2 GB · 智谱 · 端到端语音理解` |

---

## 模型类型识别

扫描器根据目录名自动推断模型类型：

### ASR 关键词

```
asr, whisper, paraformer, qwen-asr, glm-asr, firered, mimo, dolphin
```

### TTS 关键词

```
tts, sovits, cosyvoice, glm-tts, fishspeech, indextts, chatterbox,
mimo-tts, openvoice, qwen3-tts
```

### LLM 关键词

```
llm, gemma, qwen, glm
```

### 友好名称映射

扫描器会将原始目录名转换为更友好的显示名称：

| 原始目录名 | 显示名称 |
|-----------|----------|
| `glm-asr-nano` | `GLM-ASR-Nano` |
| `paraformer-large` | `Paraformer-Large` |
| `qwen3-asr-0.6b` | `Qwen3-ASR-0.6B` |
| `cosyvoice3` | `CosyVoice-3` |
| `glm-tts-full` | `GLM-TTS (Full)` |
| `qwen3-tts-base` | `Qwen3-TTS-Base` |
| `gpt_sovits_pretrained` | `GPT-SoVITS Pretrained` |

---

## 预设模型仓库

前端"模型仓库"标签页展示的预设模型列表：

| ID | 名称 | 类型 | 大小 | 来源 | 状态 |
|----|------|------|------|------|------|
| `whisper-tiny` | Whisper Tiny | ASR | 151MB | hf-mirror | ⚠️ 只下载单个 bin 文件，实际需完整仓库 |
| `chinese-roberta` | Chinese-RoBERTa | TTS依赖 | 400MB | hf-mirror | ⚠️ GPT-SoVITS 依赖，非独立模型 |
| `chinese-hubert` | Chinese-HuBERT | TTS依赖 | 360MB | hf-mirror | ⚠️ GPT-SoVITS 依赖，非独立模型 |
| `qwen3-asr-0.6b` | Qwen3-ASR-0.6B | ASR | 1.2GB | modelscope | ⚠️ 只下载 safetensors，缺 tokenizer/config |
| `cosyvoice-300m` | CosyVoice-300M | TTS | 3.2GB | modelscope | ⚠️ URL 指向 yaml 配置文件，非权重 |

### 预设模型 `note` 字段

每个预设模型都包含 `note` 字段，前端会在下载按钮上方显示警告提示，说明该预设的下载限制和使用建议：

```
⚠️ 单文件下载。完整使用还需 tokenizer、config 等文件，
   建议通过 huggingface-cli 下载完整仓库
```

### 改进计划

- [ ] 为每个预设提供**完整文件清单**（类似 HuggingFace 的 `files_and_versions`）
- [ ] 支持**批量下载**同一仓库下的多个文件
- [ ] 添加 `modelscope-cli` / `huggingface-cli` 风格的完整仓库下载支持
- [x] ~~移除依赖型模型~~ 已完成（Chinese-RoBERTa / Chinese-HuBERT 已移除）
- [x] ~~添加 `note` 提示~~ 已完成

---

## 下载功能

### 多线程分片下载器

后端使用基于 `tokio` 的多线程分片下载器，特性：

| 特性 | 参数 | 说明 |
|------|------|------|
| 线程数 | 8（默认）| 并发下载线程 |
| 分片大小 | 8MB | 每个 chunk 的范围 |
| 断点续传 | ✅ | JSON `.download` 元数据文件 |
| 多源 fallback | ✅ | hf-mirror → modelscope → huggingface |
| 慢速重建 | ✅ | 速度低于阈值自动切换源 |
| 自动重试 | ✅ | failed chunk 自动重试并换源 |

### 下载元数据文件

断点续传信息保存在 `.download` 文件中（与 Python 版本格式兼容）：

```json
{
  "url": "https://hf-mirror.com/...",
  "dest": "models/asr/whisper-tiny/pytorch_model.bin",
  "total_size": 151095027,
  "accept_ranges": true,
  "chunks": [
    {
      "index": 0,
      "start": 0,
      "end": 8388607,
      "downloaded": 8388608,
      "status": "completed",
      "source_index": 0,
      "last_speed": 12.5
    }
  ]
}
```

下载完成后 `.download` 文件自动删除。

### 下载状态流转

```
Pending → Running → Completed → 自动触发模型扫描
   ↓         ↓
Cancelled  Failed → 可重试（点击重试按钮）
```

### 下载完成后自动扫描

下载任务成功完成后，后端会自动：
1. 重新扫描 `models/` 目录
2. 更新内存中的模型列表
3. 如果当前选中的模型已不存在，自动清除 `current_model_id`

前端通过全局轮询（每 2 秒）检测下载任务状态变化，当检测到任务从 `running` → `completed` 时：
- 弹出 Toast 通知：「xxx 下载完成，已自动扫描模型」
- 自动刷新"我的模型"列表

无需手动点击"扫描本地模型"按钮。

---

## 手动导入

如果网络下载不可用，可以手动将模型文件放入对应目录后扫描：

### ASR 模型

```
models/asr/{model_name}/
├── config.json          # HuggingFace 配置
├── model.safetensors    # 或 .bin/.pt
├── tokenizer.json       # 分词器
└── ...
```

### TTS 模型

```
models/tts/{model_name}/
├── config.json / model.yaml
├── model.safetensors / model.pt / model.pth
└── ...
```

### 扫描步骤

1. 将模型文件放入 `models/asr/` 或 `models/tts/` 下的子目录
2. 前端点击"扫描本地模型"按钮
3. 或调用 API: `POST /api/models/scan`

---

## 配置持久化

应用配置（包括 `current_model_id`、`theme` 等）会自动持久化到 `config.json` 文件（与可执行文件同级目录）。

- 启动时自动加载 `config.json`
- 调用 `POST /api/config` 时自动保存
- 如果 `current_model_id` 指向的模型不存在于扫描结果中，启动时会自动清除

## API 参考

### 模型列表

```http
GET /api/models
```

返回已扫描的模型列表（从内存中读取，非实时扫描）。

### 扫描模型

```http
POST /api/models/scan
```

重新扫描 `models/` 目录，更新内存中的模型列表，返回扫描结果。

### 预设模型列表

```http
GET /api/downloads/presets
```

返回可下载的预设模型列表。

### 开始下载

```http
POST /api/downloads
Content-Type: application/json

{
  "url": "https://hf-mirror.com/...",
  "dest": "models/asr/whisper-tiny/pytorch_model.bin"
}
```

返回创建的下载任务。

### 查询下载任务

```http
GET /api/downloads
GET /api/downloads/{id}
```

### 取消下载

```http
POST /api/downloads/{id}/cancel
```

### 删除下载任务

```http
DELETE /api/downloads/{id}
```

---

## 常见问题

### Q: 扫描后模型列表为空？

A: 检查 `models/` 目录是否存在，以及是否有至少一个包含文件的子目录。空目录（0 个文件）会被跳过。

### Q: 下载完成后模型没有出现在"我的模型"中？

A: 下载完成后后端会自动扫描模型目录，前端也会自动刷新列表。如果仍未出现，请检查下载的文件是否位于 `models/{type}/{model_name}/` 二级目录下（扫描器只识别二级子目录作为独立模型）。

### Q: 预设模型下载后无法使用？

A: 当前预设模型只下载单个文件。现代 HuggingFace 模型通常需要完整的仓库文件（config.json, tokenizer, 权重等）。建议通过其他工具（如 `huggingface-cli` 或 ModelScope）下载完整仓库后手动导入。

### Q: 模型显示的名称不对？

A: 扫描器根据目录名自动生成友好名称。如果名称映射表中没有对应条目，会显示为目录名的首字母大写形式。可在 `model_scanner.rs` 的 `generate_friendly_name` 函数中添加新的映射。
