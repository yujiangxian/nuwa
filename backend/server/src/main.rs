use std::sync::Arc;
use tokio::sync::RwLock;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use voxcpm_server::{config_persist, middleware, routes, services, state};

use state::AppState;

#[tokio::main]
async fn main() {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "voxcpm_server=debug,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    // 尝试从文件加载配置
    let mut app_state = match config_persist::load_config() {
        Some(cfg) => AppState {
            config: cfg,
            ..AppState::default()
        },
        None => AppState::default(),
    };

    // 设置默认模型目录
    if app_state.config.models_dir.is_empty() {
        app_state.config.models_dir = "models".to_string();
    }

    // 解析项目根目录（基于 exe 路径推断）
    let project_root = std::env::current_exe()
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
                .and_then(|cd| cd.parent().and_then(|p| p.parent()).map(|p| p.to_path_buf()))
                .unwrap_or_else(|| std::path::PathBuf::from("."))
        });

    // 启动时扫描模型目录
    let models_dir = std::path::PathBuf::from(&app_state.config.models_dir);
    let models_dir = if models_dir.is_relative() {
        project_root.join(&models_dir)
    } else {
        models_dir
    };

    tracing::info!("Scanning models directory: {}", models_dir.display());
    let mut scanned = services::model_scanner::scan_models_dir(&models_dir);
    // 同时扫描 Ollama 模型
    let ollama_models = services::model_scanner::scan_ollama_models().await;
    scanned.extend(ollama_models);
    scanned.sort_by(|a, b| a.name.cmp(&b.name));
    app_state.models = scanned;
    tracing::info!("Found {} models", app_state.models.len());
    for m in &app_state.models {
        tracing::info!("  - {} ({}, {} MB, {} files)", m.name, m.model_type, m.size_mb, m.files);
    }

    // 如果配置中有 current_model_id，校验它是否存在于已扫描的模型中
    if let Some(ref current_id) = app_state.config.current_model_id {
        if !app_state.models.iter().any(|m| &m.id == current_id) {
            tracing::warn!(
                "配置的 current_model_id '{}' 不存在于已扫描模型中，已清除",
                current_id
            );
            app_state.config.current_model_id = None;
        }
    }

    // 启动恢复：从 Voice_Library_Store + Voices_Directory 对账恢复音色库
    {
        // 解析 voices_dir 绝对路径（空则回退默认 assets/datasets/voices）
        let voices_dir_rel = {
            let v = app_state.config.voices_dir.trim();
            if v.is_empty() {
                "assets/datasets/voices".to_string()
            } else {
                v.to_string()
            }
        };
        let voices_dir = std::path::PathBuf::from(&voices_dir_rel);
        let voices_dir = if voices_dir.is_relative() {
            project_root.join(&voices_dir)
        } else {
            voices_dir
        };

        // 读取持久化 store（缺失/空/损坏 → 空 Vec）
        let store_entries = services::voice_library::load_store(&voices_dir);

        // 列出目录内受支持音频文件名（目录不存在则空）
        let existing_files: Vec<String> = std::fs::read_dir(&voices_dir)
            .ok()
            .map(|rd| {
                rd.filter_map(|e| e.ok())
                    .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
                    .filter_map(|e| e.file_name().to_str().map(|s| s.to_string()))
                    .filter(|name| services::voice_library::is_supported_extension(name))
                    .collect()
            })
            .unwrap_or_default();

        // 对账：保留文件仍存在的条目，补登记未登记的受支持文件
        let original_ids: std::collections::HashSet<String> =
            store_entries.iter().map(|v| v.id.clone()).collect();
        let reconciled = services::voice_library::reconcile_library(store_entries, &existing_files);
        let reconciled_ids: std::collections::HashSet<String> =
            reconciled.iter().map(|v| v.id.clone()).collect();

        // 若发生变化（补登记或丢弃缺失条目）则回写持久化
        if original_ids != reconciled_ids {
            if let Err(e) = services::voice_library::save_library(&voices_dir, &reconciled) {
                tracing::warn!("回写音色库失败: {}", e);
            }
        }

        tracing::info!("Recovered {} voices from {}", reconciled.len(), voices_dir.display());
        app_state.voices = reconciled;
    }

    let state = Arc::new(RwLock::new(app_state));

    let app = routes::create_router()
        .layer(middleware::cors())
        .with_state(state);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await.unwrap();
    tracing::info!("Nuwa server listening on {}", listener.local_addr().unwrap());
    axum::serve(listener, app).await.unwrap();
}
