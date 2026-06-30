# Contributing to Nuwa

Thanks for your interest in contributing! This document outlines the workflow and conventions.

## Code of Conduct

Be respectful. Be constructive. Assume good intent.

## Development Setup

### Prerequisites
- **Node.js** 20+ (frontend)
- **Rust** 1.75+ (backend)
- **Python** 3.10+ with venv at `envs/ai/` (inference scripts)
- **Ollama** (LLM) — optional for frontend dev

### Quick Start

```bash
# Backend
cd backend/server
cargo run
# → http://localhost:8080

# Frontend
cd app/web
npm install
npm run dev
# → http://localhost:5173 (proxies /api → :8080)
```

### Running Tests

```bash
# Frontend
cd app/web && npm test

# Backend
cd backend/server && cargo test

# Python (core)
cd core && pip install -e ".[dev]" && pytest tests/ -v
```

## Commit Conventions

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(scope): description
fix(scope): description
chore(scope): description
docs(scope): description
refactor(scope): description
test(scope): description
```

Scopes: `tts`, `asr`, `llm`, `voice`, `chat`, `models`, `config`, `ui`, `backend`, `scripts`

Example: `feat(tts): add multi-segment emotional TTS synthesis`

## Pull Request Workflow

1. Create a feature branch from `master`
2. Make changes — keep commits focused
3. Ensure tests pass: `npm test` (frontend) and/or `cargo test` (backend)
4. Open a PR against `master`
5. PR description should explain the **why**, not just the **what**

## Code Style

### TypeScript
- Use functional components with hooks
- Prefer explicit types — avoid `any`
- Extract reusable logic into `lib/` modules
- Keep components under ~300 lines; split larger ones

### Rust
- Use `thiserror` for error types (see `error.rs`)
- Avoid `.unwrap()` in production handlers — use `?` or `.expect()` with a message
- `cargo clippy` must be clean

### Python (scripts)
- All inference scripts use the same CLI signature: `--model-path`, `--text/--audio`, `--output`, `--output-json`
- Output JSON always has `{ "success": bool, "error"?: string }`

## Project Structure

See [README.md](README.md) for the full layout. Key directories:

- `app/web/src/components/` — React components
- `app/web/src/store/` — Zustand stores
- `app/web/src/lib/` — Pure logic modules
- `backend/server/src/handlers/` — HTTP endpoints
- `backend/server/src/services/` — Business logic
- `scripts/` — Python inference scripts
- `docs/` — Project documentation
