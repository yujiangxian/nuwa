"""女娲 Nuwa 后端服务 — 模型管理 + 配置管理"""

from __future__ import annotations

import os
import json
from pathlib import Path
from dataclasses import dataclass, field, asdict
from typing import List, Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# ==================== 配置 ====================

PROJECT_ROOT = Path(__file__).resolve().parents[2]
MODELS_DIR = PROJECT_ROOT / "models"
CONFIG_PATH = PROJECT_ROOT / "backend" / "api" / "config.json"

MODEL_EXTENSIONS = {".pth", ".ckpt", ".safetensors", ".gguf", ".bin", ".onnx", ".pt"}


# ==================== 数据模型 ====================

@dataclass
class ModelInfo:
    id: str
    name: str
    type: str  # asr / tts / llm / other
    path: str
    size_mb: float
    files: int
    main_files: List[str] = field(default_factory=list)
    description: str = ""


@dataclass
class AppConfig:
    models_dir: str = "./models"
    output_dir: str = "./output"
    current_model_id: Optional[str] = None
    current_voice_id: Optional[str] = None
    backend: str = "cpu"
    threads: int = 8
    theme: str = "ocean"
    auto_play: bool = True
    language: str = "简体中文"


# ==================== 全局状态 ====================

class AppState:
    def __init__(self):
        self.config = self._load_config()
        self.models: List[ModelInfo] = []
        self._scan_models()

    def _load_config(self) -> AppConfig:
        if CONFIG_PATH.exists():
            try:
                data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
                return AppConfig(**data)
            except Exception:
                pass
        return AppConfig()

    def save_config(self):
        CONFIG_PATH.write_text(
            json.dumps(asdict(self.config), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def _scan_models(self):
        """扫描 models/ 目录，识别所有模型"""
        self.models = []
        if not MODELS_DIR.exists():
            return

        for entry in sorted(MODELS_DIR.iterdir()):
            if not entry.is_dir():
                continue

            model_type = self._detect_type(entry.name)
            model_files = []
            total_size = 0
            main_files = []

            for f in entry.rglob("*"):
                if f.is_file():
                    rel = f.relative_to(entry).as_posix()
                    # 跳过缓存和元数据文件
                    if any(skip in rel for skip in [".cache", ".git", "__pycache__", ".mdl", ".msc", ".mv"]):
                        continue
                    size = f.stat().st_size
                    total_size += size
                    model_files.append(rel)
                    if f.suffix.lower() in MODEL_EXTENSIONS:
                        main_files.append(rel)

            if not model_files:
                continue

            size_mb = round(total_size / (1024 * 1024), 2)

            # 生成友好名称
            name = entry.name.replace("_", " ").replace("-", " ").title()
            if name.lower().endswith(" src"):
                name = name[:-4]

            # 生成描述
            desc = f"{len(main_files)} 个模型文件" if main_files else f"{len(model_files)} 个文件"
            if size_mb > 1024:
                desc += f" · {size_mb/1024:.1f} GB"
            else:
                desc += f" · {size_mb:.1f} MB"

            self.models.append(ModelInfo(
                id=entry.name,
                name=name,
                type=model_type,
                path=str(entry.relative_to(PROJECT_ROOT).as_posix()),
                size_mb=size_mb,
                files=len(model_files),
                main_files=main_files[:5],  # 只列前5个主要文件
                description=desc,
            ))

    def _detect_type(self, dirname: str) -> str:
        d = dirname.lower()
        if any(k in d for k in ["asr", "whisper", "paraformer", "qwen-asr", "glm-asr", "firered"]):
            return "asr"
        if any(k in d for k in ["tts", "sovits", "cosyvoice", "glm-tts", "fishspeech", "indextts", "chatterbox", "mimo"]):
            return "tts"
        if any(k in d for k in ["llm", "gemma", "qwen", "glm", "gpt"]):
            return "llm"
        return "other"


# ==================== FastAPI 应用 ====================

state = AppState()


@asynccontextmanager
async def lifespan(app: FastAPI):
    state.save_config()
    yield
    state.save_config()


app = FastAPI(
    title="Nuwa API",
    version="0.2.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "nuwa-api", "version": "0.2.0"}


# -------------------- 模型管理 --------------------

@app.get("/api/models")
async def list_models() -> list[dict]:
    """列出所有已扫描的模型"""
    return [asdict(m) for m in state.models]


@app.post("/api/models/scan")
async def scan_models() -> list[dict]:
    """重新扫描模型目录"""
    state._scan_models()
    return [asdict(m) for m in state.models]


# -------------------- 配置管理 --------------------

@app.get("/api/config")
async def get_config() -> dict:
    """获取当前配置"""
    return asdict(state.config)


@app.post("/api/config")
async def update_config(payload: dict) -> dict:
    """更新配置（只更新提供的字段）"""
    current = asdict(state.config)
    current.update(payload)
    state.config = AppConfig(**current)
    state.save_config()
    return asdict(state.config)


# -------------------- 参考音频 --------------------

@app.get("/api/voices")
async def list_voices() -> list[dict]:
    """列出参考音频（从 data/ 目录扫描）"""
    voices_dir = PROJECT_ROOT / "data"
    voices = []
    if voices_dir.exists():
        for entry in sorted(voices_dir.rglob("*.wav")):
            voices.append({
                "id": entry.stem,
                "name": entry.stem,
                "path": str(entry.relative_to(PROJECT_ROOT).as_posix()),
                "transcript": None,
                "sample_rate": 24000,
            })
    return voices[:50]  # 限制返回数量


# -------------------- 主入口 --------------------

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
