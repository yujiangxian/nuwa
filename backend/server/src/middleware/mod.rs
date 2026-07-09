// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

use axum::http::HeaderValue;
use tower_http::cors::{AllowOrigin, CorsLayer};

/// Default allowed origins when NUWA_ALLOWED_ORIGINS is unset or all entries fail to parse.
const DEFAULT_ORIGINS: &[&str] = &["http://localhost:5173"];

/// Returns a CORS middleware layer restricted to the given allowed origins.
/// In development this defaults to `http://localhost:5173`; in production
/// it should be set via the `NUWA_ALLOWED_ORIGINS` env var.
///
/// Invalid origin strings are skipped with a warning log instead of panicking,
/// so a single misconfigured entry cannot crash the entire server.
pub fn cors(allowed_origins: &[String]) -> CorsLayer {
    let origins: Vec<_> = allowed_origins
        .iter()
        .filter_map(|o| match o.parse() {
            Ok(parsed) => Some(parsed),
            Err(e) => {
                tracing::warn!(origin = %o, error = %e, "Skipping invalid CORS origin");
                None
            }
        })
        .collect();

    if origins.is_empty() {
        tracing::warn!(
            "No valid CORS origins parsed, falling back to defaults: {:?}",
            DEFAULT_ORIGINS
        );
        let defaults: Vec<_> = DEFAULT_ORIGINS.iter().filter_map(|d| d.parse().ok()).collect();
        return CorsLayer::new()
            .allow_origin(AllowOrigin::list(defaults))
            .allow_methods(tower_http::cors::Any)
            .allow_headers(tower_http::cors::Any);
    }

    CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_methods(tower_http::cors::Any)
        .allow_headers(tower_http::cors::Any)
}

/// Axum middleware: injects standard security headers on every response.
pub async fn inject_security_headers(
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    headers.insert("x-content-type-options", HeaderValue::from_static("nosniff"));
    headers.insert("x-frame-options", HeaderValue::from_static("DENY"));
    headers.insert("x-xss-protection", HeaderValue::from_static("0"));
    response
}
