// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

use std::sync::Arc;
use tokio::sync::RwLock;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use nuwa_server::{config_persist, constants, middleware, routes, services, state, util};

use state::AppState;

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install SIGTERM handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }

    tracing::info!("Shutdown signal received, draining connections...");
}

#[tokio::main]
async fn main() {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "nuwa_server=debug,tower_http=debug".into()),
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

    let project_root = util::project_root();

    // 清理过期的临时文件（超过 24 小时的 nuwa_* 文件）
    {
        let temp_dir = std::env::temp_dir();
        if let Ok(entries) = std::fs::read_dir(&temp_dir) {
            let cutoff = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .saturating_sub(std::time::Duration::from_secs(86400));
            for entry in entries.flatten() {
                let name = entry.file_name();
                let name_str = name.to_string_lossy();
                if name_str.starts_with("nuwa_") {
                    if let Ok(meta) = entry.metadata() {
                        if let Ok(mtime) = meta.modified() {
                            if mtime.duration_since(std::time::UNIX_EPOCH).unwrap_or_default() < cutoff {
                                let _ = std::fs::remove_file(entry.path());
                            }
                        }
                    }
                }
            }
        }
    }

    // 清理过期的 TTS 输出文件（阈值由 NUWA_TTS_RETENTION_DAYS 环境变量控制，默认 7 天）
    {
        let output_dir = project_root.join("output");
        let retention = constants::tts_retention_secs();
        let cutoff = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .saturating_sub(std::time::Duration::from_secs(retention));
        if let Ok(entries) = std::fs::read_dir(&output_dir) {
            let mut cleaned = 0u64;
            let mut cleaned_bytes = 0u64;
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().map(|e| e == "wav").unwrap_or(false) {
                    if let Ok(meta) = entry.metadata() {
                        if let Ok(mtime) = meta.modified() {
                            if mtime.duration_since(std::time::UNIX_EPOCH).unwrap_or_default() < cutoff {
                                cleaned_bytes += meta.len();
                                if std::fs::remove_file(&path).is_ok() {
                                    cleaned += 1;
                                }
                            }
                        }
                    }
                }
            }
            if cleaned > 0 {
                tracing::info!(cleaned, cleaned_mb = cleaned_bytes / 1_048_576, "Cleaned stale TTS output files");
            }
        }
    }

    // 启动时扫描模型目录
    let models_dir = std::path::PathBuf::from(&app_state.config.models_dir);
    let models_dir = if models_dir.is_relative() {
        project_root.join(&models_dir)
    } else {
        models_dir
    };

    tracing::info!(models_dir = %models_dir.display(), "Scanning models directory");
    let mut scanned = services::model_scanner::scan_models_dir(&models_dir);
    let ollama_models = services::model_scanner::scan_ollama_models().await;
    scanned.extend(ollama_models);
    scanned.sort_by(|a, b| a.name.cmp(&b.name));
    app_state.models = scanned;
    tracing::info!(count = app_state.models.len(), "Model scan complete");
    for m in &app_state.models {
        tracing::info!(name = %m.name, model_type = %m.model_type, size_mb = m.size_mb, files = m.files, "  model");
    }

    // 校验所有已配置模型是否存在于扫描结果中（兼容带/不带类型前缀的 ID）
    let all_ids: Vec<String> = app_state.models.iter().map(|m| m.id.clone()).collect();
    for (model_type, model_id) in app_state.config.current_models.clone() {
        let found = all_ids.iter().any(|id| {
            id == &model_id || id == &format!("{}/{}", model_type, model_id)
        });
        if !found {
            tracing::warn!(%model_type, %model_id, "Configured model not found in scanned models, removing");
            app_state.config.current_models.remove(&model_type);
        }
    }
    if let Some(ref id) = app_state.config.current_llm_model.clone() {
        let found = all_ids.iter().any(|m| m == id || m == &format!("llm/{}", id));
        if !found {
            tracing::warn!(%id, "current_llm_model not found, clearing");
            app_state.config.current_llm_model = None;
        }
    }
    if let Some(ref id) = app_state.config.current_asr_model.clone() {
        let found = all_ids.iter().any(|m| m == id || m == &format!("asr/{}", id));
        if !found {
            tracing::warn!(%id, "current_asr_model not found, clearing");
            app_state.config.current_asr_model = None;
        }
    }
    if let Some(ref id) = app_state.config.current_tts_model.clone() {
        let found = all_ids.iter().any(|m| m == id || m == &format!("tts/{}", id));
        if !found {
            tracing::warn!(%id, "current_tts_model not found, clearing");
            app_state.config.current_tts_model = None;
        }
    }

    // 启动恢复：从 Voice_Library_Store + Voices_Directory 对账恢复音色库
    {
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

        let store_entries = services::voice_library::load_store(&voices_dir);

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

        let original_ids: std::collections::HashSet<String> =
            store_entries.iter().map(|v| v.id.clone()).collect();
        let reconciled = services::voice_library::reconcile_library(store_entries, &existing_files);
        let reconciled_ids: std::collections::HashSet<String> =
            reconciled.iter().map(|v| v.id.clone()).collect();

        if original_ids != reconciled_ids {
            if let Err(e) = services::voice_library::save_library(&voices_dir, &reconciled) {
                tracing::warn!(error = %e, "Failed to persist voice library");
            }
        }

        tracing::info!(count = reconciled.len(), voices_dir = %voices_dir.display(), "Voices recovered");
        app_state.voices = reconciled;
    }

    let state = Arc::new(RwLock::new(app_state));

    // CORS: read allowed origins from env, default to localhost:5173
    let allowed_origins: Vec<String> = std::env::var("NUWA_ALLOWED_ORIGINS")
        .ok()
        .map(|s| s.split(',').map(|s| s.trim().to_string()).collect())
        .unwrap_or_else(|| vec!["http://localhost:5173".to_string()]);

    let app = routes::create_router()
        .layer(axum::middleware::from_fn(middleware::inject_security_headers))
        .layer(tower_http::limit::RequestBodyLimitLayer::new(50 * 1024 * 1024))
        .layer(tower_http::trace::TraceLayer::new_for_http())
        .layer(middleware::cors(&allowed_origins))
        .with_state(state);

    let port: u16 = std::env::var("NUWA_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8080);

    let addr = format!("0.0.0.0:{}", port);
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .unwrap_or_else(|e| {
            tracing::error!(error = %e, addr = %addr, "Failed to bind port");
            std::process::exit(1);
        });
    tracing::info!(addr = %listener.local_addr().unwrap(), "Nuwa server listening");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .unwrap_or_else(|e| {
            tracing::error!(error = %e, "Server error");
        });

    // Cleanup temp files on shutdown
    tracing::info!("Server stopped, cleaning up temporary files");
    if let Ok(entries) = std::fs::read_dir(std::env::temp_dir()) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            if name.to_string_lossy().starts_with("nuwa_") {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
}
