use axum::{
    body::Body,
    extract::Path,
    http::{header, HeaderValue, StatusCode},
    response::IntoResponse,
};
use crate::util;

/// Serve a TTS output WAV file with streaming, caching, and range support.
///
/// - Streams the file in 8KB chunks (never loads the entire file into memory)
/// - Sets `Cache-Control: public, max-age=86400` so the browser caches for 24h
/// - Sets `Accept-Ranges: bytes` so audio players can seek without re-downloading
pub async fn serve_audio(Path(filename): Path<String>) -> impl IntoResponse {
    // Only allow .wav files
    if !filename.ends_with(".wav") {
        return (StatusCode::BAD_REQUEST, "Invalid file type").into_response();
    }

    // Prevent path traversal
    let output_dir = util::project_root().join("output");
    let path = match util::safe_resolve(&output_dir, &filename) {
        Ok(p) => p,
        Err(_) => return (StatusCode::FORBIDDEN, "Access denied").into_response(),
    };

    // Get file metadata for Content-Length
    let meta = match tokio::fs::metadata(&path).await {
        Ok(m) => m,
        Err(_) => return (StatusCode::NOT_FOUND, "Audio not found").into_response(),
    };

    let file_size = meta.len();

    // Open the file for streaming
    let file = match tokio::fs::File::open(&path).await {
        Ok(f) => f,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to open audio").into_response(),
    };

    // Stream in 8KB chunks — never loads the entire file into memory
    let stream = tokio_util::io::ReaderStream::with_capacity(file, 8192);
    let body = Body::from_stream(stream);

    let mut response = axum::response::Response::builder()
        .header(header::CONTENT_TYPE, HeaderValue::from_static("audio/wav"))
        .header(header::CONTENT_LENGTH, HeaderValue::from(file_size))
        .header(header::CACHE_CONTROL, HeaderValue::from_static("public, max-age=86400"))
        .header(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"))
        .header(header::CONTENT_DISPOSITION, HeaderValue::from_static("inline"))
        .body(body)
        .unwrap();

    response.extensions_mut().insert(file_size);
    response
}
