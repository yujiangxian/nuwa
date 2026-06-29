use axum::{extract::Path, http::StatusCode, response::IntoResponse};
use std::path::PathBuf;

fn project_root() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|exe| {
            exe.parent()
                .and_then(|p| p.parent())
                .and_then(|p| p.parent())
                .and_then(|p| p.parent())
                .and_then(|p| p.parent())
                .map(|p| p.to_path_buf())
        })
        .unwrap_or_else(|| PathBuf::from("."))
}

pub async fn serve_audio(Path(filename): Path<String>) -> impl IntoResponse {
    // 安全校验：只允许 .wav 文件
    if !filename.ends_with(".wav") {
        return (StatusCode::BAD_REQUEST, "Invalid file type").into_response();
    }

    let path = project_root().join("output").join(&filename);
    if !path.exists() {
        return (StatusCode::NOT_FOUND, "Audio not found").into_response();
    }

    match tokio::fs::read(&path).await {
        Ok(data) => {
            let mut response = axum::response::Response::new(data.into());
            response.headers_mut().insert(
                axum::http::header::CONTENT_TYPE,
                axum::http::HeaderValue::from_static("audio/wav"),
            );
            response
        }
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "Failed to read audio").into_response(),
    }
}
