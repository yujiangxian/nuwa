// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

//! SuperGrok OAuth + Imagine API HTTP handlers.

use axum::{
    body::Body,
    extract::Path,
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use futures::StreamExt;
use serde_json::json;

use crate::services::{xai_client, xai_oauth};
use crate::util;

fn err_json(status: StatusCode, msg: impl Into<String>) -> Response {
    (status, Json(json!({ "error": msg.into() }))).into_response()
}

pub async fn auth_start() -> Response {
    match xai_oauth::start_device_code().await {
        Ok(start) => (StatusCode::OK, Json(start)).into_response(),
        Err(e) => err_json(StatusCode::BAD_GATEWAY, e),
    }
}

pub async fn auth_status() -> Response {
    match xai_oauth::poll_device_code().await {
        Ok(s) => (StatusCode::OK, Json(s)).into_response(),
        Err(e) => err_json(StatusCode::BAD_GATEWAY, e),
    }
}

pub async fn auth_import() -> Response {
    match xai_oauth::import_from_grok_cli() {
        Ok(store) => (
            StatusCode::OK,
            Json(json!({
                "ok": true,
                "email": store.email,
                "source": store.source,
                "expires_at": store.expires_at.to_rfc3339(),
            })),
        )
            .into_response(),
        Err(e) => err_json(StatusCode::BAD_REQUEST, e),
    }
}

pub async fn auth_logout() -> Response {
    match xai_oauth::clear_store() {
        Ok(()) => (StatusCode::OK, Json(json!({ "ok": true }))).into_response(),
        Err(e) => err_json(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

pub async fn status() -> Response {
    match xai_client::status().await {
        Ok(s) => (StatusCode::OK, Json(s)).into_response(),
        Err(e) => err_json(StatusCode::BAD_GATEWAY, e),
    }
}

pub async fn chat_stream(Json(req): Json<xai_client::ChatStreamRequest>) -> Response {
    let upstream = match xai_client::chat_completions_stream(req).await {
        Ok(r) => r,
        Err(e) => return err_json(StatusCode::BAD_GATEWAY, e),
    };

    let byte_stream = upstream.bytes_stream().map(|chunk| {
        chunk.map_err(|e| std::io::Error::other(e.to_string()))
    });
    let body = Body::from_stream(byte_stream);

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/event-stream")
        .header(header::CACHE_CONTROL, "no-cache")
        .body(body)
        .unwrap_or_else(|e| {
            err_json(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("构建流响应失败: {e}"),
            )
        })
}

pub async fn images(Json(req): Json<xai_client::ImageRequest>) -> Response {
    match xai_client::generate_image(req).await {
        Ok(r) => (StatusCode::OK, Json(r)).into_response(),
        Err(e) => err_json(StatusCode::BAD_GATEWAY, e),
    }
}

pub async fn videos_submit(Json(req): Json<xai_client::VideoRequest>) -> Response {
    match xai_client::submit_video(req).await {
        Ok(r) => (StatusCode::OK, Json(r)).into_response(),
        Err(e) => err_json(StatusCode::BAD_GATEWAY, e),
    }
}

pub async fn videos_poll(Path(id): Path<String>) -> Response {
    match xai_client::poll_video(&id).await {
        Ok(r) => (StatusCode::OK, Json(r)).into_response(),
        Err(e) => err_json(StatusCode::BAD_GATEWAY, e),
    }
}

/// Serve a downloaded Imagine asset from `output/xai/`.
pub async fn serve_media(Path(filename): Path<String>) -> Response {
    let lower = filename.to_ascii_lowercase();
    let (ok_ext, content_type) = if lower.ends_with(".png") {
        (true, "image/png")
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        (true, "image/jpeg")
    } else if lower.ends_with(".webp") {
        (true, "image/webp")
    } else if lower.ends_with(".mp4") {
        (true, "video/mp4")
    } else if lower.ends_with(".webm") {
        (true, "video/webm")
    } else {
        (false, "")
    };
    if !ok_ext {
        return (StatusCode::BAD_REQUEST, "Invalid file type").into_response();
    }

    let base = xai_client::media_dir();
    let path = match util::safe_resolve(&base, &filename) {
        Ok(p) => p,
        Err(_) => return (StatusCode::FORBIDDEN, "Access denied").into_response(),
    };

    let meta = match tokio::fs::metadata(&path).await {
        Ok(m) => m,
        Err(_) => return (StatusCode::NOT_FOUND, "Media not found").into_response(),
    };
    let file = match tokio::fs::File::open(&path).await {
        Ok(f) => f,
        Err(_) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to open media").into_response()
        }
    };

    let stream = tokio_util::io::ReaderStream::with_capacity(file, 8192);
    let body = Body::from_stream(stream);
    let ct = HeaderValue::from_str(content_type)
        .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream"));
    Response::builder()
        .header(header::CONTENT_TYPE, ct)
        .header(header::CONTENT_LENGTH, HeaderValue::from(meta.len()))
        .header(
            header::CACHE_CONTROL,
            HeaderValue::from_static("public, max-age=86400"),
        )
        .header(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"))
        .body(body)
        .unwrap_or_else(|_| {
            (StatusCode::INTERNAL_SERVER_ERROR, "Failed to build response").into_response()
        })
}
