// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

//! GPU backend resolution: `NUWA_GPU_BACKEND` override + SMI detection + Python venv paths.

use std::path::{Path, PathBuf};
use std::process::Command;

/// Concrete GPU backend used for venv selection and inference env injection.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GpuBackend {
    Cuda,
    Rocm,
    Cpu,
}

impl GpuBackend {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Cuda => "cuda",
            Self::Rocm => "rocm",
            Self::Cpu => "cpu",
        }
    }
}

/// Parse `NUWA_GPU_BACKEND` value. Returns `None` for unset/empty/`auto`/invalid.
pub fn parse_override(raw: Option<&str>) -> Option<GpuBackend> {
    let s = raw?.trim();
    if s.is_empty() {
        return None;
    }
    match s.to_ascii_lowercase().as_str() {
        "auto" => None,
        "cuda" => Some(GpuBackend::Cuda),
        "rocm" => Some(GpuBackend::Rocm),
        "cpu" => Some(GpuBackend::Cpu),
        other => {
            tracing::warn!(value = other, "Invalid NUWA_GPU_BACKEND; treating as auto");
            None
        }
    }
}

/// Ordered Python executable candidates for a concrete backend under `root`.
pub fn python_candidates(root: &Path, backend: GpuBackend) -> Vec<PathBuf> {
    let mut out = Vec::new();
    match backend {
        GpuBackend::Cuda => {
            out.push(root.join("envs/ai-cuda/Scripts/python.exe"));
            out.push(root.join("envs/ai-cuda/bin/python"));
        }
        GpuBackend::Rocm => {
            out.push(root.join("envs/ai-rocm/Scripts/python.exe"));
            out.push(root.join("envs/ai-rocm/bin/python"));
        }
        GpuBackend::Cpu => {}
    }
    out.push(root.join("envs/ai/Scripts/python.exe"));
    out.push(root.join("envs/ai/bin/python"));
    out.push(root.join("ai_env/Scripts/python.exe"));
    out.push(root.join("ai_env/bin/python"));
    out
}

/// Pick first existing candidate, else `python` fallback.
pub fn resolve_python_exe(root: &Path, backend: GpuBackend) -> PathBuf {
    for c in python_candidates(root, backend) {
        if c.exists() {
            return c;
        }
    }
    PathBuf::from("python")
}

/// Sync probe: whether an SMI tool appears runnable.
pub fn smi_available(tool: &str) -> bool {
    // Prefer a lightweight query; fall back to `--help` / bare invoke.
    let attempts: &[&[&str]] = match tool {
        "nvidia-smi" => &[&["-L"], &["--help"]],
        "rocm-smi" => &[&["--showproductname"], &["--help"]],
        _ => &[&["--help"]],
    };
    for args in attempts {
        if let Ok(output) = Command::new(tool).args(*args).output() {
            if output.status.success() {
                return true;
            }
        }
    }
    // Last resort: executable exists on PATH (Windows `where`).
    Command::new("where")
        .arg(tool)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Auto-detect concrete backend. Prefer CUDA when both present.
pub fn detect_backend() -> GpuBackend {
    if smi_available("nvidia-smi") {
        return GpuBackend::Cuda;
    }
    if smi_available("rocm-smi") {
        return GpuBackend::Rocm;
    }
    GpuBackend::Cpu
}

/// Resolve: concrete override wins; otherwise auto-detect.
pub fn resolve_backend() -> GpuBackend {
    match parse_override(std::env::var("NUWA_GPU_BACKEND").ok().as_deref()) {
        Some(b) => b,
        None => detect_backend(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn parse_override_accepts_cuda_rocm_cpu_case_insensitive() {
        assert_eq!(parse_override(Some("cuda")), Some(GpuBackend::Cuda));
        assert_eq!(parse_override(Some("ROCM")), Some(GpuBackend::Rocm));
        assert_eq!(parse_override(Some("Cpu")), Some(GpuBackend::Cpu));
    }

    #[test]
    fn parse_override_auto_empty_invalid_are_none() {
        assert_eq!(parse_override(None), None);
        assert_eq!(parse_override(Some("")), None);
        assert_eq!(parse_override(Some("auto")), None);
        assert_eq!(parse_override(Some("  auto  ")), None);
        assert_eq!(parse_override(Some("vulkan")), None);
    }

    #[test]
    fn python_candidates_cuda_prefers_ai_cuda_then_ai() {
        let root = PathBuf::from("C:/proj");
        let c = python_candidates(&root, GpuBackend::Cuda);
        assert_eq!(c[0], root.join("envs/ai-cuda/Scripts/python.exe"));
        assert_eq!(c[1], root.join("envs/ai-cuda/bin/python"));
        assert_eq!(c[2], root.join("envs/ai/Scripts/python.exe"));
        assert!(c
            .iter()
            .any(|p| p == &root.join("ai_env/Scripts/python.exe")));
    }

    #[test]
    fn python_candidates_rocm_prefers_ai_rocm() {
        let root = PathBuf::from("C:/proj");
        let c = python_candidates(&root, GpuBackend::Rocm);
        assert_eq!(c[0], root.join("envs/ai-rocm/Scripts/python.exe"));
        assert_eq!(c[2], root.join("envs/ai/Scripts/python.exe"));
    }

    #[test]
    fn python_candidates_cpu_skips_vendor_venvs() {
        let root = PathBuf::from("C:/proj");
        let c = python_candidates(&root, GpuBackend::Cpu);
        assert_eq!(c[0], root.join("envs/ai/Scripts/python.exe"));
        assert!(!c.iter().any(|p| p.to_string_lossy().contains("ai-cuda")));
        assert!(!c.iter().any(|p| p.to_string_lossy().contains("ai-rocm")));
    }
}
