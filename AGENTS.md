# AI Agent Guide — Nuwa (女娲)

## Project at a Glance

Multi-model AI platform: LLM chat → TTS voice synthesis + ASR transcription.
React 19 frontend, Rust Axum backend, Python inference subprocesses.

## Key Files to Read First

- `README.md` — project overview, tech stack, quick start
- `backend/server/src/state.rs` — all data types (AppState, AppConfig, ModelInfo, VoiceInfo)
- `backend/server/src/routes/mod.rs` — API route table
- `app/web/src/App.tsx` — frontend page router
- `app/web/src/store/uiStore.ts` — main Zustand store
- `app/web/src/store/index.ts` — config + model stores + TypeScript types

## Module Map

### Backend (`backend/server/src/`)

| Module | Role |
|--------|------|
| `main.rs` | Startup: model scan, voice reconciliation, bind router |
| `state.rs` | Shared AppState + all data types |
| `config_persist.rs` | JSON config load/save |
| `error.rs` | `AppError` enum (thiserror) |
| `constants.rs` | Shared constants (Ollama URL, default ref audio) |
| `routes/mod.rs` | Axum router definition |
| `handlers/chat.rs` | Non-streaming chat + shared Ollama helpers |
| `handlers/chat_stream.rs` | SSE streaming chat |
| `handlers/inference.rs` | ASR/TTS endpoints |
| `handlers/models.rs` | Model CRUD + scan |
| `handlers/voices.rs` | Voice library CRUD |
| `handlers/download.rs` | Download manager |
| `handlers/sse.rs` | SSE progress stream |
| `services/inference.rs` | Python subprocess orchestration for ASR/TTS |
| `services/model_scanner.rs` | Local + Ollama model discovery |
| `services/downloader.rs` | Chunked download engine |
| `services/voice_library.rs` | Voice persistence + reconciliation |
| `services/repo_fetcher.rs` | HuggingFace/ModelScope repo listing |

### Frontend (`app/web/src/`)

| Module | Role |
|--------|------|
| `components/ChatPage.tsx` | Main chat interface |
| `components/VoiceStudioPage.tsx` | Voice library + TTS synthesis |
| `components/TranscribePage.tsx` | ASR recording + upload |
| `components/ModelsPage.tsx` | Model management |
| `components/CharactersPage.tsx` | Character/persona manager |
| `components/PromptPresetsPage.tsx` | Prompt preset manager |
| `store/uiStore.ts` | Zustand: sessions, characters, presets, settings, navigation |
| `store/index.ts` | Zustand: config, models, voices |
| `store/toastStore.ts` | Toast notification state |
| `hooks/useApi.ts` | TanStack Query: all API hooks |
| `lib/` | Pure logic modules (50+ files, each with tests) |

### Python Scripts (`scripts/`)

| File | Role |
|------|------|
| `inference_tts_glm.py` | Single-sentence GLM-TTS synthesis |
| `inference_tts_glm_script.py` | Multi-segment emotional TTS |
| `inference_tts_cosyvoice.py` | CosyVoice/CosyVoice2/CosyVoice3 TTS |
| `inference_asr_paraformer.py` | FunASR Paraformer ASR |
| `inference_asr_whisper.py` | Whisper ASR |

All scripts accept: `--model-path`, `--output`, `--output-json` (and model-specific args).
All produce JSON: `{ "success": bool, "output_path"?, "error"?, "inference_time_sec"? }`.

## Conventions

### Don't break the test suite
- Frontend: `cd app/web && npm test` — 90+ test files
- Backend: `cd backend/server && cargo test`
- Tests exist for nearly every `lib/` module and every store slice

### Error handling
- **Rust**: Use `AppError` from `error.rs`, not `String` errors. No `.unwrap()` in handlers.
- **TypeScript**: Catch blocks use `unknown`, not `any`. Extract message via `errorMessage()` from `lib/errorDetail.ts`.

### Component size
- Keep components under ~300 lines
- Extract sub-components to `components/<domain>/` subdirectories
- Pure logic goes in `lib/`, not in components

### TTS/ASR inference
- Never modify the global Python environment — use `envs/ai-cuda/`, `envs/ai-rocm/`, or `envs/ai/` (see `scripts/setup_local_ai.ps1`)
- Backend selection: `NUWA_GPU_BACKEND=auto|cuda|rocm|cpu` (auto probes `nvidia-smi` / `rocm-smi`)
- Shared device helper: `scripts/nuwa_torch_device.py` (ROCm-only cudnn workaround)
- New inference scripts must follow the existing CLI signature pattern and call `resolve_torch_device(torch)`
