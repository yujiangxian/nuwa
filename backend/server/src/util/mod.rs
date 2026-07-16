// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

//! Shared utilities — paths, formatting, helpers that are used across multiple modules.

pub mod gpu_backend;

use std::path::{Component, Path, PathBuf};

/// Returns the project root directory.
///
/// Resolved once at startup from the executable path, falling back to current
/// working directory. This is the single source of truth — no other module
/// should contain its own `project_root()` copy.
pub fn project_root() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|exe| {
            exe.parent() // target/debug
                .and_then(|p| p.parent()) // target
                .and_then(|p| p.parent()) // server
                .and_then(|p| p.parent()) // backend
                .and_then(|p| p.parent()) // project root
                .map(|p| p.to_path_buf())
        })
        .unwrap_or_else(|| {
            std::env::current_dir()
                .ok()
                .and_then(|cd| {
                    cd.parent()
                        .and_then(|p| p.parent())
                        .map(|p| p.to_path_buf())
                })
                .unwrap_or_else(|| PathBuf::from("."))
        })
}

/// Returns the Python executable for the resolved GPU backend.
///
/// Prefers `envs/ai-cuda` or `envs/ai-rocm`, then `envs/ai` / `ai_env`, then `python`.
pub fn python_exe() -> PathBuf {
    let backend = gpu_backend::resolve_backend();
    gpu_backend::resolve_python_exe(&project_root(), backend)
}

/// Resolve a path to absolute — if relative, join with project_root.
pub fn resolve_path(path: &std::path::Path) -> PathBuf {
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        project_root().join(path)
    }
}

/// Verify that a resolved path stays within the allowed base directory.
/// Returns the canonical path on success, or an error if path traversal is detected.
pub fn safe_resolve(base: &std::path::Path, filename: &str) -> Result<PathBuf, String> {
    let candidate = base.join(filename);
    let canonical =
        std::fs::canonicalize(&candidate).map_err(|e| format!("无法解析路径: {}", e))?;
    let canonical_base =
        std::fs::canonicalize(base).map_err(|e| format!("无法解析基准路径: {}", e))?;
    if !canonical.starts_with(&canonical_base) {
        return Err("路径遍历检测: 不允许访问目录外的文件".to_string());
    }
    Ok(canonical)
}

/// Join `relative` under `base` without requiring the target to exist.
///
/// Rejects absolute paths and any `..` / prefix components. Creates `base` if
/// missing so it can be canonicalized. The returned path is absolute and
/// guaranteed to stay under the canonicalized `base`.
pub fn safe_join_under(base: &Path, relative: &str) -> Result<PathBuf, String> {
    let relative = relative.trim();
    if relative.is_empty() {
        return Err("路径不能为空".to_string());
    }
    let rel = Path::new(relative);
    if rel.is_absolute() {
        return Err("不允许绝对路径".to_string());
    }
    for c in rel.components() {
        match c {
            Component::Normal(_) | Component::CurDir => {}
            _ => {
                return Err("路径包含非法组件（不允许 .. 或前缀）".to_string());
            }
        }
    }

    std::fs::create_dir_all(base).map_err(|e| format!("无法创建基准目录: {}", e))?;
    let base_canon =
        std::fs::canonicalize(base).map_err(|e| format!("无法解析基准路径: {}", e))?;

    let mut out = base_canon.clone();
    for c in rel.components() {
        if let Component::Normal(s) = c {
            out.push(s);
        }
    }
    if !out.starts_with(&base_canon) {
        return Err("路径遍历检测: 不允许访问目录外的文件".to_string());
    }
    Ok(out)
}

/// Resolve a download destination that must remain under `{project_root}/models`.
///
/// Accepts either `models/...` (project-root relative) or a path relative to `models/`.
pub fn resolve_models_dest(dest: &str) -> Result<PathBuf, String> {
    let root = project_root();
    let models_dir = root.join("models");
    let dest = dest.trim().trim_start_matches("./");
    let normalized = dest.replace('\\', "/");
    let joined = if normalized == "models"
        || normalized.starts_with("models/")
    {
        safe_join_under(&root, &normalized)?
    } else {
        safe_join_under(&models_dir, &normalized)?
    };

    std::fs::create_dir_all(&models_dir).map_err(|e| format!("无法创建 models 目录: {}", e))?;
    let models_canon = std::fs::canonicalize(&models_dir)
        .map_err(|e| format!("无法解析 models 目录: {}", e))?;

    if joined != models_canon && !joined.starts_with(&models_canon) {
        return Err("下载目标必须位于 models/ 目录内".to_string());
    }
    Ok(joined)
}

/// Allowed HTTPS hosts for the download manager (HF / mirrors / ModelScope).
const DOWNLOAD_ALLOWED_HOSTS: &[&str] = &[
    "huggingface.co",
    "hf-mirror.com",
    "cdn-lfs.huggingface.co",
    "cdn-lfs-us-1.huggingface.co",
    "cdn-lfs-eu-1.huggingface.co",
    "modelscope.cn",
    "www.modelscope.cn",
];

fn host_allowed(host: &str) -> bool {
    let host = host.trim().trim_end_matches('.').to_ascii_lowercase();
    DOWNLOAD_ALLOWED_HOSTS
        .iter()
        .any(|allowed| host == *allowed || host.ends_with(&format!(".{allowed}")))
}

/// Validate a download URL: HTTPS only + allowlisted hosts (no SSRF to private IPs via raw IP).
pub fn validate_download_url(url: &str) -> Result<(), String> {
    let url = url.trim();
    if !url.to_ascii_lowercase().starts_with("https://") {
        return Err("仅允许 https:// 下载地址".to_string());
    }
    let rest = &url["https://".len()..];
    // strip userinfo if present
    let host_port_path = rest.split_once('@').map(|(_, r)| r).unwrap_or(rest);
    let host_port = host_port_path
        .split(['/', '?', '#'])
        .next()
        .unwrap_or("");
    let host = if let Some((h, _)) = host_port.rsplit_once(']') {
        h.trim_start_matches('[')
    } else {
        host_port.split(':').next().unwrap_or("")
    };

    if host.is_empty() {
        return Err("下载地址缺少主机名".to_string());
    }
    // Reject raw IP literals (SSRF to link-local / metadata)
    if host.parse::<std::net::IpAddr>().is_ok() || host.starts_with('[') {
        return Err("不允许使用 IP 地址作为下载主机".to_string());
    }
    if !host_allowed(host) {
        return Err(format!(
            "下载主机不在白名单内: {}（仅允许 HuggingFace / ModelScope）",
            host
        ));
    }
    Ok(())
}

/// Format a byte count into a human-readable string.
pub fn format_size(bytes: u64) -> String {
    const UNITS: &[&str] = &["B", "KB", "MB", "GB", "TB"];
    let mut size = bytes as f64;
    let mut unit_idx = 0;
    while size >= 1024.0 && unit_idx < UNITS.len() - 1 {
        size /= 1024.0;
        unit_idx += 1;
    }
    if unit_idx == 0 {
        format!("{} {}", bytes, UNITS[unit_idx])
    } else {
        format!("{:.1} {}", size, UNITS[unit_idx])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn safe_join_under_rejects_traversal() {
        let dir = tempfile::tempdir().unwrap();
        assert!(safe_join_under(dir.path(), "../etc/passwd").is_err());
        assert!(safe_join_under(dir.path(), "/etc/passwd").is_err());
        let ok = safe_join_under(dir.path(), "asr/whisper").unwrap();
        assert!(ok.starts_with(fs::canonicalize(dir.path()).unwrap()));
    }

    #[test]
    fn resolve_models_dest_rejects_escape() {
        assert!(resolve_models_dest("../Windows").is_err());
        assert!(resolve_models_dest("models/../../etc").is_err());
    }

    #[test]
    fn validate_download_url_allowlist() {
        assert!(validate_download_url(
            "https://huggingface.co/org/model/resolve/main/file.bin"
        )
        .is_ok());
        assert!(validate_download_url(
            "https://hf-mirror.com/org/model/resolve/main/file.bin"
        )
        .is_ok());
        assert!(validate_download_url(
            "https://www.modelscope.cn/models/x/resolve/master/a.bin"
        )
        .is_ok());
        assert!(validate_download_url("http://huggingface.co/x").is_err());
        assert!(validate_download_url("https://evil.example/x").is_err());
        assert!(validate_download_url("https://127.0.0.1/x").is_err());
        assert!(validate_download_url("https://169.254.169.254/latest").is_err());
        assert!(validate_download_url("file:///etc/passwd").is_err());
    }
}
