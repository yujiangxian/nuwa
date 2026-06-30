//! voxcpm-server 库根。
//!
//! 暴露各模块以便集成测试（`tests/`）访问内部 handler / 纯函数 / 路由。
//! 二进制入口 `main.rs` 复用本库，避免模块被重复编译为两份。

pub mod config_persist;
pub mod constants;
pub mod error;
pub mod handlers;
pub mod middleware;
pub mod routes;
pub mod services;
pub mod state;
