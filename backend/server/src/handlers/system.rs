// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

use axum::{extract::State, Json};
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::{constants, state::AppState};

#[derive(serde::Serialize)]
pub struct DirectorySize {
    pub path: String,
    pub bytes: u64,
    pub text: String,
}

#[derive(serde::Serialize)]
pub struct DiskInfo {
    pub total_bytes: u64,
    pub free_bytes: u64,
    pub used_bytes: u64,
    pub total_text: String,
    pub free_text: String,
    pub used_text: String,
    pub used_percent: f64,
    /// Per-directory size breakdown
    pub directories: Vec<DirectorySize>,
}

#[derive(serde::Serialize)]
pub struct GpuInfo {
    pub name: String,
    pub total_vram_mb: u64,
    pub used_vram_mb: u64,
    pub free_vram_mb: u64,
    pub usage_percent: f64,
}

pub async fn get_disk_info(State(state): State<Arc<RwLock<AppState>>>) -> Json<DiskInfo> {
    let state = state.read().await;
    let project_root = crate::util::project_root();

    let models_dir = std::path::PathBuf::from(&state.config.models_dir);
    let models_dir = if models_dir.is_relative() {
        project_root.join(&models_dir)
    } else {
        models_dir
    };

    let mut disk_info = if let Ok(info) = get_disk_space(&models_dir) {
        info
    } else {
        DiskInfo {
            total_bytes: 0,
            free_bytes: 0,
            used_bytes: 0,
            total_text: "未知".to_string(),
            free_text: "未知".to_string(),
            used_text: "未知".to_string(),
            used_percent: 0.0,
            directories: vec![],
        }
    };

    // Per-directory size breakdown
    let output_dir = if state.config.output_dir.is_empty() {
        project_root.join("output")
    } else {
        let p = std::path::PathBuf::from(&state.config.output_dir);
        if p.is_relative() {
            project_root.join(p)
        } else {
            p
        }
    };
    let voices_dir = if state.config.voices_dir.is_empty() {
        project_root.join("assets/datasets/voices")
    } else {
        let p = std::path::PathBuf::from(&state.config.voices_dir);
        if p.is_relative() {
            project_root.join(p)
        } else {
            p
        }
    };

    disk_info.directories = vec![
        dir_size(&models_dir, "models").await,
        dir_size(&output_dir, "output (TTS)").await,
        dir_size(&voices_dir, "voices").await,
    ];

    Json(disk_info)
}

async fn dir_size(dir: &std::path::Path, label: &str) -> DirectorySize {
    let dir = dir.to_path_buf();
    let bytes = tokio::task::spawn_blocking(move || compute_dir_size(&dir))
        .await
        .unwrap_or(0);
    DirectorySize {
        path: label.to_string(),
        bytes,
        text: format_size(bytes),
    }
}

fn compute_dir_size(dir: &std::path::Path) -> u64 {
    let mut total = 0u64;
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                if meta.is_dir() {
                    total += compute_dir_size(&entry.path());
                } else {
                    total += meta.len();
                }
            }
        }
    }
    total
}

pub async fn get_gpu_info() -> Json<Option<GpuInfo>> {
    let info = query_gpu_info().await;
    Json(info)
}

async fn query_gpu_info() -> Option<GpuInfo> {
    // 尝试 AMD ROCm SMI
    if let Some(info) = query_rocm_smi().await {
        return Some(info);
    }
    // 尝试 NVIDIA SMI
    if let Some(info) = query_nvidia_smi().await {
        return Some(info);
    }
    tracing::info!("No GPU detected (rocm-smi and nvidia-smi unavailable)");
    None
}

async fn query_rocm_smi() -> Option<GpuInfo> {
    let output = tokio::process::Command::new("rocm-smi")
        .args(["--showmeminfo", "VRAM"])
        .output()
        .await
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    // rocm-smi --showmeminfo VRAM 输出示例：
    // GPU  VRAM Total Memory (B)  VRAM Total Used Memory (B)
    // 0    17163091968            8589934592
    let mut lines = text.lines();
    let _header = lines.next()?;
    for line in lines {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 3 {
            let total = parts[1].parse::<u64>().ok()?;
            let used = parts[2].parse::<u64>().ok()?;
            let total_mb = total / (1024 * 1024);
            let used_mb = used / (1024 * 1024);
            return Some(GpuInfo {
                name: "AMD GPU".to_string(),
                total_vram_mb: total_mb,
                used_vram_mb: used_mb,
                free_vram_mb: total_mb.saturating_sub(used_mb),
                usage_percent: if total > 0 {
                    (used as f64 / total as f64) * 100.0
                } else {
                    0.0
                },
            });
        }
    }
    None
}

async fn query_nvidia_smi() -> Option<GpuInfo> {
    let output = tokio::process::Command::new("nvidia-smi")
        .args([
            "--query-gpu=name,memory.total,memory.used",
            "--format=csv,noheader,nounits",
        ])
        .output()
        .await
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    // 输出示例：NVIDIA GeForce RTX 4090, 24564, 1024
    let line = text.lines().next()?;
    let parts: Vec<&str> = line.split(',').map(|s| s.trim()).collect();
    if parts.len() >= 3 {
        let name = parts[0].to_string();
        let total = parts[1].parse::<u64>().ok()?;
        let used = parts[2].parse::<u64>().ok()?;
        return Some(GpuInfo {
            name,
            total_vram_mb: total,
            used_vram_mb: used,
            free_vram_mb: total.saturating_sub(used),
            usage_percent: if total > 0 {
                (used as f64 / total as f64) * 100.0
            } else {
                0.0
            },
        });
    }
    None
}

fn get_disk_space(path: &std::path::Path) -> std::io::Result<DiskInfo> {
    let stat = fs2::statvfs(path)?;
    let total_bytes = stat.total_space();
    let free_bytes = stat.available_space();
    let used_bytes = total_bytes.saturating_sub(free_bytes);
    let used_percent = if total_bytes > 0 {
        (used_bytes as f64 / total_bytes as f64) * 100.0
    } else {
        0.0
    };

    Ok(DiskInfo {
        total_bytes,
        free_bytes,
        used_bytes,
        total_text: format_size(total_bytes),
        free_text: format_size(free_bytes),
        used_text: format_size(used_bytes),
        used_percent,
        directories: vec![],
    })
}

#[derive(serde::Serialize)]
pub struct CleanupResult {
    pub files_removed: u64,
    pub bytes_freed: u64,
    pub bytes_freed_text: String,
}

/// Manual cleanup endpoint: remove stale TTS output files and temp files.
pub async fn cleanup(State(state): State<Arc<RwLock<AppState>>>) -> Json<CleanupResult> {
    let state = state.read().await;
    let project_root = crate::util::project_root();
    let output_dir = state.config.output_dir.clone();
    let output_dir = if output_dir.is_empty() {
        project_root.join("output")
    } else {
        let p = std::path::PathBuf::from(&output_dir);
        if p.is_relative() {
            project_root.join(p)
        } else {
            p
        }
    };

    let mut total_removed = 0u64;
    let mut total_bytes = 0u64;

    // Clean output/ WAV files (same retention window as startup cleanup)
    let retention = constants::tts_retention_secs();
    let cutoff = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .saturating_sub(std::time::Duration::from_secs(retention));

    if let Ok(entries) = std::fs::read_dir(&output_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map(|e| e == "wav").unwrap_or(false) {
                if let Ok(meta) = entry.metadata() {
                    if let Ok(mtime) = meta.modified() {
                        if mtime
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            < cutoff
                        {
                            total_bytes += meta.len();
                            if std::fs::remove_file(&path).is_ok() {
                                total_removed += 1;
                            }
                        }
                    }
                }
            }
        }
    }

    // Clean system temp nuwa_* files
    if let Ok(entries) = std::fs::read_dir(std::env::temp_dir()) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            if name.to_string_lossy().starts_with("nuwa_") {
                if let Ok(meta) = entry.metadata() {
                    total_bytes += meta.len();
                    if std::fs::remove_file(entry.path()).is_ok() {
                        total_removed += 1;
                    }
                }
            }
        }
    }

    Json(CleanupResult {
        files_removed: total_removed,
        bytes_freed: total_bytes,
        bytes_freed_text: format_size(total_bytes),
    })
}

fn format_size(bytes: u64) -> String {
    if bytes >= 1024 * 1024 * 1024 * 1024 {
        format!(
            "{:.1} TB",
            bytes as f64 / (1024.0 * 1024.0 * 1024.0 * 1024.0)
        )
    } else if bytes >= 1024 * 1024 * 1024 {
        format!("{:.1} GB", bytes as f64 / (1024.0 * 1024.0 * 1024.0))
    } else if bytes >= 1024 * 1024 {
        format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
    } else if bytes >= 1024 {
        format!("{:.1} KB", bytes as f64 / 1024.0)
    } else {
        format!("{} B", bytes)
    }
}
