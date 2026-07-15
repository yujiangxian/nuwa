# Nuwa 开发环境搭建

完整功能需要：Node.js 20+、Rust 1.75+、Python 3.10+（推理）、可选 Ollama（LLM）。

## 1. 克隆与环境变量

```bash
git clone https://github.com/yujiangxian/nuwa.git
cd nuwa
cp .env.example .env          # 后端相关，按需 export
cp app/web/.env.example app/web/.env.local
```

常用变量见根目录 [`.env.example`](../.env.example)。默认后端只监听 `127.0.0.1:8080`；开放局域网时请设置 `NUWA_HOST=0.0.0.0` 并配置 `NUWA_API_KEY`。

## 2. Python 推理虚拟环境

**不要**往系统 Python 里装依赖。使用项目内 venv：

```bash
# Windows
python -m venv envs/ai
envs\ai\Scripts\activate
pip install -r requirements.txt   # 若仓库提供；否则按 docs/tested_models.md 安装 ASR/TTS 依赖

# Linux / macOS
python3 -m venv envs/ai
source envs/ai/bin/activate
pip install -r requirements.txt
```

后端通过 `envs/ai/Scripts/python.exe`（Windows）或 `envs/ai/bin/python`（Unix）调用推理脚本。

## 3. 后端

```bash
cd backend/server
cargo run
# → http://127.0.0.1:8080
```

可选：`export NUWA_API_KEY=dev-secret`（与前端 `VITE_NUWA_API_KEY` 一致）。

## 4. 前端

```bash
cd app/web
npm install
npm run dev
# → http://localhost:5173 （Vite 代理 /api → :8080）
```

## 5. Ollama（可选）

```bash
ollama serve
ollama pull gemma4:e4b
```

远程 Ollama：设置 `OLLAMA_CHAT_URL=http://host:11434/api/chat`（`OLLAMA_TAGS_URL` 可省略，会自动推导）。

## 6. 验证

```bash
# 后端
cd backend/server && cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings

# 前端
cd app/web && npm test && npm run lint && npx tsc --noEmit
```

更多约定见 [CONTRIBUTING.md](../CONTRIBUTING.md) 与 [AGENTS.md](../AGENTS.md)。
