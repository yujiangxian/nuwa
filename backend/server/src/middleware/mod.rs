use tower_http::cors::{Any, CorsLayer};

/// 返回 CORS 中间件，允许前端开发服务器跨域访问。
pub fn cors() -> CorsLayer {
    CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any)
}
