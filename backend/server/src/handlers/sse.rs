// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

use axum::response::sse::{Event, Sse};
use futures::stream::Stream;
use std::{convert::Infallible, time::Duration};
use tokio_stream::StreamExt;

/// SSE 进度推送端点。
/// 前端通过 EventSource 连接，实时接收下载/生成进度。
pub async fn progress_stream() -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let stream = tokio_stream::iter(0..)
        .throttle(Duration::from_secs(1))
        .map(|i| {
            let data = serde_json::json!({
                "type": "heartbeat",
                "seq": i,
                "timestamp": chrono::Utc::now().to_rfc3339(),
            });
            Ok(Event::default().data(data.to_string()))
        });

    Sse::new(stream).keep_alive(
        axum::response::sse::KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keep-alive"),
    )
}
