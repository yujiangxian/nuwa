//! Shared utilities — paths, formatting, helpers that are used across multiple modules.

use std::path::PathBuf;

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
                .and_then(|cd| cd.parent().and_then(|p| p.parent()).map(|p| p.to_path_buf()))
                .unwrap_or_else(|| PathBuf::from("."))
        })
}

/// Returns the Python executable path, preferring virtual environments.
pub fn python_exe() -> PathBuf {
    let candidates = [
        project_root().join("envs/ai/Scripts/python.exe"),
        project_root().join("ai_env/Scripts/python.exe"),
        PathBuf::from("python"),
        PathBuf::from("python3"),
    ];
    for c in &candidates {
        if c.exists() || c.to_string_lossy() == "python" || c.to_string_lossy() == "python3" {
            return c.clone();
        }
    }
    PathBuf::from("python")
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
    let canonical = std::fs::canonicalize(&candidate)
        .map_err(|e| format!("无法解析路径: {}", e))?;
    let canonical_base = std::fs::canonicalize(base)
        .map_err(|e| format!("无法解析基准路径: {}", e))?;
    if !canonical.starts_with(&canonical_base) {
        return Err("路径遍历检测: 不允许访问目录外的文件".to_string());
    }
    Ok(canonical)
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
