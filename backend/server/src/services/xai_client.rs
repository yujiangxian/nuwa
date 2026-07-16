// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

//! xAI API client — chat / images / videos using SuperGrok OAuth bearer.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;
use uuid::Uuid;

use crate::services::xai_oauth::{self, API_BASE};
use crate::util::project_root;

pub fn media_dir() -> PathBuf {
    project_root().join("output").join("xai")
}

fn ensure_media_dir() -> Result<PathBuf, String> {
    let dir = media_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建媒体目录失败: {e}"))?;
    Ok(dir)
}

async fn authed_client() -> Result<(reqwest::Client, String), String> {
    let token = xai_oauth::valid_access_token().await?;
    Ok((reqwest::Client::new(), token))
}

#[derive(Debug, Serialize)]
pub struct StatusResponse {
    pub connected: bool,
    pub email: Option<String>,
    pub source: Option<String>,
    pub models: Vec<String>,
    pub api_base: String,
}

pub async fn status() -> Result<StatusResponse, String> {
    let Some(store) = xai_oauth::load_store() else {
        return Ok(StatusResponse {
            connected: false,
            email: None,
            source: None,
            models: vec![],
            api_base: API_BASE.into(),
        });
    };

    let token = match xai_oauth::valid_access_token().await {
        Ok(t) => t,
        Err(_) => {
            return Ok(StatusResponse {
                connected: false,
                email: store.email,
                source: Some(store.source),
                models: vec![],
                api_base: API_BASE.into(),
            });
        }
    };

    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{API_BASE}/models"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("拉取模型列表失败: {e}"))?;

    let mut models = Vec::new();
    if resp.status().is_success() {
        let v: Value = resp.json().await.unwrap_or(json!({}));
        if let Some(arr) = v.get("data").and_then(|d| d.as_array()) {
            for m in arr {
                if let Some(id) = m.get("id").and_then(|i| i.as_str()) {
                    models.push(id.to_string());
                }
            }
        }
    }

    Ok(StatusResponse {
        connected: true,
        email: store.email,
        source: Some(store.source),
        models,
        api_base: API_BASE.into(),
    })
}

#[derive(Debug, Deserialize)]
pub struct ChatStreamRequest {
    pub model: Option<String>,
    pub system: Option<String>,
    pub messages: Vec<ChatMessageIn>,
    pub temperature: Option<f32>,
    pub top_p: Option<f32>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ChatMessageIn {
    pub role: String,
    pub content: String,
}

/// Proxy OpenAI-compatible chat completions SSE from api.x.ai.
pub async fn chat_completions_stream(
    req: ChatStreamRequest,
) -> Result<reqwest::Response, String> {
    let (client, token) = authed_client().await?;
    let mut messages = req.messages;
    if let Some(sys) = req.system.filter(|s| !s.trim().is_empty()) {
        messages.insert(
            0,
            ChatMessageIn {
                role: "system".into(),
                content: sys,
            },
        );
    }

    let body = json!({
        "model": req.model.unwrap_or_else(|| "grok-build-0.1".into()),
        "stream": true,
        "messages": messages,
        "temperature": req.temperature,
        "top_p": req.top_p,
    });

    let resp = client
        .post(format!("{API_BASE}/chat/completions"))
        .bearer_auth(&token)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("xAI chat 请求失败: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("xAI chat HTTP {status}: {text}"));
    }
    Ok(resp)
}

#[derive(Debug, Deserialize)]
pub struct ImageRequest {
    pub prompt: String,
    pub model: Option<String>,
    /// Optional public URL or data URI for image edit.
    pub image_url: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct MediaResult {
    pub url: String,
    pub local_path: String,
    pub kind: String,
    pub prompt: String,
    pub model: String,
}

pub async fn generate_image(req: ImageRequest) -> Result<MediaResult, String> {
    let (client, token) = authed_client().await?;
    let model = req
        .model
        .unwrap_or_else(|| "grok-imagine-image".into());
    let prompt = req.prompt.trim().to_string();
    if prompt.is_empty() {
        return Err("图像提示词不能为空".into());
    }

    let (endpoint, body) = if let Some(image_url) = req.image_url.filter(|u| !u.is_empty()) {
        (
            format!("{API_BASE}/images/edits"),
            json!({
                "model": model,
                "prompt": prompt,
                "image": { "url": image_url, "type": "image_url" },
            }),
        )
    } else {
        (
            format!("{API_BASE}/images/generations"),
            json!({
                "model": model,
                "prompt": prompt,
                "n": 1,
            }),
        )
    };

    let resp = client
        .post(&endpoint)
        .bearer_auth(&token)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("图像生成请求失败: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("图像生成失败 ({status}): {text}"));
    }

    let v: Value = resp
        .json()
        .await
        .map_err(|e| format!("解析图像响应失败: {e}"))?;
    let remote = v
        .pointer("/data/0/url")
        .and_then(|u| u.as_str())
        .ok_or_else(|| "图像响应缺少 url".to_string())?
        .to_string();

    let filename = format!("{}.png", Uuid::new_v4());
    let local = download_to_media(&client, &remote, &filename).await?;
    Ok(MediaResult {
        url: format!("/api/media/xai/{filename}"),
        local_path: local.display().to_string(),
        kind: "image".into(),
        prompt,
        model,
    })
}

#[derive(Debug, Deserialize)]
pub struct VideoRequest {
    pub prompt: String,
    pub model: Option<String>,
    pub duration: Option<u32>,
    pub aspect_ratio: Option<String>,
    pub resolution: Option<String>,
    pub image_url: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct VideoSubmitResult {
    pub request_id: String,
    pub status: String,
}

#[derive(Debug, Serialize)]
pub struct VideoPollResult {
    pub request_id: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub prompt: String,
    pub model: String,
}

pub async fn submit_video(req: VideoRequest) -> Result<VideoSubmitResult, String> {
    let (client, token) = authed_client().await?;
    let model = req
        .model
        .unwrap_or_else(|| "grok-imagine-video".into());
    let prompt = req.prompt.trim().to_string();
    if prompt.is_empty() {
        return Err("视频提示词不能为空".into());
    }
    let duration = req.duration.unwrap_or(8).clamp(1, 15);

    let mut body = json!({
        "model": model,
        "prompt": prompt,
        "duration": duration,
    });
    if let Some(ar) = req.aspect_ratio {
        body["aspect_ratio"] = json!(ar);
    }
    if let Some(res) = req.resolution {
        body["resolution"] = json!(res);
    }
    if let Some(image_url) = req.image_url.filter(|u| !u.is_empty()) {
        body["image"] = json!({ "url": image_url });
    }

    let resp = client
        .post(format!("{API_BASE}/videos/generations"))
        .bearer_auth(&token)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("视频提交失败: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("视频提交失败 ({status}): {text}"));
    }

    let v: Value = resp
        .json()
        .await
        .map_err(|e| format!("解析视频提交响应失败: {e}"))?;
    let request_id = v
        .get("request_id")
        .and_then(|r| r.as_str())
        .ok_or_else(|| "视频响应缺少 request_id".to_string())?
        .to_string();

    // Stash prompt/model for poll response enrichment (best-effort file).
    let _ = save_video_meta(&request_id, &prompt, &model);

    Ok(VideoSubmitResult {
        request_id,
        status: "pending".into(),
    })
}

fn video_meta_path(request_id: &str) -> PathBuf {
    media_dir().join(format!("{request_id}.meta.json"))
}

fn save_video_meta(request_id: &str, prompt: &str, model: &str) -> Result<(), String> {
    let _ = ensure_media_dir()?;
    let path = video_meta_path(request_id);
    let json = json!({ "prompt": prompt, "model": model });
    std::fs::write(path, json.to_string()).map_err(|e| e.to_string())
}

fn load_video_meta(request_id: &str) -> (String, String) {
    let path = video_meta_path(request_id);
    let Ok(raw) = std::fs::read_to_string(path) else {
        return (String::new(), "grok-imagine-video".into());
    };
    let Ok(v) = serde_json::from_str::<Value>(&raw) else {
        return (String::new(), "grok-imagine-video".into());
    };
    (
        v.get("prompt")
            .and_then(|p| p.as_str())
            .unwrap_or("")
            .to_string(),
        v.get("model")
            .and_then(|m| m.as_str())
            .unwrap_or("grok-imagine-video")
            .to_string(),
    )
}

pub async fn poll_video(request_id: &str) -> Result<VideoPollResult, String> {
    let (client, token) = authed_client().await?;
    let (prompt, model) = load_video_meta(request_id);

    let resp = client
        .get(format!("{API_BASE}/videos/{request_id}"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("视频轮询失败: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("视频轮询失败 ({status}): {text}"));
    }

    let v: Value = resp
        .json()
        .await
        .map_err(|e| format!("解析视频状态失败: {e}"))?;
    let status = v
        .get("status")
        .and_then(|s| s.as_str())
        .unwrap_or("pending")
        .to_string();

    if status == "done" || status == "completed" {
        let remote = v
            .pointer("/video/url")
            .or_else(|| v.pointer("/url"))
            .and_then(|u| u.as_str())
            .ok_or_else(|| "视频完成但缺少 url".to_string())?
            .to_string();
        let filename = format!("{request_id}.mp4");
        let _local = download_to_media(&client, &remote, &filename).await?;
        return Ok(VideoPollResult {
            request_id: request_id.to_string(),
            status: "done".into(),
            url: Some(format!("/api/media/xai/{filename}")),
            error: None,
            prompt,
            model,
        });
    }

    if status == "failed" || status == "expired" {
        let err = v
            .get("error")
            .and_then(|e| e.as_str())
            .unwrap_or("视频生成失败")
            .to_string();
        return Ok(VideoPollResult {
            request_id: request_id.to_string(),
            status: status.clone(),
            url: None,
            error: Some(err),
            prompt,
            model,
        });
    }

    Ok(VideoPollResult {
        request_id: request_id.to_string(),
        status,
        url: None,
        error: None,
        prompt,
        model,
    })
}

async fn download_to_media(
    client: &reqwest::Client,
    remote_url: &str,
    filename: &str,
) -> Result<PathBuf, String> {
    let dir = ensure_media_dir()?;
    let dest = dir.join(filename);
    let resp = client
        .get(remote_url)
        .send()
        .await
        .map_err(|e| format!("下载媒体失败: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("下载媒体 HTTP {}", resp.status()));
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("读取媒体字节失败: {e}"))?;
    tokio::fs::write(&dest, &bytes)
        .await
        .map_err(|e| format!("写入媒体失败: {e}"))?;
    Ok(dest)
}
