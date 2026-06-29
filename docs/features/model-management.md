# 功能规格：模型管理 (Models)

---

## 1. 功能概述

统一管理所有 AI 模型：
- **本地权重模型**：ASR/TTS 模型，放在 `models/` 目录下
- **Ollama 模型**：LLM 模型，由 Ollama 托管
- **未来扩展**：API 模型、远程模型等

支持扫描、分类展示、切换当前使用模型、下载新模型。

---

## 2. 核心设计原则

> **前端无感知来源差异**：无论模型来自本地磁盘还是 Ollama，统一用 `ModelInfo` 表示，统一 UI 展示。

---

## 3. 模型统一表示

```typescript
interface ModelInfo {
  id: string;            // "asr/paraformer-large", "llm/gemma4:e4b"
  name: string;          // 友好名称
  model_type: string;    // "asr" | "tts" | "llm"
  source: string;        // "local" | "ollama"
  path: string;          // 本地路径或 ollama://name
  size_mb: number;
  files: number;
  main_files: string[];
  description: string;
  version: string;
  quant: string;
  sample_rate: number;   // 音频模型采样率
}
```

---

## 4. 模型 ID 命名规范

| 来源 | ID 格式 | 示例 |
|------|---------|------|
| 本地 ASR | `asr/{dir_name}` | `asr/paraformer-large` |
| 本地 TTS | `tts/{dir_name}` | `tts/cosyvoice3` |
| Ollama LLM | `llm/{model_name}` | `llm/gemma4:e4b` |

---

## 5. 扫描逻辑

### 5.1 本地模型扫描

```
遍历 models/ 下的一级目录（asr, tts, ...）
  └── 遍历每个一级目录下的二级子目录
      └── 统计文件、识别类型、构建 ModelInfo
```

### 5.2 Ollama 模型扫描

```
GET http://localhost:11434/api/tags
  └── 解析每个模型的 name, size, parameter_size, quantization_level
      └── 构建 ModelInfo { source: "ollama", model_type: "llm", ... }
```

### 5.3 合并与排序

```rust
let mut all_models = local_models;
all_models.extend(ollama_models);
all_models.sort_by(|a, b| a.name.cmp(&b.name));
```

---

## 6. 模型切换逻辑

根据模型类型更新不同的配置字段：

```typescript
function handleSetCurrent(modelId: string) {
  const model = models.find(m => m.id === modelId);
  if (model.model_type === 'llm') {
    // 更新 LLM 配置
    api.post('/api/config', { ...cfg, current_llm_model: modelId });
  } else if (model.model_type === 'asr') {
    // 更新 ASR 配置
    api.post('/api/config', { ...cfg, current_asr_model: modelId });
  } else if (model.model_type === 'tts') {
    // 更新 TTS 配置
    api.post('/api/config', { ...cfg, current_tts_model: modelId });
  }
}
```

---

## 7. 界面设计

### 7.1 分类过滤按钮

```
[全部 (15)] [语音识别 (4)] [语音合成 (10)] [大语言模型 (1)]
```

### 7.2 当前使用提示条

```
┌─────────────────────────────────────┐
│ ✅ 语音模型: CosyVoice-3            │
│    ASR / TTS 推理将使用该模型        │
│ ✅ 对话模型: gemma4:e4b             │
│    聊天对话将使用该模型              │
└─────────────────────────────────────┘
```

### 7.3 模型卡片

```
┌─────────────────────────────────────┐
│ [icon] 模型名称                    │
│        [当前] [Ollama]              │
│        描述 · 大小 · 来源           │
│        文件1, 文件2 +3              │
│        [语音合成] [Q4_K_M] [使用]   │
└─────────────────────────────────────┘
```

---

## 8. 下载管理

### 8.1 预设模型

后端维护 `presets` 列表，包含：
- 模型名称、类型、来源仓库、目标路径
- HuggingFace / ModelScope 双源 fallback

### 8.2 批量下载流程

```
User 选择预设 ──▶ 前端调用 /api/downloads/repo-files
              │
              ▼
         展示文件列表弹窗，用户勾选
              │
              ▼
         POST /api/downloads/batch
              │
              ▼
         后端并行下载（Semaphore=3）
              │
              ▼
         下载完成后自动调用 scan_models()
```

---

## 9. 接口汇总

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/models` | GET | 获取当前缓存的模型列表 |
| `/api/models/scan` | POST | 重新扫描并返回最新列表 |
| `/api/config` | GET | 获取配置 |
| `/api/config` | POST | 更新配置（完整对象）|
| `/api/downloads/presets` | GET | 获取可下载预设 |
| `/api/downloads/repo-files` | GET | 获取仓库文件列表 |
| `/api/downloads/batch` | POST | 开始批量下载 |

---

## 10. 已知问题

| 问题 | 影响 | 方案 |
|------|------|------|
| Ollama 模型名称不友好 | UI 显示 `gemma4:e4b` | 后端 `generate_friendly_name` 增加 Ollama 名称映射 |
| `cosyvoice_src` 被识别为 TTS | 无效模型出现在列表 | 扫描器黑名单过滤 `*_src` 目录 |
| 下载预设缺少 LLM | 无法从 UI 下载 Ollama 模型 | Ollama 模型通过 `ollama pull` 下载，不走此系统 |
