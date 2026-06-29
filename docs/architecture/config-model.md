# 配置模型规范

> 定义应用配置的数据结构、持久化方式和各模块的读取约定。

---

## 1. 配置存储

- **文件位置**: 与可执行文件同级目录的 `config.json`
- **序列化**: JSON，`serde_json::to_string_pretty`
- **加载时机**: 后端启动时 `config_persist::load_config()`
- **保存时机**: 任何配置变更后立即保存

---

## 2. 配置结构（Rust）

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    // ========== LLM 对话模型 ==========
    /// 当前选中的 LLM 模型（Ollama 模型名）
    /// 示例: "gemma4:e4b", "llama3.2:latest"
    pub current_llm_model: Option<String>,

    // ========== 语音模型（本地权重）==========
    /// 当前选中的 ASR 模型 ID
    /// 示例: "asr/paraformer-large"
    pub current_asr_model: Option<String>,

    /// 当前选中的 TTS 模型 ID
    /// 示例: "tts/cosyvoice3"
    pub current_tts_model: Option<String>,

    // ========== 音色 / 参考音频 ==========
    /// 当前选中的音色 ID
    pub current_voice_id: Option<String>,

    /// 默认参考音频路径（相对于项目根目录）
    /// 示例: "assets/datasets/cliced_v2/data1_vocals_000.wav"
    pub ref_audio_path: Option<String>,

    /// 参考音频对应的文本
    /// 示例: "大家好，欢迎使用人工智能语音助手。"
    pub ref_text: Option<String>,

    // ========== UI ==========
    /// 主题: "dark" | "light" | "system"
    pub theme: String,

    /// 是否自动播放 TTS
    pub auto_play: bool,

    /// 界面语言
    pub language: String,

    // ========== 路径 ==========
    /// 模型根目录（相对路径）
    pub models_dir: String,

    /// 输出目录（TTS 生成音频等）
    pub output_dir: String,

    /// 参考音频/音色库目录
    pub voices_dir: String,

    // ========== 已废弃字段（兼容保留）==========
    /// 【已废弃】原用于同时表示 ASR/TTS/LLM 的当前模型
    /// 保留以确保旧配置不丢失，但逻辑上不再使用
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_model_id: Option<String>,
}
```

---

## 3. 默认值

```rust
impl Default for AppConfig {
    fn default() -> Self {
        Self {
            current_llm_model: Some("gemma4:e4b".to_string()),
            current_asr_model: Some("asr/paraformer-large".to_string()),
            current_tts_model: Some("tts/cosyvoice3".to_string()),
            current_voice_id: None,
            ref_audio_path: Some("assets/datasets/cliced_v2/data1_vocals_000.wav".to_string()),
            ref_text: Some("大家好，欢迎使用人工智能语音助手。".to_string()),
            theme: "dark".to_string(),
            auto_play: true,
            language: "zh-CN".to_string(),
            models_dir: "models".to_string(),
            output_dir: "output".to_string(),
            voices_dir: "assets/voices".to_string(),
            current_model_id: None,
        }
    }
}
```

---

## 4. 各模块读取约定

| 模块 | 读取字段 | 回退策略 |
|------|---------|---------|
| Chat handler | `current_llm_model` | `default_model()` → `"gemma4:e4b"` |
| ASR handler | `current_asr_model` | 尝试 `current_model_id` → 扫描第一个 ASR |
| TTS handler | `current_tts_model` | 尝试 `current_model_id` → 扫描第一个 TTS |
| TTS 默认参考 | `ref_audio_path` + `ref_text` | 硬编码默认路径 |
| ModelsPage | `current_asr_model` + `current_tts_model` + `current_llm_model` | — |

---

## 5. 前端状态映射

```typescript
// uiStore.ts
interface AppSettings {
  // LLM
  currentLlmModel: string | null;
  // 语音
  currentAsrModel: string | null;
  currentTtsModel: string | null;
  // 音色
  currentVoiceId: string | null;
  refAudioPath: string;
  refText: string;
  // UI
  theme: 'dark' | 'light' | 'system';
  autoPlay: boolean;
  language: string;
}
```

---

## 6. 配置升级策略（向后兼容）

当读取旧版 `config.json`（只有 `current_model_id`）时：

1. 如果 `current_model_id` 是 `asr/*` → 赋值给 `current_asr_model`
2. 如果 `current_model_id` 是 `tts/*` → 赋值给 `current_tts_model`
3. 如果 `current_model_id` 是 `llm/*` → 赋值给 `current_llm_model`
4. 保存新版配置，`current_model_id` 设为 `null`

此逻辑应在 `config_persist::load_config()` 中实现。
