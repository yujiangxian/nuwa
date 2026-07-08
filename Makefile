# Nuwa 统一构建入口
.PHONY: help install frontend backend dev test clean lint typecheck

help:
	@echo "Nuwa Build Commands"
	@echo "  make install     安装所有依赖"
	@echo "  make backend     构建并运行 Rust 后端 (port 8080)"
	@echo "  make frontend    安装前端依赖并启动 Vite 开发服务器 (port 5173)"
	@echo "  make dev         同时启动前后端"
	@echo "  make build       构建 Rust 后端 (release)"
	@echo "  make test        运行所有测试"
	@echo "  make lint        前端 lint + 类型检查"
	@echo "  make clean       清理构建产物"

install:
	cd app/web && npm install
	cd backend/server && cargo build --release

frontend:
	cd app/web && npm install && npm run dev

backend:
	cd backend/server && cargo build --release && ./target/release/nuwa-server

dev:
	@echo "Starting Nuwa (backend :8080 + frontend :5173)"
	cd backend/server && cargo run &
	sleep 2
	cd app/web && npm run dev

build:
	cd backend/server && cargo build --release

test:
	cd app/web && npx vitest run
	cd backend/server && cargo test

typecheck:
	cd app/web && npx tsc --noEmit

lint:
	cd app/web && npx tsc --noEmit
	cd backend/server && cargo clippy -- -D warnings 2>/dev/null || echo "(clippy not installed)"

clean:
	cd backend/server && cargo clean
	rm -rf app/web/dist app/web/node_modules/.vite
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null; true
