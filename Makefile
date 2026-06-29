# VoxCPM 统一构建入口
.PHONY: help dev install test clean

help:
	@echo "VoxCPM Build Commands"
	@echo "  make install     安装 Python 依赖"
	@echo "  make dev         启动桌面端开发服务器"
	@echo "  make api         启动 FastAPI 后端"
	@echo "  make test        运行测试"
	@echo "  make clean       清理缓存"
	@echo "  make download    示例：下载预训练模型"

install:
	cd core && pip install -e ".[dev]"
	cd app/desktop && npm install

dev:
	cd app/desktop && npm run tauri dev

api:
	cd backend/api && uvicorn main:app --reload --port 9880

test:
	cd core && pytest tests/ -v

clean:
	find . -type d -name __pycache__ -exec rm -rf {} +
	find . -type d -name .pytest_cache -exec rm -rf {} +
	find . -type d -name node_modules -prune -o -type d -name dist -exec rm -rf {} +

download:
	voxcpm download "https://hf-mirror.com/XXXXRT/GPT-SoVITS-Pretrained/resolve/main/pretrained_models.zip" \
		--dest models/gpt-sovits/ \
		--threads 16
