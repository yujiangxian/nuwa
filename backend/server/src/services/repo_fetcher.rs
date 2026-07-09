// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

//! 仓库文件列表获取 — 支持 HuggingFace / hf-mirror / ModelScope

use serde::Deserialize;

/// 仓库中的单个文件信息
#[derive(Debug, Clone)]
pub struct RepoFile {
    pub path: String,
    pub size: u64,
    pub is_lfs: bool,
}

/// 从指定来源获取仓库文件列表
pub async fn list_repo_files(repo_id: &str, source: &str) -> Result<Vec<RepoFile>, String> {
    match source {
        "hf-mirror" | "huggingface" => list_hf_files(repo_id, source).await,
        "modelscope" => list_ms_files(repo_id).await,
        _ => Err(format!("不支持的来源: {}", source)),
    }
}

/// 构建单个文件的下载 URL
pub fn build_download_url(repo_id: &str, source: &str, file_path: &str) -> String {
    match source {
        "hf-mirror" => format!(
            "https://hf-mirror.com/{}/resolve/main/{}",
            repo_id, file_path
        ),
        "huggingface" => format!(
            "https://huggingface.co/{}/resolve/main/{}",
            repo_id, file_path
        ),
        "modelscope" => format!(
            "https://modelscope.cn/models/{}/resolve/master/{}",
            repo_id, file_path
        ),
        _ => format!(
            "https://hf-mirror.com/{}/resolve/main/{}",
            repo_id, file_path
        ),
    }
}

// ========== HuggingFace / hf-mirror ==========

#[derive(Deserialize)]
struct HfTreeItem {
    #[serde(rename = "type")]
    item_type: String,
    path: String,
    #[serde(default)]
    size: Option<u64>,
    #[serde(default)]
    lfs: Option<HfLfsInfo>,
}

#[derive(Deserialize)]
struct HfLfsInfo {
    #[serde(default)]
    size: Option<u64>,
}

async fn list_hf_files(repo_id: &str, source: &str) -> Result<Vec<RepoFile>, String> {
    let base = if source == "hf-mirror" {
        "https://hf-mirror.com"
    } else {
        "https://huggingface.co"
    };
    let url = format!("{}/api/models/{}/tree/main", base, repo_id);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("请求仓库文件列表失败: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("API 返回错误状态: {}", resp.status()));
    }

    let items: Vec<HfTreeItem> = resp
        .json()
        .await
        .map_err(|e| format!("解析 JSON 失败: {}", e))?;

    let files: Vec<RepoFile> = items
        .into_iter()
        .filter(|item| item.item_type == "file")
        .filter(|item| !should_skip_file(&item.path))
        .map(|item| RepoFile {
            path: item.path.clone(),
            size: item
                .size
                .or_else(|| item.lfs.as_ref().and_then(|l| l.size))
                .unwrap_or(0),
            is_lfs: item.lfs.is_some(),
        })
        .collect();

    let files = dedup_model_weights(files);

    if files.is_empty() {
        return Err("仓库中没有可下载的文件".to_string());
    }

    Ok(files)
}

// ========== ModelScope ==========

#[derive(Deserialize)]
struct MsApiResponse {
    #[serde(rename = "Data", default)]
    data: Option<MsData>,
}

#[derive(Deserialize)]
struct MsData {
    #[serde(rename = "Files", default)]
    files: Option<Vec<MsFile>>,
}

#[derive(Deserialize)]
struct MsFile {
    #[serde(rename = "Path", default)]
    path: String,
    #[serde(rename = "Name", default)]
    name: String,
    #[serde(rename = "Size", default)]
    size: Option<u64>,
    #[serde(rename = "Type", default)]
    file_type: String,
    #[serde(rename = "IsLFS", default)]
    is_lfs: bool,
}

async fn list_ms_files(repo_id: &str) -> Result<Vec<RepoFile>, String> {
    let url = format!(
        "https://www.modelscope.cn/api/v1/models/{}/repo/files?Revision=master",
        repo_id
    );

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("请求仓库文件列表失败: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("API 返回错误状态: {}", resp.status()));
    }

    let api_resp: MsApiResponse = resp
        .json()
        .await
        .map_err(|e| format!("解析 JSON 失败: {}", e))?;

    let ms_files = api_resp
        .data
        .and_then(|d| d.files)
        .ok_or_else(|| "API 返回数据格式异常".to_string())?;

    let files: Vec<RepoFile> = ms_files
        .into_iter()
        .filter(|f| f.file_type == "blob")
        .filter(|f| !should_skip_file(&f.path))
        .map(|f| RepoFile {
            path: f.path,
            size: f.size.unwrap_or(0),
            is_lfs: f.is_lfs,
        })
        .collect();

    let files = dedup_model_weights(files);

    if files.is_empty() {
        return Err("仓库中没有可下载的文件".to_string());
    }

    Ok(files)
}

// ========== 工具函数 ==========

/// 判断文件是否应该被跳过（非模型文件）
fn should_skip_file(path: &str) -> bool {
    let lower = path.to_lowercase();
    // 跳过常见的非模型文件
    if lower.ends_with(".md")
        || lower.ends_with(".png")
        || lower.ends_with(".jpg")
        || lower.ends_with(".jpeg")
        || lower.ends_with(".gif")
        || lower.ends_with(".svg")
        || lower.ends_with(".txt") && !lower.contains("vocab") && !lower.contains("merges")
        || lower == ".gitattributes"
        || lower == "license"
        || lower == "citiation.cff"
        || lower == ".gitignore"
        || lower.ends_with(".metadata")
    {
        return true;
    }
    false
}

/// 对模型权重文件去重：优先保留 safetensors 格式，排除其他框架的重复权重
///
/// 规则：
/// 1. 排除 `.msgpack` (Flax) 和 `.h5` (TensorFlow) 文件
/// 2. 如果同一目录下存在 `.safetensors`，排除 `pytorch_model.bin`
/// 3. 如果同一目录下存在 `.safetensors`，排除同名的 `.bin`（如 model-00001-of-00002.bin）
fn dedup_model_weights(files: Vec<RepoFile>) -> Vec<RepoFile> {
    use std::collections::HashMap;

    // 按目录分组
    let mut by_dir: HashMap<String, Vec<RepoFile>> = HashMap::new();
    for f in files {
        let dir = std::path::Path::new(&f.path)
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        by_dir.entry(dir).or_default().push(f);
    }

    let mut result = Vec::new();
    for (_dir, group) in by_dir {
        let has_safetensors = group.iter().any(|f| f.path.ends_with(".safetensors"));

        for f in &group {
            let path = &f.path;
            // 排除 Flax / TensorFlow 格式
            if path.ends_with(".msgpack") || path.ends_with(".h5") {
                continue;
            }
            // 如果存在 safetensors，排除 pytorch_model.bin
            if has_safetensors && path.ends_with("pytorch_model.bin") {
                continue;
            }
            // 如果存在同名的 .safetensors，排除 .bin（处理分片模型如 model-00001-of-00002.bin）
            if has_safetensors && path.ends_with(".bin") {
                let stem = &path[..path.len() - 4];
                let safetensors_version = stem.to_string() + ".safetensors";
                if group.iter().any(|g| g.path == safetensors_version) {
                    continue;
                }
            }
            result.push(f.clone());
        }
    }

    result
}

/// 格式化文件大小显示
pub fn format_size(bytes: u64) -> String {
    if bytes >= 1024 * 1024 * 1024 {
        format!("{:.1} GB", bytes as f64 / (1024.0 * 1024.0 * 1024.0))
    } else if bytes >= 1024 * 1024 {
        format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
    } else if bytes >= 1024 {
        format!("{:.1} KB", bytes as f64 / 1024.0)
    } else {
        format!("{} B", bytes)
    }
}

/// 计算选中文件的总大小
pub fn total_size(files: &[RepoFile]) -> u64 {
    files.iter().map(|f| f.size).sum()
}
