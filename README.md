# 女娲 Nuwa — 多模型 AI 助手平台

> 基于多模态大模型的本地智能交互终端，核心场景：用户输入 → LLM 回复 → TTS 用选定角色声音朗读

---

## 核心功能

| 模块 | 状态 | 说明 |
|------|------|------|
| 💬 智能对话 | ✅ 可用 | 接入 Ollama Gemma 4 E4B，支持多角色 systemPrompt |
| 🎙️ 语音识别 (ASR) | ⚠️ 部分可用 | 4/6 模型验证通过，前端界面待接入 |
| 🔊 语音合成 (TTS) | 🚧 开发中 | 模型文件已下载，推理链路待打通 |
| 📦 模型管理 | ✅ 可用 | 扫描/下载/多线程分片下载/断点续传 |
| 🎭 角色系统 | ✅ 可用 | 小助手(佳怡)/苏格拉底(旁白君)/心理咨询师(孙燕姿) |

---

## 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 前端 | React 19 + Vite 6 + Tailwind CSS v3 + Zustand | — |
| 后端 | Rust + Axum 0.8 | 1.87 |
| LLM 推理 | Ollama (ROCm 后端) | gemma4:e4b |
| TTS 引擎 | CosyVoice3 / GLM-TTS / Qwen3-TTS / OpenVoice（Python 子进程多引擎） | — |
| ASR 引擎 | Paraformer-Large / Whisper / GLM-ASR / Qwen3-ASR（Python 子进程多引擎） | — |
| GPU | AMD RX 9070 XT (本地) | ROCm |

---

## 快速启动

### 1. 启动后端

```powershell
cd backend/server
cargo run
# 服务地址: http://localhost:8080
```

### 2. 启动前端

```powershell
cd app/web
npm install
npm run dev
# 开发地址: http://localhost:5173
```

### 3. 启动 Ollama（LLM 推理）

```powershell
ollama serve
# 确保已加载 gemma4:e4b
ollama pull gemma4:e4b
```

---

## 项目结构

```
.
├── app/web/                    # React 前端
│   ├── src/
│   │   ├── pages/              # Home / Chat / Voice / Models
│   │   ├── components/         # 可复用组件
│   │   └── store/              # Zustand 状态管理
│   └── package.json
├── backend/server/             # Rust Axum 后端
│   ├── src/
│   │   ├── handlers/           # HTTP 路由处理器
│   │   ├── services/           # 业务逻辑（模型扫描、下载器）
│   │   └── state.rs            # 应用状态
│   └── Cargo.toml
├── models/                     # 模型文件目录
│   ├── asr/                    # 语音识别模型
│   ├── tts/                    # 语音合成模型
│   └── llm/                    # 大语言模型（Ollama 外部管理）
├── docs/                       # 项目文档
│   ├── tested_models.md        # 已测试可用模型清单 ⭐
│   ├── model_management.md     # 模型管理功能文档 ⭐
│   ├── tts_production_solution.md
│   ├── rx9070xt_ai_setup.md
│   └── project.md
├── scripts/                    # Python 训练/推理/测试脚本
├── data/                       # 音频素材与清洗数据
└── AGENTS.md                   # AI 编程助手指南
```

---

## 关键文档索引

| 文档 | 内容 |
|------|------|
| [`docs/tested_models.md`](docs/tested_models.md) | ⭐ **已测试可用模型统一清单** — ASR/TTS 模型状态、推荐方案 |
| [`docs/model_management.md`](docs/model_management.md) | ⭐ **模型管理功能文档** — 扫描/下载/手动导入完整指南 |
| [`docs/tts_production_solution.md`](docs/tts_production_solution.md) | TTS 生产级方案 — 情感控制、长文本漂移修复 |
| [`docs/rx9070xt_ai_setup.md`](docs/rx9070xt_ai_setup.md) | AMD RX 9070 XT 环境部署指南 |
| [`AGENTS.md`](AGENTS.md) | AI 编程助手专用指南 — 技术栈、规范、注意事项 |

---

## 本地环境

- **OS**: Windows 11
- **GPU**: AMD RX 9070 XT
- **Python**: 3.10/3.11（多个隔离虚拟环境）
- **PyTorch**: ROCm nightly (gfx120X)
- **Node.js**: 20+
- **Rust**: 1.87+

---

## 许可证

本项目仅供个人研究使用。项目中包含的真人语音素材（孙燕姿等）需注意版权与隐私合规。
