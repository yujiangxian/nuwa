// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

use axum::http::{HeaderValue, Method, StatusCode};
use axum::response::IntoResponse;
use tower_http::cors::{AllowOrigin, CorsLayer};

/// Default allowed origins when NUWA_ALLOWED_ORIGINS is unset or all entries fail to parse.
const DEFAULT_ORIGINS: &[&str] = &["http://localhost:5173"];

/// Header name clients must send when `NUWA_API_KEY` is set.
pub const API_KEY_HEADER: &str = "x-api-key";

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
        let defaults: Vec<_> = DEFAULT_ORIGINS
            .iter()
            .filter_map(|d| d.parse().ok())
            .collect();
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
    headers.insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    headers.insert("x-frame-options", HeaderValue::from_static("DENY"));
    headers.insert("x-xss-protection", HeaderValue::from_static("0"));
    response
}

/// Constant-time string equality (length mismatch still short-circuits on length).
fn keys_equal(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.bytes()
        .zip(b.bytes())
        .fold(0u8, |acc, (x, y)| acc | (x ^ y))
        == 0
}

/// Returns true when the request must present a valid API key (mutating methods).
fn requires_api_key(method: &Method) -> bool {
    !matches!(*method, Method::GET | Method::HEAD | Method::OPTIONS)
}

/// Optional API-key gate controlled by `NUWA_API_KEY`.
///
/// - Unset / empty key → allow all (local-dev convenience).
/// - Set → require matching `X-Api-Key` on every non-GET request.
pub async fn require_api_key(
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    let expected = match std::env::var("NUWA_API_KEY") {
        Ok(k) if !k.is_empty() => k,
        _ => return next.run(request).await,
    };

    if !requires_api_key(request.method()) {
        return next.run(request).await;
    }

    let provided = request
        .headers()
        .get(API_KEY_HEADER)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    if keys_equal(provided, &expected) {
        return next.run(request).await;
    }

    (
        StatusCode::UNAUTHORIZED,
        axum::Json(serde_json::json!({
            "error": "缺少或无效的 X-Api-Key"
        })),
    )
        .into_response()
}

#[cfg(test)]
#[allow(clippy::await_holding_lock)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::Request;
    use axum::middleware::from_fn;
    use axum::routing::{get, post};
    use axum::Router;
    use std::sync::Mutex;
    use tower::ServiceExt;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn app() -> Router {
        Router::new()
            .route("/health", get(|| async { "ok" }))
            .route("/api/config", get(|| async { "cfg" }))
            .route("/api/config", post(|| async { "updated" }))
            .layer(from_fn(require_api_key))
    }

    #[tokio::test]
    #[allow(clippy::await_holding_lock)]
    async fn allows_all_when_api_key_unset() {
        let _g = ENV_LOCK.lock().unwrap();
        std::env::remove_var("NUWA_API_KEY");
        let res = app()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/config")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
    }

    #[tokio::test]
    #[allow(clippy::await_holding_lock)]
    async fn get_allowed_without_key_when_key_configured() {
        let _g = ENV_LOCK.lock().unwrap();
        std::env::set_var("NUWA_API_KEY", "secret-test-key");
        let res = app()
            .oneshot(
                Request::builder()
                    .uri("/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        std::env::remove_var("NUWA_API_KEY");
    }

    #[tokio::test]
    #[allow(clippy::await_holding_lock)]
    async fn post_rejected_without_key_when_key_configured() {
        let _g = ENV_LOCK.lock().unwrap();
        std::env::set_var("NUWA_API_KEY", "secret-test-key");
        let res = app()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/config")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
        std::env::remove_var("NUWA_API_KEY");
    }

    #[tokio::test]
    #[allow(clippy::await_holding_lock)]
    async fn post_allowed_with_matching_key() {
        let _g = ENV_LOCK.lock().unwrap();
        std::env::set_var("NUWA_API_KEY", "secret-test-key");
        let res = app()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/config")
                    .header(API_KEY_HEADER, "secret-test-key")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        std::env::remove_var("NUWA_API_KEY");
    }

    #[test]
    fn keys_equal_rejects_mismatch() {
        assert!(keys_equal("abc", "abc"));
        assert!(!keys_equal("abc", "abd"));
        assert!(!keys_equal("abc", "ab"));
    }
}
