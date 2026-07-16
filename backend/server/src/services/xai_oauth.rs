// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

//! SuperGrok / Grok Build OAuth — device-code + refresh + import from official CLI.
//!
//! Reuses the public Grok-CLI client_id (allowlisted by xAI). Tokens are stored
//! under `{project_root}/data/xai_oauth.json` (never returned to the browser).

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Instant;

use crate::util::project_root;

pub const CLIENT_ID: &str = "b1a00492-073a-47ea-816f-4c329264a828";
pub const ISSUER: &str = "https://auth.x.ai";
pub const TOKEN_URL: &str = "https://auth.x.ai/oauth2/token";
pub const DEVICE_CODE_URL: &str = "https://auth.x.ai/oauth2/device/code";
pub const SCOPE: &str = "openid profile email offline_access grok-cli:access api:access conversations:read conversations:write";
pub const API_BASE: &str = "https://api.x.ai/v1";

/// Refresh when fewer than this many seconds remain.
const REFRESH_SKEW_SECS: i64 = 120;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct XaiTokenStore {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: DateTime<Utc>,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub client_id: String,
    #[serde(default)]
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DeviceStart {
    pub user_code: String,
    pub verification_uri: String,
    pub verification_uri_complete: Option<String>,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Debug, Clone)]
struct PendingDevice {
    device_code: String,
    interval: u64,
    deadline: Instant,
    last_poll: Instant,
}

static PENDING: Mutex<Option<PendingDevice>> = Mutex::new(None);

fn store_path() -> PathBuf {
    project_root().join("data").join("xai_oauth.json")
}

fn ensure_data_dir() -> Result<PathBuf, String> {
    let dir = project_root().join("data");
    std::fs::create_dir_all(&dir).map_err(|e| format!("无法创建 data 目录: {e}"))?;
    Ok(dir)
}

pub fn load_store() -> Option<XaiTokenStore> {
    let path = store_path();
    let raw = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str(&raw).ok()
}

pub fn save_store(store: &XaiTokenStore) -> Result<(), String> {
    ensure_data_dir()?;
    let path = store_path();
    let tmp = path.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, json).map_err(|e| format!("写入 token 失败: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("保存 token 失败: {e}"))?;
    Ok(())
}

pub fn clear_store() -> Result<(), String> {
    let path = store_path();
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| format!("清除 token 失败: {e}"))?;
    }
    let mut guard = PENDING.lock().map_err(|e| e.to_string())?;
    *guard = None;
    Ok(())
}

pub fn is_connected() -> bool {
    load_store().is_some_and(|s| !s.refresh_token.is_empty() || !s.access_token.is_empty())
}

/// Import tokens from official Grok Build CLI (`~/.grok/auth.json`).
pub fn import_from_grok_cli() -> Result<XaiTokenStore, String> {
    let home = dirs_home().ok_or_else(|| "无法解析用户主目录".to_string())?;
    let path = home.join(".grok").join("auth.json");
    import_from_grok_cli_path(&path)
}

fn dirs_home() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

pub fn import_from_grok_cli_path(path: &Path) -> Result<XaiTokenStore, String> {
    let raw = std::fs::read_to_string(path)
        .map_err(|e| format!("读取 {} 失败: {e}", path.display()))?;
    let v: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| format!("解析 Grok auth.json 失败: {e}"))?;
    let obj = v
        .as_object()
        .ok_or_else(|| "Grok auth.json 格式无效".to_string())?;

    let entry = obj
        .values()
        .find(|e| {
            e.get("key").and_then(|k| k.as_str()).is_some()
                && e.get("refresh_token").and_then(|k| k.as_str()).is_some()
        })
        .or_else(|| obj.values().next())
        .ok_or_else(|| "Grok auth.json 中没有可用凭证".to_string())?;

    let access = entry
        .get("key")
        .and_then(|k| k.as_str())
        .ok_or_else(|| "缺少 access token (key)".to_string())?
        .to_string();
    let refresh = entry
        .get("refresh_token")
        .and_then(|k| k.as_str())
        .unwrap_or("")
        .to_string();
    if refresh.is_empty() {
        return Err("Grok 凭证缺少 refresh_token，请先在终端执行 grok login".into());
    }

    let expires_at = entry
        .get("expires_at")
        .and_then(|k| k.as_str())
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.with_timezone(&Utc))
        .unwrap_or_else(|| Utc::now() + Duration::hours(1));

    let email = entry
        .get("email")
        .and_then(|k| k.as_str())
        .map(|s| s.to_string());
    let client_id = entry
        .get("oidc_client_id")
        .and_then(|k| k.as_str())
        .unwrap_or(CLIENT_ID)
        .to_string();

    let store = XaiTokenStore {
        access_token: access,
        refresh_token: refresh,
        expires_at,
        email,
        client_id,
        source: "grok-cli".into(),
    };
    save_store(&store)?;
    Ok(store)
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    expires_in: Option<u64>,
}

pub async fn refresh_access_token(store: &XaiTokenStore) -> Result<XaiTokenStore, String> {
    let client = reqwest::Client::new();
    let resp = client
        .post(TOKEN_URL)
        .header("Accept", "application/json")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", store.refresh_token.as_str()),
            (
                "client_id",
                if store.client_id.is_empty() {
                    CLIENT_ID
                } else {
                    store.client_id.as_str()
                },
            ),
        ])
        .send()
        .await
        .map_err(|e| format!("刷新 token 网络错误: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("刷新 token 失败 ({status}): {text}"));
    }

    let body: TokenResponse = resp
        .json()
        .await
        .map_err(|e| format!("解析刷新响应失败: {e}"))?;
    let expires_in = body.expires_in.unwrap_or(21600) as i64;
    let next = XaiTokenStore {
        access_token: body.access_token,
        refresh_token: body
            .refresh_token
            .unwrap_or_else(|| store.refresh_token.clone()),
        expires_at: Utc::now() + Duration::seconds(expires_in),
        email: store.email.clone(),
        client_id: if store.client_id.is_empty() {
            CLIENT_ID.to_string()
        } else {
            store.client_id.clone()
        },
        source: store.source.clone(),
    };
    save_store(&next)?;
    Ok(next)
}

/// Return a valid access token, refreshing if needed.
pub async fn valid_access_token() -> Result<String, String> {
    let store = load_store().ok_or_else(|| {
        "尚未连接 SuperGrok。请在设置中导入 Grok Build 登录，或完成设备码登录。".to_string()
    })?;
    let skew = Duration::seconds(REFRESH_SKEW_SECS);
    if store.expires_at > Utc::now() + skew {
        return Ok(store.access_token);
    }
    let refreshed = refresh_access_token(&store).await?;
    Ok(refreshed.access_token)
}

#[derive(Deserialize)]
struct DeviceCodeResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    #[serde(default)]
    verification_uri_complete: Option<String>,
    expires_in: u64,
    #[serde(default)]
    interval: Option<u64>,
}

pub async fn start_device_code() -> Result<DeviceStart, String> {
    let client = reqwest::Client::new();
    let resp = client
        .post(DEVICE_CODE_URL)
        .header("Accept", "application/json")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .form(&[("client_id", CLIENT_ID), ("scope", SCOPE)])
        .send()
        .await
        .map_err(|e| format!("启动设备码登录失败: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("设备码请求失败 ({status}): {text}"));
    }

    let body: DeviceCodeResponse = resp
        .json()
        .await
        .map_err(|e| format!("解析设备码响应失败: {e}"))?;
    let interval = body.interval.unwrap_or(5).max(1);

    {
        let mut guard = PENDING.lock().map_err(|e| e.to_string())?;
        *guard = Some(PendingDevice {
            device_code: body.device_code,
            interval,
            deadline: Instant::now() + std::time::Duration::from_secs(body.expires_in),
            last_poll: Instant::now()
                .checked_sub(std::time::Duration::from_secs(interval))
                .unwrap_or_else(Instant::now),
        });
    }

    Ok(DeviceStart {
        user_code: body.user_code,
        verification_uri: body.verification_uri,
        verification_uri_complete: body.verification_uri_complete,
        expires_in: body.expires_in,
        interval,
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status")]
pub enum AuthPollStatus {
    #[serde(rename = "idle")]
    Idle,
    #[serde(rename = "pending")]
    Pending { user_hint: String },
    #[serde(rename = "connected")]
    Connected { email: Option<String> },
    #[serde(rename = "error")]
    Error { message: String },
}

pub async fn poll_device_code() -> Result<AuthPollStatus, String> {
    if let Some(store) = load_store() {
        if !store.access_token.is_empty() {
            return Ok(AuthPollStatus::Connected {
                email: store.email.clone(),
            });
        }
    }

    let pending = {
        let guard = PENDING.lock().map_err(|e| e.to_string())?;
        guard.clone()
    };

    let Some(mut pending) = pending else {
        return Ok(AuthPollStatus::Idle);
    };

    if Instant::now() >= pending.deadline {
        let mut guard = PENDING.lock().map_err(|e| e.to_string())?;
        *guard = None;
        return Ok(AuthPollStatus::Error {
            message: "设备码已过期，请重新开始登录".into(),
        });
    }

    let wait = std::time::Duration::from_secs(pending.interval);
    if pending.last_poll.elapsed() < wait {
        return Ok(AuthPollStatus::Pending {
            user_hint: "等待浏览器确认…".into(),
        });
    }

    let client = reqwest::Client::new();
    let resp = client
        .post(TOKEN_URL)
        .header("Accept", "application/json")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .form(&[
            (
                "grant_type",
                "urn:ietf:params:oauth:grant-type:device_code",
            ),
            ("device_code", pending.device_code.as_str()),
            ("client_id", CLIENT_ID),
        ])
        .send()
        .await
        .map_err(|e| format!("轮询 token 失败: {e}"))?;

    pending.last_poll = Instant::now();
    {
        let mut guard = PENDING.lock().map_err(|e| e.to_string())?;
        if let Some(p) = guard.as_mut() {
            p.last_poll = pending.last_poll;
        }
    }

    if resp.status().is_success() {
        let body: TokenResponse = resp
            .json()
            .await
            .map_err(|e| format!("解析 token 失败: {e}"))?;
        let refresh = body
            .refresh_token
            .ok_or_else(|| "登录成功但未返回 refresh_token".to_string())?;
        let expires_in = body.expires_in.unwrap_or(21600) as i64;
        let store = XaiTokenStore {
            access_token: body.access_token,
            refresh_token: refresh,
            expires_at: Utc::now() + Duration::seconds(expires_in),
            email: None,
            client_id: CLIENT_ID.to_string(),
            source: "device-code".into(),
        };
        save_store(&store)?;
        let mut guard = PENDING.lock().map_err(|e| e.to_string())?;
        *guard = None;
        return Ok(AuthPollStatus::Connected {
            email: store.email.clone(),
        });
    }

    let text = resp.text().await.unwrap_or_default();
    if text.contains("authorization_pending") || text.contains("slow_down") {
        return Ok(AuthPollStatus::Pending {
            user_hint: "请在浏览器完成授权".into(),
        });
    }
    if text.contains("expired_token") {
        let mut guard = PENDING.lock().map_err(|e| e.to_string())?;
        *guard = None;
        return Ok(AuthPollStatus::Error {
            message: "设备码已过期".into(),
        });
    }

    Ok(AuthPollStatus::Error {
        message: format!("登录失败: {text}"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn import_parses_grok_cli_shape() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("auth.json");
        let mut f = std::fs::File::create(&path).unwrap();
        write!(
            f,
            r#"{{
              "https://auth.x.ai::{CLIENT_ID}": {{
                "key": "access-abc",
                "refresh_token": "refresh-xyz",
                "expires_at": "2099-01-01T00:00:00Z",
                "email": "a@b.com",
                "oidc_client_id": "{CLIENT_ID}"
              }}
            }}"#
        )
        .unwrap();
        let store = import_from_grok_cli_path(&path).unwrap();
        assert_eq!(store.access_token, "access-abc");
        assert_eq!(store.refresh_token, "refresh-xyz");
        assert_eq!(store.email.as_deref(), Some("a@b.com"));
    }
}
