// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

use axum::{extract::State, Json};
use std::sync::Arc;
use tokio::sync::{RwLock, Semaphore};

use crate::services::downloader::ChunkedDownloader;
use crate::services::model_scanner;
use crate::services::repo_fetcher::{self, RepoFile};
use crate::state::{AppState, DownloadTask, TaskStatus};

#[derive(serde::Deserialize)]
pub struct StartDownloadRequest {
    pub url: String,
    pub dest: String,
}

#[derive(serde::Deserialize)]
pub struct StartBatchDownloadRequest {
    pub repo_id: String,
    pub source: String,
    pub dest_dir: String,
    /// 可选：指定要下载的文件列表，不填则下载全部
    pub files: Option<Vec<String>>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct PresetModel {
    pub id: String,
    pub name: String,
    pub model_type: String,
    pub description: String,
    pub size_mb: f64,
    pub source: String,
    pub repo_id: String,
    pub dest_dir: String,
    pub note: Option<String>,
    /// 该预设模型是否已下载到本地
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub is_downloaded: bool,
    /// 已安装的本地模型 ID（如 asr/whisper-tiny）
    pub installed_model_id: Option<String>,
}

fn presets() -> Vec<PresetModel> {
    vec![
        // ===== ASR 语音识别 =====
        PresetModel {
            id: "whisper-tiny".to_string(),
            name: "Whisper Tiny".to_string(),
            model_type: "asr".to_string(),
            description: "OpenAI 轻量级语音识别模型，英文效果优秀，加载最快".to_string(),
            size_mb: 151.0,
            source: "hf-mirror".to_string(),
            repo_id: "openai/whisper-tiny".to_string(),
            dest_dir: "models/asr/whisper-tiny".to_string(),
            note: Some("适合 CPU 实时推理".to_string()),
            is_downloaded: false,
            installed_model_id: None,
        },
        PresetModel {
            id: "whisper-base".to_string(),
            name: "Whisper Base".to_string(),
            model_type: "asr".to_string(),
            description: "OpenAI 语音识别基座模型，精度比 Tiny 高".to_string(),
            size_mb: 290.0,
            source: "hf-mirror".to_string(),
            repo_id: "openai/whisper-base".to_string(),
            dest_dir: "models/asr/whisper-base".to_string(),
            note: None,
            is_downloaded: false,
            installed_model_id: None,
        },
        PresetModel {
            id: "whisper-small".to_string(),
            name: "Whisper Small".to_string(),
            model_type: "asr".to_string(),
            description: "OpenAI 小尺寸语音识别模型，多语言精度高".to_string(),
            size_mb: 967.0,
            source: "hf-mirror".to_string(),
            repo_id: "openai/whisper-small".to_string(),
            dest_dir: "models/asr/whisper-small".to_string(),
            note: None,
            is_downloaded: false,
            installed_model_id: None,
        },
        PresetModel {
            id: "whisper-large-v3".to_string(),
            name: "Whisper Large-V3".to_string(),
            model_type: "asr".to_string(),
            description: "OpenAI 最佳精度语音识别模型，显存占用约 3GB".to_string(),
            size_mb: 3100.0,
            source: "hf-mirror".to_string(),
            repo_id: "openai/whisper-large-v3".to_string(),
            dest_dir: "models/asr/whisper-large-v3".to_string(),
            note: Some("显存占用 ~3GB，RX 9070 XT 可轻松运行".to_string()),
            is_downloaded: false,
            installed_model_id: None,
        },
        PresetModel {
            id: "paraformer-large".to_string(),
            name: "Paraformer-Large".to_string(),
            model_type: "asr".to_string(),
            description: "阿里达摩院 FunASR，中文语音识别最稳定，显存占用最低".to_string(),
            size_mb: 848.0,
            source: "modelscope".to_string(),
            repo_id: "damo/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch"
                .to_string(),
            dest_dir: "models/asr/paraformer-large".to_string(),
            note: Some("⭐ 生产环境推荐".to_string()),
            is_downloaded: false,
            installed_model_id: None,
        },
        PresetModel {
            id: "sensevoice-small".to_string(),
            name: "SenseVoice-Small".to_string(),
            model_type: "asr".to_string(),
            description: "阿里端到端语音识别，支持中/英/日/粤/韩，带情感标签".to_string(),
            size_mb: 230.0,
            source: "hf-mirror".to_string(),
            repo_id: "FunAudioLLM/SenseVoiceSmall".to_string(),
            dest_dir: "models/asr/sensevoice-small".to_string(),
            note: None,
            is_downloaded: false,
            installed_model_id: None,
        },
        PresetModel {
            id: "sensevoice-large".to_string(),
            name: "SenseVoice-Large".to_string(),
            model_type: "asr".to_string(),
            description: "阿里端到端语音识别大模型，多语言效果最佳".to_string(),
            size_mb: 2200.0,
            source: "hf-mirror".to_string(),
            repo_id: "FunAudioLLM/SenseVoiceLarge".to_string(),
            dest_dir: "models/asr/sensevoice-large".to_string(),
            note: None,
            is_downloaded: false,
            installed_model_id: None,
        },
        PresetModel {
            id: "qwen3-asr-0.6b".to_string(),
            name: "Qwen3-ASR-0.6B".to_string(),
            model_type: "asr".to_string(),
            description: "阿里通义千问语音识别，识别最规范，带标点断句".to_string(),
            size_mb: 1800.0,
            source: "modelscope".to_string(),
            repo_id: "Qwen/Qwen3-ASR-0.6B".to_string(),
            dest_dir: "models/asr/qwen3-asr-0.6b".to_string(),
            note: Some("⭐ 识别效果最佳，需 transformers 4.57.x".to_string()),
            is_downloaded: false,
            installed_model_id: None,
        },
        PresetModel {
            id: "glm-asr-nano".to_string(),
            name: "GLM-ASR-Nano".to_string(),
            model_type: "asr".to_string(),
            description: "智谱端到端语音理解模型，识别结果带标点，语义完整".to_string(),
            size_mb: 4300.0,
            source: "hf-mirror".to_string(),
            repo_id: "THUDM/glm-asr-nano".to_string(),
            dest_dir: "models/asr/glm-asr-nano".to_string(),
            note: Some("需 16000Hz 音频输入".to_string()),
            is_downloaded: false,
            installed_model_id: None,
        },
        // ===== TTS 语音合成 =====
        PresetModel {
            id: "cosyvoice-300m".to_string(),
            name: "CosyVoice-300M".to_string(),
            model_type: "tts".to_string(),
            description: "阿里 CosyVoice 语音合成基座模型，zero-shot 音色克隆".to_string(),
            size_mb: 3100.0,
            source: "modelscope".to_string(),
            repo_id: "iic/CosyVoice-300M".to_string(),
            dest_dir: "models/tts/cosyvoice3".to_string(),
            note: Some("需安装 cosyvoice 官方库".to_string()),
            is_downloaded: false,
            installed_model_id: None,
        },
        PresetModel {
            id: "cosyvoice-300m-instruct".to_string(),
            name: "CosyVoice-300M-Instruct".to_string(),
            model_type: "tts".to_string(),
            description: "阿里 CosyVoice 情感控制版，支持指令控制情感/语速/音色".to_string(),
            size_mb: 3100.0,
            source: "modelscope".to_string(),
            repo_id: "iic/CosyVoice-300M-Instruct".to_string(),
            dest_dir: "models/tts/cosyvoice-instruct".to_string(),
            note: Some("⭐ 推荐，支持情感指令".to_string()),
            is_downloaded: false,
            installed_model_id: None,
        },
        PresetModel {
            id: "glm-tts".to_string(),
            name: "GLM-TTS".to_string(),
            model_type: "tts".to_string(),
            description: "智谱 GLM-TTS 语音合成模型，支持中英双语".to_string(),
            size_mb: 3700.0,
            source: "hf-mirror".to_string(),
            repo_id: "THUDM/glm-tts".to_string(),
            dest_dir: "models/tts/glm-tts".to_string(),
            note: Some("长文本建议分句后合成".to_string()),
            is_downloaded: false,
            installed_model_id: None,
        },
        PresetModel {
            id: "fishspeech-1.5".to_string(),
            name: "FishSpeech-1.5".to_string(),
            model_type: "tts".to_string(),
            description: "Fish Audio 多语言 TTS，支持中英日，推理速度快".to_string(),
            size_mb: 3800.0,
            source: "hf-mirror".to_string(),
            repo_id: "fishaudio/fish-speech-1.5".to_string(),
            dest_dir: "models/tts/fishspeech-1.5".to_string(),
            note: Some("显存占用 ~4GB".to_string()),
            is_downloaded: false,
            installed_model_id: None,
        },
        PresetModel {
            id: "openvoice".to_string(),
            name: "OpenVoice".to_string(),
            model_type: "tts".to_string(),
            description: "MyShell 声音克隆 TTS，英文效果优秀，跨语言音色迁移".to_string(),
            size_mb: 431.0,
            source: "hf-mirror".to_string(),
            repo_id: "myshell/OpenVoice".to_string(),
            dest_dir: "models/tts/openvoice".to_string(),
            note: Some("需安装 openvoice 官方库".to_string()),
            is_downloaded: false,
            installed_model_id: None,
        },
        PresetModel {
            id: "chattts".to_string(),
            name: "ChatTTS".to_string(),
            model_type: "tts".to_string(),
            description: "2Noise 情感 TTS，中文自然度极高，支持笑声/停顿".to_string(),
            size_mb: 2500.0,
            source: "hf-mirror".to_string(),
            repo_id: "2Noise/ChatTTS".to_string(),
            dest_dir: "models/tts/chattts".to_string(),
            note: Some("中文对话场景效果最佳".to_string()),
            is_downloaded: false,
            installed_model_id: None,
        },
        // ===== ASR 扩展 =====
        PresetModel {
            id: "whisper-medium".to_string(),
            name: "Whisper Medium".to_string(),
            model_type: "asr".to_string(),
            description: "OpenAI 中等尺寸语音识别，精度与速度的平衡点".to_string(),
            size_mb: 1530.0,
            source: "hf-mirror".to_string(),
            repo_id: "openai/whisper-medium".to_string(),
            dest_dir: "models/asr/whisper-medium".to_string(),
            note: Some("769M 参数".to_string()),
            is_downloaded: false,
            installed_model_id: None,
        },
        PresetModel {
            id: "whisper-large-v3-turbo".to_string(),
            name: "Whisper Large-V3 Turbo".to_string(),
            model_type: "asr".to_string(),
            description: "OpenAI 加速版 Large V3，216x 实时倍率，精度损失极小".to_string(),
            size_mb: 1620.0,
            source: "hf-mirror".to_string(),
            repo_id: "openai/whisper-large-v3-turbo".to_string(),
            dest_dir: "models/asr/whisper-large-v3-turbo".to_string(),
            note: Some("809M 参数，解码器仅 4 层".to_string()),
            is_downloaded: false,
            installed_model_id: None,
        },
        PresetModel {
            id: "distil-whisper-large-v3".to_string(),
            name: "Distil-Whisper Large-V3".to_string(),
            model_type: "asr".to_string(),
            description: "HuggingFace 蒸馏版，6x 快于 Large V3，英语精度接近原版".to_string(),
            size_mb: 1510.0,
            source: "hf-mirror".to_string(),
            repo_id: "distil-whisper/distil-large-v3".to_string(),
            dest_dir: "models/asr/distil-whisper-large-v3".to_string(),
            note: Some("756M 参数，英语专用".to_string()),
            is_downloaded: false,
            installed_model_id: None,
        },
        PresetModel {
            id: "moonshine-tiny".to_string(),
            name: "Moonshine Tiny".to_string(),
            model_type: "asr".to_string(),
            description: "Useful Sensors 超轻量 ASR，27M 参数，可跑在树莓派上".to_string(),
            size_mb: 55.0,
            source: "hf-mirror".to_string(),
            repo_id: "usefulsensors/moonshine-tiny".to_string(),
            dest_dir: "models/asr/moonshine-tiny".to_string(),
            note: Some("边缘设备首选".to_string()),
            is_downloaded: false,
            installed_model_id: None,
        },
        PresetModel {
            id: "moonshine-base".to_string(),
            name: "Moonshine Base".to_string(),
            model_type: "asr".to_string(),
            description: "Useful Sensors 轻量 ASR，精度媲美 Whisper Large V3".to_string(),
            size_mb: 662.0,
            source: "hf-mirror".to_string(),
            repo_id: "usefulsensors/moonshine-base".to_string(),
            dest_dir: "models/asr/moonshine-base".to_string(),
            note: Some("331M 参数".to_string()),
            is_downloaded: false,
            installed_model_id: None,
        },
        PresetModel {
            id: "wav2vec2-large".to_string(),
            name: "Wav2Vec2-Large-960h".to_string(),
            model_type: "asr".to_string(),
            description: "Meta 经典自监督 ASR，英语识别稳定，社区生态丰富".to_string(),
            size_mb: 1260.0,
            source: "hf-mirror".to_string(),
            repo_id: "facebook/wav2vec2-large-960h".to_string(),
            dest_dir: "models/asr/wav2vec2-large".to_string(),
            note: Some("Fine-tuned on 960h Librispeech".to_string()),
            is_downloaded: false,
            installed_model_id: None,
        },
        PresetModel {
            id: "fireredasr-aed".to_string(),
            name: "FireRedASR-AED".to_string(),
            model_type: "asr".to_string(),
            description: "小红书 FireRed 团队，中文普通话 CER 3.05%，支持方言和歌词".to_string(),
            size_mb: 2200.0,
            source: "hf-mirror".to_string(),
            repo_id: "FireRedTeam/FireRedASR-AED".to_string(),
            dest_dir: "models/asr/fireredasr-aed".to_string(),
            note: Some("⭐ 中文识别 SOTA，1.1B 参数".to_string()),
            is_downloaded: false,
            installed_model_id: None,
        },
        // ===== TTS 扩展 =====
        PresetModel {
            id: "kokoro".to_string(),
            name: "Kokoro".to_string(),
            model_type: "tts".to_string(),
            description: "82M 参数效率之王，MOS 4.2 超越数倍大模型，Apache 2.0".to_string(),
            size_mb: 300.0,
            source: "hf-mirror".to_string(),
            repo_id: "hexgrad/Kokoro-82M".to_string(),
            dest_dir: "models/tts/kokoro".to_string(),
            note: Some("⭐ 最高自然度/参数比，54 种预设音色".to_string()),
            is_downloaded: false,
            installed_model_id: None,
        },
        PresetModel {
            id: "xtts-v2".to_string(),
            name: "XTTS v2".to_string(),
            model_type: "tts".to_string(),
            description: "Coqui 零样本声音克隆，6 秒参考音频即可复刻任意音色".to_string(),
            size_mb: 4000.0,
            source: "hf-mirror".to_string(),
            repo_id: "coqui/XTTS-v2".to_string(),
            dest_dir: "models/tts/xtts-v2".to_string(),
            note: Some("17 语言支持，CPML 非商用许可".to_string()),
            is_downloaded: false,
            installed_model_id: None,
        },
        PresetModel {
            id: "f5-tts".to_string(),
            name: "F5-TTS".to_string(),
            model_type: "tts".to_string(),
            description: "上海交大 Flow Matching TTS，零样本克隆，推理速度快".to_string(),
            size_mb: 1500.0,
            source: "hf-mirror".to_string(),
            repo_id: "SWivid/F5-TTS".to_string(),
            dest_dir: "models/tts/f5-tts".to_string(),
            note: Some("336M 参数，E2 TTS 同期工作".to_string()),
            is_downloaded: false,
            installed_model_id: None,
        },
        PresetModel {
            id: "melotts".to_string(),
            name: "MeloTTS".to_string(),
            model_type: "tts".to_string(),
            description: "MyShell 轻量 TTS，CPU 实时推理，支持中英日法韩".to_string(),
            size_mb: 200.0,
            source: "hf-mirror".to_string(),
            repo_id: "myshell-ai/MeloTTS".to_string(),
            dest_dir: "models/tts/melotts".to_string(),
            note: Some("<200MB，边缘设备友好".to_string()),
            is_downloaded: false,
            installed_model_id: None,
        },
        PresetModel {
            id: "bark".to_string(),
            name: "Bark".to_string(),
            model_type: "tts".to_string(),
            description: "Suno 生成式 TTS，支持笑声/叹息/音乐等非语音音效".to_string(),
            size_mb: 5000.0,
            source: "hf-mirror".to_string(),
            repo_id: "suno/bark".to_string(),
            dest_dir: "models/tts/bark".to_string(),
            note: Some("900M 参数，~6GB VRAM".to_string()),
            is_downloaded: false,
            installed_model_id: None,
        },
        PresetModel {
            id: "parler-tts-mini".to_string(),
            name: "Parler-TTS Mini".to_string(),
            model_type: "tts".to_string(),
            description: "HuggingFace 文字描述控制音色，说出风格即可改变声音".to_string(),
            size_mb: 3500.0,
            source: "hf-mirror".to_string(),
            repo_id: "huggingface/parler-tts-mini-v1".to_string(),
            dest_dir: "models/tts/parler-tts-mini".to_string(),
            note: Some("880M 参数，Apache 2.0".to_string()),
            is_downloaded: false,
            installed_model_id: None,
        },
        PresetModel {
            id: "dia-1.6b".to_string(),
            name: "Dia 1.6B".to_string(),
            model_type: "tts".to_string(),
            description: "Nari Labs 多说话人对白 TTS，[S1]/[S2] 标签生成自然对话".to_string(),
            size_mb: 3200.0,
            source: "hf-mirror".to_string(),
            repo_id: "nari-labs/Dia-1.6B".to_string(),
            dest_dir: "models/tts/dia-1.6b".to_string(),
            note: Some("播客/有声书多角色生成".to_string()),
            is_downloaded: false,
            installed_model_id: None,
        },
        PresetModel {
            id: "qwen3-tts-base".to_string(),
            name: "Qwen3-TTS-Base".to_string(),
            model_type: "tts".to_string(),
            description: "阿里通义千问 TTS 基座模型，支持音色克隆和情感控制".to_string(),
            size_mb: 1800.0,
            source: "modelscope".to_string(),
            repo_id: "Qwen/Qwen3-TTS".to_string(),
            dest_dir: "models/tts/qwen3-tts-base".to_string(),
            note: Some("用户本地已部署".to_string()),
            is_downloaded: false,
            installed_model_id: None,
        },
        // ===== 其他语音工具 =====
        PresetModel {
            id: "silero-vad".to_string(),
            name: "Silero-VAD".to_string(),
            model_type: "vad".to_string(),
            description: "语音活动检测，区分人声/静音/噪声，实时流式处理".to_string(),
            size_mb: 50.0,
            source: "hf-mirror".to_string(),
            repo_id: "snakers4/silero-vad".to_string(),
            dest_dir: "models/other/silero-vad".to_string(),
            note: Some("⭐ VAD 首选，支持 8k/16kHz".to_string()),
            is_downloaded: false,
            installed_model_id: None,
        },
        PresetModel {
            id: "pyannote-diarization".to_string(),
            name: "PyAnnote Diarization 3.1".to_string(),
            model_type: "diarization".to_string(),
            description: "说话人分离与 diarization，识别\"谁在什么时候说话\"".to_string(),
            size_mb: 100.0,
            source: "hf-mirror".to_string(),
            repo_id: "pyannote/speaker-diarization-3.1".to_string(),
            dest_dir: "models/other/pyannote-diarization".to_string(),
            note: Some("需 accept 用户协议".to_string()),
            is_downloaded: false,
            installed_model_id: None,
        },
        // ===== ASR 极速版 =====
        PresetModel {
            id: "nvidia-parakeet-tdt".to_string(),
            name: "NVIDIA Parakeet TDT 0.6B".to_string(),
            model_type: "asr".to_string(),
            description: "NVIDIA 极速语音识别，RTFx > 2000，实时转录首选".to_string(),
            size_mb: 1200.0,
            source: "hf-mirror".to_string(),
            repo_id: "nvidia/parakeet-tdt-0.6b-v2".to_string(),
            dest_dir: "models/asr/nvidia-parakeet-tdt".to_string(),
            note: Some("⭐ 速度之王，600M 参数".to_string()),
            is_downloaded: false,
            installed_model_id: None,
        },
        // ===== TTS 前沿模型 =====
        PresetModel {
            id: "orpheus-3b".to_string(),
            name: "Orpheus TTS 3B".to_string(),
            model_type: "tts".to_string(),
            description: "Canopy Labs Llama-3B 语音模型，人类级自然度，支持情感标签".to_string(),
            size_mb: 6000.0,
            source: "hf-mirror".to_string(),
            repo_id: "canopylabs/orpheus-3b-0.1-ft".to_string(),
            dest_dir: "models/tts/orpheus-3b".to_string(),
            note: Some("⭐ 情感最丰富，VRAM ~8GB".to_string()),
            is_downloaded: false,
            installed_model_id: None,
        },
        PresetModel {
            id: "tada-1b".to_string(),
            name: "Hume TADA 1B".to_string(),
            model_type: "tts".to_string(),
            description: "Hume AI 文本-声学 1:1 对齐，零幻觉，动态时长".to_string(),
            size_mb: 2000.0,
            source: "hf-mirror".to_string(),
            repo_id: "HumeAI/tada-1b".to_string(),
            dest_dir: "models/tts/tada-1b".to_string(),
            note: Some("MIT 许可，1:1 token 对齐".to_string()),
            is_downloaded: false,
            installed_model_id: None,
        },
        PresetModel {
            id: "indextts-2".to_string(),
            name: "IndexTTS-2".to_string(),
            model_type: "tts".to_string(),
            description: "B站开源情感 TTS，8 维情绪向量控制，时长精确可控".to_string(),
            size_mb: 5000.0,
            source: "modelscope".to_string(),
            repo_id: "IndexTeam/IndexTTS-2".to_string(),
            dest_dir: "models/tts/indextts-2".to_string(),
            note: Some("⭐ 情感控制最强，需 CUDA 12.8+".to_string()),
            is_downloaded: false,
            installed_model_id: None,
        },
        PresetModel {
            id: "spark-tts".to_string(),
            name: "Spark-TTS 0.5B".to_string(),
            model_type: "tts".to_string(),
            description: "SparkAudio 轻量 TTS，0.5B 参数，中英双语零样本克隆".to_string(),
            size_mb: 1000.0,
            source: "hf-mirror".to_string(),
            repo_id: "SparkAudio/Spark-TTS-0.5B".to_string(),
            dest_dir: "models/tts/spark-tts".to_string(),
            note: Some("低延迟，适合实时场景".to_string()),
            is_downloaded: false,
            installed_model_id: None,
        },
        // ===== 音乐/音效生成 =====
        PresetModel {
            id: "musicgen-small".to_string(),
            name: "MusicGen Small".to_string(),
            model_type: "music".to_string(),
            description: "Meta 文本生成音乐，300M 参数，支持旋律条件".to_string(),
            size_mb: 1500.0,
            source: "hf-mirror".to_string(),
            repo_id: "facebook/musicgen-small".to_string(),
            dest_dir: "models/other/musicgen-small".to_string(),
            note: Some("输入文字描述生成音乐片段".to_string()),
            is_downloaded: false,
            installed_model_id: None,
        },
        PresetModel {
            id: "audiogen-medium".to_string(),
            name: "AudioGen Medium".to_string(),
            model_type: "sound".to_string(),
            description: "Meta 文本生成音效，如\"狗叫\"\"雷声\"等环境音".to_string(),
            size_mb: 2000.0,
            source: "hf-mirror".to_string(),
            repo_id: "facebook/audiogen-medium".to_string(),
            dest_dir: "models/other/audiogen-medium".to_string(),
            note: Some("与 MusicGen 同架构，专精音效".to_string()),
            is_downloaded: false,
            installed_model_id: None,
        },
        // ===== 声纹/情感识别 =====
        PresetModel {
            id: "ecapa-tdnn".to_string(),
            name: "ECAPA-TDNN Speaker".to_string(),
            model_type: "speaker".to_string(),
            description: "SpeechBrain 声纹识别，VoxCeleb 训练，余弦相似度验证".to_string(),
            size_mb: 80.0,
            source: "hf-mirror".to_string(),
            repo_id: "speechbrain/spkrec-ecapa-voxceleb".to_string(),
            dest_dir: "models/other/ecapa-tdnn".to_string(),
            note: Some("声纹验证/说话人识别".to_string()),
            is_downloaded: false,
            installed_model_id: None,
        },
        PresetModel {
            id: "emotion2vec-plus-base".to_string(),
            name: "Emotion2Vec+ Base".to_string(),
            model_type: "emotion".to_string(),
            description: "ACL 2024 语音情感识别，9 类情绪（喜怒哀乐惧厌惊平静）".to_string(),
            size_mb: 300.0,
            source: "hf-mirror".to_string(),
            repo_id: "emotion2vec/emotion2vec_plus_base".to_string(),
            dest_dir: "models/other/emotion2vec-plus-base".to_string(),
            note: Some("⭐ 情感识别 SOTA".to_string()),
            is_downloaded: false,
            installed_model_id: None,
        },
        PresetModel {
            id: "wavlm-speaker".to_string(),
            name: "WavLM Speaker Verification".to_string(),
            model_type: "speaker".to_string(),
            description: "微软 WavLM 声纹验证，大规模自监督预训练".to_string(),
            size_mb: 300.0,
            source: "hf-mirror".to_string(),
            repo_id: "microsoft/wavlm-base-plus-sv".to_string(),
            dest_dir: "models/other/wavlm-speaker".to_string(),
            note: Some("需 transformers + torchaudio".to_string()),
            is_downloaded: false,
            installed_model_id: None,
        },
        // ===== ASR 流式实时 =====
        PresetModel {
            id: "kyutai-stt-1b".to_string(),
            name: "Kyutai STT 1B".to_string(),
            model_type: "asr".to_string(),
            description: "Kyutai 实时流式语音识别，英/法双语，延迟低于 200ms".to_string(),
            size_mb: 2500.0,
            source: "hf-mirror".to_string(),
            repo_id: "kyutai/stt-1b-en_fr".to_string(),
            dest_dir: "models/asr/kyutai-stt-1b".to_string(),
            note: Some("需 moshi 库，流式推理".to_string()),
            is_downloaded: false,
            installed_model_id: None,
        },
        PresetModel {
            id: "kyutai-stt-2.6b".to_string(),
            name: "Kyutai STT 2.6B".to_string(),
            model_type: "asr".to_string(),
            description: "Kyutai 高质量流式 STT，英语专用，准确率超越 Whisper Large".to_string(),
            size_mb: 5200.0,
            source: "hf-mirror".to_string(),
            repo_id: "kyutai/stt-2.6b-en".to_string(),
            dest_dir: "models/asr/kyutai-stt-2.6b".to_string(),
            note: Some("2.6B 参数，实时因子 3x".to_string()),
            is_downloaded: false,
            installed_model_id: None,
        },
        // ===== TTS 前沿模型 =====
        PresetModel {
            id: "megatts3".to_string(),
            name: "MegaTTS3".to_string(),
            model_type: "tts".to_string(),
            description: "字节跳动 45M 超轻量 TTS，3 秒样本克隆，中英混合自然".to_string(),
            size_mb: 500.0,
            source: "hf-mirror".to_string(),
            repo_id: "ByteDance/MegaTTS3".to_string(),
            dest_dir: "models/tts/megatts3".to_string(),
            note: Some("⭐ 参数最少/效果最好比，口音强度可控".to_string()),
            is_downloaded: false,
            installed_model_id: None,
        },
        PresetModel {
            id: "maskgct".to_string(),
            name: "MaskGCT".to_string(),
            model_type: "tts".to_string(),
            description: "Amphion 非自回归掩码生成 TTS，10 万小时训练，零样本跨语种".to_string(),
            size_mb: 2500.0,
            source: "hf-mirror".to_string(),
            repo_id: "amphion/MaskGCT".to_string(),
            dest_dir: "models/tts/maskgct".to_string(),
            note: Some("需 Amphion 代码库，两阶段推理".to_string()),
            is_downloaded: false,
            installed_model_id: None,
        },
        PresetModel {
            id: "zonos-transformer".to_string(),
            name: "Zonos Transformer".to_string(),
            model_type: "tts".to_string(),
            description: "Zyphra 1.6B Transformer TTS，20 万小时训练，情感/语速/音高可控"
                .to_string(),
            size_mb: 3200.0,
            source: "hf-mirror".to_string(),
            repo_id: "Zyphra/Zonos-v0.1-transformer".to_string(),
            dest_dir: "models/tts/zonos-transformer".to_string(),
            note: Some("44kHz 输出，Apache 2.0".to_string()),
            is_downloaded: false,
            installed_model_id: None,
        },
        PresetModel {
            id: "zonos-hybrid".to_string(),
            name: "Zonos Hybrid".to_string(),
            model_type: "tts".to_string(),
            description: "Zyphra 1.6B SSM-Hybrid TTS，Mamba2 架构，更低延迟更省显存".to_string(),
            size_mb: 3200.0,
            source: "hf-mirror".to_string(),
            repo_id: "Zyphra/Zonos-v0.1-hybrid".to_string(),
            dest_dir: "models/tts/zonos-hybrid".to_string(),
            note: Some("RTF ~2x on RTX 4090".to_string()),
            is_downloaded: false,
            installed_model_id: None,
        },
        PresetModel {
            id: "soulx-singer".to_string(),
            name: "SoulX-Singer".to_string(),
            model_type: "svs".to_string(),
            description: "Soul AI Lab 零样本歌声合成，中/英/粤三语，MIDI 或旋律条件".to_string(),
            size_mb: 2200.0,
            source: "hf-mirror".to_string(),
            repo_id: "Soul-AILab/SoulX-Singer".to_string(),
            dest_dir: "models/svs/soulx-singer".to_string(),
            note: Some("⭐ 开源 SVS SOTA，4.2 万小时训练".to_string()),
            is_downloaded: false,
            installed_model_id: None,
        },
        // ===== 音乐生成扩展 =====
        PresetModel {
            id: "musicgen-medium".to_string(),
            name: "MusicGen Medium".to_string(),
            model_type: "music".to_string(),
            description: "Meta 1.5B 文本生成音乐，质量与速度的最佳平衡点".to_string(),
            size_mb: 3000.0,
            source: "hf-mirror".to_string(),
            repo_id: "facebook/musicgen-medium".to_string(),
            dest_dir: "models/music/musicgen-medium".to_string(),
            note: Some("1.5B 参数，推荐配置".to_string()),
            is_downloaded: false,
            installed_model_id: None,
        },
        PresetModel {
            id: "musicgen-large".to_string(),
            name: "MusicGen Large".to_string(),
            model_type: "music".to_string(),
            description: "Meta 3.3B 文本生成音乐，最高质量，需 6GB+ VRAM".to_string(),
            size_mb: 6500.0,
            source: "hf-mirror".to_string(),
            repo_id: "facebook/musicgen-large".to_string(),
            dest_dir: "models/music/musicgen-large".to_string(),
            note: Some("3.3B 参数，显存占用较大".to_string()),
            is_downloaded: false,
            installed_model_id: None,
        },
        PresetModel {
            id: "musicgen-melody".to_string(),
            name: "MusicGen Melody".to_string(),
            model_type: "music".to_string(),
            description: "Meta 旋律条件音乐生成，输入哼唱/旋律生成完整音乐".to_string(),
            size_mb: 3000.0,
            source: "hf-mirror".to_string(),
            repo_id: "facebook/musicgen-melody".to_string(),
            dest_dir: "models/music/musicgen-melody".to_string(),
            note: Some("文本+旋律双条件生成".to_string()),
            is_downloaded: false,
            installed_model_id: None,
        },
        PresetModel {
            id: "musicgen-style".to_string(),
            name: "MusicGen Style".to_string(),
            model_type: "music".to_string(),
            description: "Meta 风格条件音乐生成，参考音频风格迁移".to_string(),
            size_mb: 3000.0,
            source: "hf-mirror".to_string(),
            repo_id: "facebook/musicgen-style".to_string(),
            dest_dir: "models/music/musicgen-style".to_string(),
            note: Some("风格迁移，参考音频驱动".to_string()),
            is_downloaded: false,
            installed_model_id: None,
        },
        // ===== 多模态/对话/翻译 =====
        PresetModel {
            id: "deepfilternet3".to_string(),
            name: "DeepFilterNet3".to_string(),
            model_type: "enhance".to_string(),
            description: "实时语音增强与降噪，2.1M 参数，48kHz 全频带处理".to_string(),
            size_mb: 20.0,
            source: "hf-mirror".to_string(),
            repo_id: "Rikorose/DeepFilterNet3".to_string(),
            dest_dir: "models/enhance/deepfilternet3".to_string(),
            note: Some("⭐ 降噪首选，CPU 实时".to_string()),
            is_downloaded: false,
            installed_model_id: None,
        },
        PresetModel {
            id: "qwen2-audio-7b".to_string(),
            name: "Qwen2-Audio-7B-Instruct".to_string(),
            model_type: "audio_lm".to_string(),
            description: "阿里音频大模型，语音聊天+音频分析，8+ 语言支持".to_string(),
            size_mb: 14000.0,
            source: "hf-mirror".to_string(),
            repo_id: "Qwen/Qwen2-Audio-7B-Instruct".to_string(),
            dest_dir: "models/audio_lm/qwen2-audio-7b".to_string(),
            note: Some("7B 参数，VRAM ~14GB".to_string()),
            is_downloaded: false,
            installed_model_id: None,
        },
        PresetModel {
            id: "moshi-moshika".to_string(),
            name: "Moshi Moshika".to_string(),
            model_type: "audio_lm".to_string(),
            description: "Kyutai 实时全双工语音对话模型，理论延迟 160ms".to_string(),
            size_mb: 14000.0,
            source: "hf-mirror".to_string(),
            repo_id: "kyutai/moshika-pytorch-bf16".to_string(),
            dest_dir: "models/audio_lm/moshi-moshika".to_string(),
            note: Some("⭐ 首个实时语音 LLM，端到端对话".to_string()),
            is_downloaded: false,
            installed_model_id: None,
        },
        PresetModel {
            id: "hibiki-1b".to_string(),
            name: "Hibiki 1B".to_string(),
            model_type: "translation".to_string(),
            description: "Kyutai 同声传译模型，法语→英语实时语音翻译".to_string(),
            size_mb: 2500.0,
            source: "hf-mirror".to_string(),
            repo_id: "kyutai/hibiki-1b-pytorch-bf16".to_string(),
            dest_dir: "models/translation/hibiki-1b".to_string(),
            note: Some("流式语音翻译，保留说话人音色".to_string()),
            is_downloaded: false,
            installed_model_id: None,
        },
    ]
}

/// 获取项目根目录（backend/server/ 的上两级）
fn project_root() -> std::path::PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|exe| {
            exe.parent()
                .and_then(|p| p.parent())
                .and_then(|p| p.parent())
                .and_then(|p| p.parent())
                .and_then(|p| p.parent())
                .map(|p| p.to_path_buf())
        })
        .unwrap_or_else(|| {
            std::env::current_dir()
                .ok()
                .and_then(|cd| {
                    cd.parent()
                        .and_then(|p| p.parent())
                        .map(|p| p.to_path_buf())
                })
                .unwrap_or_else(|| std::path::PathBuf::from("."))
        })
}

/// 获取解析后的 models 目录路径
fn resolve_models_dir(state: &AppState) -> std::path::PathBuf {
    let models_dir = std::path::PathBuf::from(&state.config.models_dir);
    if models_dir.is_relative() {
        project_root().join(&models_dir)
    } else {
        models_dir
    }
}

/// 扫描模型目录并更新状态
async fn refresh_models(state: &Arc<RwLock<AppState>>) {
    let models_dir = {
        let state = state.read().await;
        resolve_models_dir(&state)
    };

    let mut scanned = model_scanner::scan_models_dir(&models_dir);
    // 同时扫描 Ollama 模型
    let ollama_models = model_scanner::scan_ollama_models().await;
    scanned.extend(ollama_models);
    scanned.sort_by(|a, b| a.name.cmp(&b.name));
    let count = scanned.len();

    let mut state = state.write().await;
    state.models = scanned;

    // Validate configured models still exist after rescan
    for (model_type, model_id) in state.config.current_models.clone() {
        if !state.models.iter().any(|m| m.id == model_id) {
            state.config.current_models.remove(&model_type);
        }
    }

    tracing::info!("模型扫描完成，发现 {} 个模型", count);
}

pub async fn list_presets(State(state): State<Arc<RwLock<AppState>>>) -> Json<Vec<PresetModel>> {
    let state = state.read().await;
    let models = &state.models;

    let mut all_presets = presets();

    // 尝试从 presets.json 加载扩展预设
    let presets_json_path = project_root().join("presets.json");
    if let Ok(content) = tokio::fs::read_to_string(&presets_json_path).await {
        if let Ok(extra) = serde_json::from_str::<Vec<PresetModel>>(&content) {
            all_presets.extend(extra);
        }
    }

    for preset in &mut all_presets {
        // 检查是否有本地模型的路径匹配该预设的 dest_dir
        for model in models.iter() {
            if model.path == preset.dest_dir
                || model.path.starts_with(&format!("{}/", preset.dest_dir))
            {
                preset.is_downloaded = true;
                preset.installed_model_id = Some(model.id.clone());
                break;
            }
        }
    }

    Json(all_presets)
}

// ========== 获取仓库文件列表 ==========

#[derive(serde::Serialize)]
pub struct RepoFileResponse {
    pub path: String,
    pub size: u64,
    pub size_text: String,
    pub is_lfs: bool,
}

pub async fn list_repo_files(
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Result<Json<Vec<RepoFileResponse>>, Json<serde_json::Value>> {
    let repo_id = params
        .get("repo_id")
        .ok_or_else(|| Json(serde_json::json!({"error": "缺少 repo_id 参数"})))?;
    let source = params
        .get("source")
        .unwrap_or(&"hf-mirror".to_string())
        .clone();

    match repo_fetcher::list_repo_files(repo_id, &source).await {
        Ok(files) => {
            let resp: Vec<RepoFileResponse> = files
                .into_iter()
                .map(|f| RepoFileResponse {
                    size_text: repo_fetcher::format_size(f.size),
                    path: f.path,
                    size: f.size,
                    is_lfs: f.is_lfs,
                })
                .collect();
            Ok(Json(resp))
        }
        Err(e) => Err(Json(serde_json::json!({"error": e}))),
    }
}

// ========== 批量下载 ==========

pub async fn start_batch_download(
    State(state): State<Arc<RwLock<AppState>>>,
    Json(req): Json<StartBatchDownloadRequest>,
) -> Result<Json<DownloadTask>, Json<serde_json::Value>> {
    let task_id = uuid::Uuid::new_v4().to_string();
    let dest_dir = project_root().join(&req.dest_dir);

    // 获取文件列表
    let files = match repo_fetcher::list_repo_files(&req.repo_id, &req.source).await {
        Ok(files) => files,
        Err(e) => return Err(Json(serde_json::json!({"error": e}))),
    };

    // 如果用户指定了文件列表，过滤只下载这些文件
    let files_to_download: Vec<RepoFile> = if let Some(ref selected) = req.files {
        files
            .into_iter()
            .filter(|f| selected.contains(&f.path))
            .collect()
    } else {
        files
    };

    if files_to_download.is_empty() {
        return Err(Json(serde_json::json!({"error": "没有可下载的文件"})));
    }

    let total_files = files_to_download.len() as i32;
    let total_size: u64 = files_to_download.iter().map(|f| f.size).sum();

    let task = DownloadTask {
        id: task_id.clone(),
        mode: "batch".to_string(),
        repo_id: Some(req.repo_id.clone()),
        source: Some(req.source.clone()),
        dest_dir: Some(req.dest_dir.clone()),
        url: String::new(),
        dest: req.dest_dir.clone(),
        total_files,
        completed_files: 0,
        current_file: None,
        status: TaskStatus::Pending,
        progress: 0.0,
        speed_mbps: 0.0,
        error: None,
        failed_files: Vec::new(),
    };

    {
        let mut state = state.write().await;
        state.download_tasks.insert(task_id.clone(), task.clone());
    }

    // 启动后台批量下载
    let state_clone = Arc::clone(&state);
    let task_id_inner = task_id.clone();
    let repo_id = req.repo_id.clone();
    let source = req.source.clone();

    tokio::spawn(async move {
        // 更新状态为 Running
        {
            let mut state = state_clone.write().await;
            if let Some(t) = state.download_tasks.get_mut(&task_id_inner) {
                t.status = TaskStatus::Running;
            }
        }

        // 限制并发数为 3
        let semaphore = Arc::new(Semaphore::new(3));
        let mut handles = Vec::new();
        // 保存所有 downloader 引用，用于进度追踪
        let downloaders: Arc<tokio::sync::RwLock<Vec<Arc<ChunkedDownloader>>>> =
            Arc::new(tokio::sync::RwLock::new(Vec::new()));

        for file in &files_to_download {
            let sem = Arc::clone(&semaphore);
            let file_url = repo_fetcher::build_download_url(&repo_id, &source, &file.path);
            let file_dest = dest_dir.join(&file.path);
            let file_path = file.path.clone();
            let file_size = file.size;
            let task_id_h = task_id_inner.clone();
            let state_h = Arc::clone(&state_clone);
            let dl_registry = Arc::clone(&downloaders);

            let handle = tokio::spawn(async move {
                let _permit = match sem.acquire().await {
                    Ok(p) => p,
                    Err(e) => {
                        tracing::error!("信号量已关闭，放弃下载任务: {}", e);
                        return Err((file_path, e.to_string()));
                    }
                };

                // 确保父目录存在
                if let Some(parent) = file_dest.parent() {
                    let _ = tokio::fs::create_dir_all(parent).await;
                }

                tracing::info!(
                    "[批量下载 {}] 开始下载: {} → {}",
                    task_id_h,
                    file_path,
                    file_dest.display()
                );

                // 更新当前文件
                {
                    let mut state = state_h.write().await;
                    if let Some(t) = state.download_tasks.get_mut(&task_id_h) {
                        t.current_file = Some(file_path.clone());
                    }
                }

                let downloader = Arc::new(ChunkedDownloader::new(&file_url, &file_dest));
                {
                    let mut reg = dl_registry.write().await;
                    reg.push(Arc::clone(&downloader));
                }
                // 注册到全局 downloaders，用于 cancel
                {
                    let mut state = state_h.write().await;
                    let dl_key = format!("{}/{}", task_id_h, file_path);
                    state.downloaders.insert(dl_key, Arc::clone(&downloader));
                }

                let result = downloader.download().await;

                match result {
                    Ok(_) => {
                        tracing::info!("[批量下载 {}] 文件完成: {}", task_id_h, file_path);
                        Ok((file_path, file_size))
                    }
                    Err(e) => {
                        tracing::error!("[批量下载 {}] 文件失败: {} → {}", task_id_h, file_path, e);
                        Err((file_path, e))
                    }
                }
            });
            handles.push(handle);
        }

        // 启动汇总进度追踪 task
        let progress_task = {
            let state_p = Arc::clone(&state_clone);
            let task_id_p = task_id_inner.clone();
            let dl_p = Arc::clone(&downloaders);
            tokio::spawn(async move {
                loop {
                    tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;

                    let reg = dl_p.read().await;
                    if reg.is_empty() {
                        drop(reg);
                        continue;
                    }

                    let mut total_downloaded: u64 = 0;
                    let mut total_size_sum: u64 = 0;
                    let mut total_speed: f64 = 0.0;
                    let mut all_done = true;

                    for dl in reg.iter() {
                        let prog = dl.progress().await;
                        total_downloaded += prog.downloaded;
                        total_size_sum += prog.total;
                        total_speed += prog.speed;
                        if prog.downloaded < prog.total || prog.total == 0 {
                            all_done = false;
                        }
                    }
                    drop(reg);

                    let mut state = state_p.write().await;
                    if let Some(t) = state.download_tasks.get_mut(&task_id_p) {
                        if total_size_sum > 0 {
                            t.progress = (total_downloaded as f64 / total_size_sum as f64) * 100.0;
                        }
                        t.speed_mbps = total_speed / (1024.0 * 1024.0);
                    }

                    if all_done {
                        break;
                    }
                }
            })
        };

        // 等待所有下载完成
        let mut all_success = true;
        let mut downloaded_total: u64 = 0;
        let mut failed_files: Vec<String> = Vec::new();

        for handle in handles {
            match handle.await {
                Ok(Ok((_path, size))) => {
                    downloaded_total += size;
                    let mut state = state_clone.write().await;
                    if let Some(t) = state.download_tasks.get_mut(&task_id_inner) {
                        t.completed_files += 1;
                        if total_size > 0 {
                            t.progress = (downloaded_total as f64 / total_size as f64) * 100.0;
                        }
                    }
                }
                Ok(Err((path, _e))) => {
                    all_success = false;
                    failed_files.push(path);
                }
                Err(e) => {
                    all_success = false;
                    failed_files.push(format!("task panic: {}", e));
                }
            }
        }

        // 停止进度追踪
        progress_task.abort();
        let _ = progress_task.await;

        // 更新最终状态
        let mut state = state_clone.write().await;
        if all_success {
            if let Some(t) = state.download_tasks.get_mut(&task_id_inner) {
                t.status = TaskStatus::Completed;
                t.progress = 100.0;
                t.speed_mbps = 0.0;
                t.current_file = None;
            }
            tracing::info!("批量下载任务 {} 全部完成，自动触发模型扫描", task_id_inner);
            drop(state);
            refresh_models(&state_clone).await;
        } else {
            let completed = total_files as usize - failed_files.len();
            let is_partial = completed > 0;
            if let Some(t) = state.download_tasks.get_mut(&task_id_inner) {
                t.status = if is_partial {
                    TaskStatus::PartialFailed
                } else {
                    TaskStatus::Failed
                };
                t.failed_files = failed_files.clone();
                t.speed_mbps = 0.0;
                t.current_file = None;
                if failed_files.len() == 1 {
                    t.error = Some(format!("文件下载失败: {}", failed_files[0]));
                } else {
                    t.error = Some(format!("{} 个文件下载失败", failed_files.len()));
                }
            }
        }
    });

    Ok(Json(task))
}

// ========== 单文件下载（保留兼容） ==========

pub async fn start_download(
    State(state): State<Arc<RwLock<AppState>>>,
    Json(req): Json<StartDownloadRequest>,
) -> Json<DownloadTask> {
    let task_id = uuid::Uuid::new_v4().to_string();

    let dest_path = project_root().join(&req.dest);

    let task = DownloadTask {
        id: task_id.clone(),
        mode: "single".to_string(),
        repo_id: None,
        source: None,
        dest_dir: None,
        url: req.url.clone(),
        dest: req.dest.clone(),
        total_files: 1,
        completed_files: 0,
        current_file: None,
        status: TaskStatus::Pending,
        progress: 0.0,
        speed_mbps: 0.0,
        error: None,
        failed_files: Vec::new(),
    };

    let downloader = Arc::new(ChunkedDownloader::new(&req.url, &dest_path));

    {
        let mut state = state.write().await;
        state.download_tasks.insert(task_id.clone(), task.clone());
        state
            .downloaders
            .insert(task_id.clone(), Arc::clone(&downloader));
    }

    let state_clone = Arc::clone(&state);
    let task_id_inner = task_id.clone();
    let dl_for_progress = Arc::clone(&downloader);
    let dl_for_download = Arc::clone(&downloader);

    tokio::spawn(async move {
        {
            let mut state = state_clone.write().await;
            if let Some(t) = state.download_tasks.get_mut(&task_id_inner) {
                t.status = TaskStatus::Running;
            }
        }

        let progress_task = {
            let state_p = Arc::clone(&state_clone);
            let task_id_p = task_id_inner.clone();
            let dl_p = Arc::clone(&dl_for_progress);
            tokio::spawn(async move {
                loop {
                    tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
                    if dl_p.is_cancelled() {
                        break;
                    }
                    let prog = dl_p.progress().await;
                    let mut state = state_p.write().await;
                    if let Some(t) = state.download_tasks.get_mut(&task_id_p) {
                        t.progress = prog.percent();
                        t.speed_mbps = prog.speed / (1024.0 * 1024.0);
                    }
                    if prog.downloaded >= prog.total && prog.total > 0 {
                        break;
                    }
                }
            })
        };

        let result = dl_for_download.download().await;
        progress_task.abort();
        let _ = progress_task.await;

        let is_success = result.is_ok();
        {
            let mut state = state_clone.write().await;
            if let Some(t) = state.download_tasks.get_mut(&task_id_inner) {
                match result {
                    Ok(_) => {
                        t.status = TaskStatus::Completed;
                        t.progress = 100.0;
                        t.speed_mbps = 0.0;
                        t.completed_files = 1;
                    }
                    Err(e) => {
                        t.status = TaskStatus::Failed;
                        t.error = Some(e);
                    }
                }
            }
            state.downloaders.remove(&task_id_inner);
        }

        if is_success {
            tracing::info!("下载任务 {} 完成，自动触发模型扫描", task_id_inner);
            refresh_models(&state_clone).await;
        }
    });

    Json(task)
}

pub async fn list_downloads(State(state): State<Arc<RwLock<AppState>>>) -> Json<Vec<DownloadTask>> {
    let state = state.read().await;
    let tasks: Vec<_> = state.download_tasks.values().cloned().collect();
    Json(tasks)
}

pub async fn get_download_status(
    State(state): State<Arc<RwLock<AppState>>>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Json<Option<DownloadTask>> {
    let state = state.read().await;
    Json(state.download_tasks.get(&id).cloned())
}

pub async fn cancel_download(
    State(state): State<Arc<RwLock<AppState>>>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Json<serde_json::Value> {
    let mut state = state.write().await;
    // 单文件下载：直接取消
    if let Some(downloader) = state.downloaders.get(&id) {
        downloader.cancel();
    }
    // 批量下载：取消所有子下载器
    let batch_prefix = format!("{}/", id);
    let batch_keys: Vec<String> = state
        .downloaders
        .keys()
        .filter(|k| k.starts_with(&batch_prefix))
        .cloned()
        .collect();
    for key in batch_keys {
        if let Some(dl) = state.downloaders.get(&key) {
            dl.cancel();
        }
        state.downloaders.remove(&key);
    }
    if let Some(task) = state.download_tasks.get_mut(&id) {
        task.status = TaskStatus::Cancelled;
    }
    Json(serde_json::json!({ "success": true }))
}

pub async fn delete_download(
    State(state): State<Arc<RwLock<AppState>>>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Json<serde_json::Value> {
    let mut state = state.write().await;
    // 先取消正在进行的下载
    let batch_prefix = format!("{}/", id);
    let keys_to_remove: Vec<String> = state
        .downloaders
        .keys()
        .filter(|k| k == &&id || k.starts_with(&batch_prefix))
        .cloned()
        .collect();
    for key in &keys_to_remove {
        if let Some(dl) = state.downloaders.get(key) {
            dl.cancel();
        }
    }
    // 再从 map 中移除
    for key in keys_to_remove {
        state.downloaders.remove(&key);
    }
    state.download_tasks.remove(&id);
    Json(serde_json::json!({ "success": true }))
}

pub async fn retry_download(
    State(state): State<Arc<RwLock<AppState>>>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<Json<DownloadTask>, Json<serde_json::Value>> {
    let (repo_id, source, dest_dir, failed_files) = {
        let state = state.read().await;
        let task = state.download_tasks.get(&id).cloned();
        match task {
            Some(t) => {
                if t.status != TaskStatus::PartialFailed && t.status != TaskStatus::Failed {
                    return Err(Json(serde_json::json!({
                        "error": "只能重试失败或部分失败的任务"
                    })));
                }
                if t.mode != "batch" {
                    return Err(Json(serde_json::json!({
                        "error": "目前仅支持批量任务重试"
                    })));
                }
                (
                    t.repo_id.clone().unwrap_or_default(),
                    t.source.clone().unwrap_or_default(),
                    t.dest_dir.clone().unwrap_or_default(),
                    t.failed_files.clone(),
                )
            }
            None => {
                return Err(Json(serde_json::json!({
                    "error": "任务不存在"
                })));
            }
        }
    };

    if failed_files.is_empty() {
        return Err(Json(serde_json::json!({
            "error": "没有可重试的失败文件"
        })));
    }

    // 先保存旧任务记录，以防重试失败时恢复
    let old_task = {
        let mut state = state.write().await;
        state.download_tasks.remove(&id)
    };
    let batch_prefix = format!("{}/", id);
    {
        let mut state = state.write().await;
        let keys: Vec<String> = state
            .downloaders
            .keys()
            .filter(|k| k.starts_with(&batch_prefix))
            .cloned()
            .collect();
        for key in keys {
            if let Some(dl) = state.downloaders.get(&key) {
                dl.cancel();
            }
            state.downloaders.remove(&key);
        }
    }

    // 重新启动批量下载，只下载失败的文件
    let req = StartBatchDownloadRequest {
        repo_id,
        source,
        dest_dir,
        files: Some(failed_files),
    };
    let state_for_retry = Arc::clone(&state);
    let result = start_batch_download(State(state_for_retry), Json(req)).await;

    // 如果重试启动失败，恢复旧任务记录
    if result.is_err() {
        if let Some(task) = old_task {
            let mut state = state.write().await;
            state.download_tasks.insert(id, task);
        }
    }

    result
}

pub async fn refresh_presets() -> Json<serde_json::Value> {
    // presets 在 list_presets 中每次请求都会重新从 presets.json 加载，
    // 因此刷新操作实际上是无状态的，只需确认 presets.json 可读即可
    let presets_json_path = project_root().join("presets.json");
    match tokio::fs::metadata(&presets_json_path).await {
        Ok(_) => Json(serde_json::json!({ "success": true, "message": "预设列表已刷新" })),
        Err(e) => Json(serde_json::json!({
            "success": false,
            "message": format!("无法读取 presets.json: {}", e)
        })),
    }
}
