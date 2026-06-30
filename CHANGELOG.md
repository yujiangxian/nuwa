# Changelog

## [Unreleased]

### Added
- GLM-TTS zero-shot voice cloning support (`scripts/inference_tts_glm.py`)
- Multi-segment emotional TTS synthesis (`POST /api/inference/tts/script`)
- Default voice set to 季莹莹 (jyy) for TTS
- CI/CD workflows for frontend and backend

### Changed
- Default TTS model: CosyVoice2 → GLM-TTS (tts/glm-tts-full)
- Default ASR model: Paraformer-Large
- Default LLM model: Gemma 4 E4B (Ollama)

### Removed
- Redundant model directories (~18.6GB freed): glm-tts (partial), glm-tts-full-ms, qwen3-tts-base-ms, glm-asr-nano-full (empty), firered (empty)
