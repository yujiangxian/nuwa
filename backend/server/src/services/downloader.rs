// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

//! 多线程分片下载器 — 参考 Python ChunkedDownloader 的 Rust 实现
//!
//! 核心特性：
//! - 多线程 Range 分片下载，每个 chunk 独立连接
//! - JSON 元数据断点续传（.download 文件，与 Python 版本兼容）
//! - 速度监控 + 慢速连接自动重建
//! - 多源 fallback（HF / HF-Mirror / ModelScope / 直链）

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use futures::StreamExt;
use serde::{Deserialize, Serialize};
use tokio::fs::{File, OpenOptions};
use tokio::io::{AsyncSeekExt, AsyncWriteExt};
use tokio::sync::Mutex;
use tokio::time::sleep;

// ===================================================================
// 数据模型
// ===================================================================

/// 单个下载分片的状态
/// 原始 chunk 数据（用于 JSON 反序列化）
#[derive(Debug, Clone, Deserialize)]
struct ChunkData {
    pub index: usize,
    pub start: u64,
    pub end: u64,
    pub downloaded: u64,
    pub status: String,
    pub source_index: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct Chunk {
    pub index: usize,
    pub start: u64,
    pub end: u64,
    pub downloaded: u64,
    pub status: String, // pending / downloading / done / failed
    pub source_index: usize,
    #[serde(skip)]
    pub last_speed: f64,
    #[serde(skip)]
    pub last_update_time: Instant,
    #[serde(skip)]
    pub last_update_bytes: u64,
}

impl Default for Chunk {
    fn default() -> Self {
        Self {
            index: 0,
            start: 0,
            end: 0,
            downloaded: 0,
            status: "pending".to_string(),
            source_index: 0,
            last_speed: 0.0,
            last_update_time: Instant::now(),
            last_update_bytes: 0,
        }
    }
}

impl From<ChunkData> for Chunk {
    fn from(data: ChunkData) -> Self {
        Self {
            index: data.index,
            start: data.start,
            end: data.end,
            downloaded: data.downloaded,
            status: data.status,
            source_index: data.source_index,
            last_speed: 0.0,
            last_update_time: Instant::now(),
            last_update_bytes: data.downloaded,
        }
    }
}

impl Chunk {
    pub fn size(&self) -> u64 {
        self.end.saturating_sub(self.start) + 1
    }

    pub fn remaining(&self) -> u64 {
        self.size().saturating_sub(self.downloaded)
    }

    pub fn is_slow(&self, threshold: f64, window: Duration) -> bool {
        if self.status != "downloading" {
            return false;
        }
        let elapsed = self.last_update_time.elapsed();
        if elapsed < window {
            return false;
        }
        self.last_speed < threshold
    }
}

/// 下载进度快照
#[derive(Debug, Clone, Copy)]
pub struct DownloadProgress {
    pub downloaded: u64,
    pub total: u64,
    pub speed: f64, // bytes/s
    pub eta: f64,   // seconds
    pub threads_active: usize,
}

impl DownloadProgress {
    pub fn percent(&self) -> f64 {
        if self.total > 0 {
            (self.downloaded as f64 / self.total as f64) * 100.0
        } else {
            0.0
        }
    }
}

/// 断点续传元数据（序列化用）
#[derive(Debug, Clone, Serialize)]
pub struct DownloadMeta {
    pub url: String,
    pub dest: String,
    pub total_size: u64,
    pub chunks: Vec<Chunk>,
}

/// 断点续传元数据（反序列化用）
#[derive(Debug, Clone, Deserialize)]
struct DownloadMetaData {
    pub url: String,
    pub dest: String,
    pub total_size: u64,
    pub chunks: Vec<ChunkData>,
}

/// 下载源
#[derive(Debug, Clone)]
pub struct DownloadSource {
    pub name: String,
    pub base_url: String,
}

/// 多源 fallback 链
#[derive(Debug, Clone)]
pub struct SourceChain {
    pub sources: Vec<DownloadSource>,
}

impl Default for SourceChain {
    fn default() -> Self {
        Self {
            sources: vec![
                DownloadSource {
                    name: "modelscope".into(),
                    base_url: "https://www.modelscope.cn".into(),
                },
                DownloadSource {
                    name: "hf-mirror".into(),
                    base_url: "https://hf-mirror.com".into(),
                },
                DownloadSource {
                    name: "huggingface".into(),
                    base_url: "https://huggingface.co".into(),
                },
            ],
        }
    }
}

impl SourceChain {
    pub fn new(sources: Vec<DownloadSource>) -> Self {
        Self { sources }
    }

    pub fn add_mirror(&mut self, url: String) {
        self.sources.insert(
            0,
            DownloadSource {
                name: "custom".into(),
                base_url: url.trim_end_matches('/').to_string(),
            },
        );
    }

    /// 按优先级生成所有可能的下载 URL
    pub fn iter_urls(&self, url: &str) -> Vec<String> {
        let mut urls = Vec::new();

        if url.starts_with("http://") || url.starts_with("https://") {
            if let Some(path_and_query) = url
                .splitn(2, "://")
                .nth(1)
                .and_then(|s| s.splitn(2, '/').nth(1))
            {
                for src in &self.sources {
                    let mirror_url =
                        format!("{}/{}", src.base_url.trim_end_matches('/'), path_and_query);
                    urls.push(mirror_url);
                }
            }
            urls.push(url.to_string());
        } else {
            urls.push(url.to_string());
        }

        urls
    }
}

// ===================================================================
// 分片下载器
// ===================================================================

/// 多线程分片下载器
#[derive(Debug)]
pub struct ChunkedDownloader {
    // 配置（只读）
    pub url: String,
    pub dest: PathBuf,
    pub threads: usize,
    pub chunk_size: usize,
    pub min_speed: f64,
    pub speed_window: Duration,
    pub timeout: Duration,
    pub source_chain: SourceChain,
    pub meta_path: PathBuf,

    // 共享状态
    chunks: Arc<Mutex<Vec<Chunk>>>,
    downloaded_total: Arc<Mutex<u64>>,
    total_size: Arc<Mutex<u64>>,
    accept_ranges: Arc<Mutex<bool>>,
    cancelled: Arc<AtomicBool>,
    start_time: Arc<Mutex<Option<Instant>>>,
}

impl ChunkedDownloader {
    pub fn new(url: impl Into<String>, dest: impl AsRef<Path>) -> Self {
        let dest = dest.as_ref().to_path_buf();
        let ext = dest.extension().unwrap_or_default().to_string_lossy();
        let meta_path = dest.with_extension(format!("{}.download", ext));

        Self {
            url: url.into(),
            dest,
            threads: 8,
            chunk_size: 8 * 1024 * 1024, // 8MB
            min_speed: 1024.0 * 1024.0,  // 1 MB/s
            speed_window: Duration::from_secs(15),
            timeout: Duration::from_secs(60),
            source_chain: SourceChain::default(),
            meta_path,

            chunks: Arc::new(Mutex::new(Vec::new())),
            downloaded_total: Arc::new(Mutex::new(0)),
            total_size: Arc::new(Mutex::new(0)),
            accept_ranges: Arc::new(Mutex::new(false)),
            cancelled: Arc::new(AtomicBool::new(false)),
            start_time: Arc::new(Mutex::new(None)),
        }
    }

    pub fn with_threads(mut self, threads: usize) -> Self {
        self.threads = threads.max(1);
        self
    }

    pub fn with_chunk_size(mut self, chunk_size: usize) -> Self {
        self.chunk_size = chunk_size.max(1024 * 1024); // 最小 1MB
        self
    }

    pub fn with_mirrors(mut self, mirrors: Vec<String>) -> Self {
        for m in mirrors {
            self.source_chain.add_mirror(m);
        }
        self
    }

    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }

    pub fn with_min_speed(mut self, min_speed: f64) -> Self {
        self.min_speed = min_speed;
        self
    }

    /// 执行下载，返回最终文件路径
    pub async fn download(&self) -> Result<PathBuf, String> {
        // 1. 探测文件信息
        self.probe().await?;

        // 2. 准备本地文件
        self.prepare_file().await?;

        // 3. 加载或创建分片计划
        self.load_or_create_chunks().await?;

        // 4. 启动下载
        {
            let mut st = self.start_time.lock().await;
            *st = Some(Instant::now());
        }
        self.run_download().await?;

        // 5. 清理元数据
        self.remove_meta().await;

        Ok(self.dest.clone())
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Relaxed);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Relaxed)
    }

    /// 查询当前进度
    pub async fn progress(&self) -> DownloadProgress {
        let downloaded = *self.downloaded_total.lock().await;
        let total = *self.total_size.lock().await;
        let start = *self.start_time.lock().await;
        let elapsed = start.map(|s| s.elapsed().as_secs_f64()).unwrap_or(0.0);
        let speed = if elapsed > 0.0 {
            downloaded as f64 / elapsed
        } else {
            0.0
        };
        let remaining = total.saturating_sub(downloaded);
        let eta = if speed > 0.0 {
            remaining as f64 / speed
        } else {
            0.0
        };

        let active = {
            let cs = self.chunks.lock().await;
            cs.iter().filter(|c| c.status == "downloading").count()
        };

        DownloadProgress {
            downloaded,
            total,
            speed,
            eta,
            threads_active: active,
        }
    }

    // ------------------------------------------------------------------
    // 内部实现
    // ------------------------------------------------------------------

    async fn probe(&self) -> Result<(), String> {
        let client = build_client(self.timeout)?;
        let urls = self.source_chain.iter_urls(&self.url);
        let mut last_err = None;

        tracing::info!(
            "[downloader] probe starting, url={}, sources={:?}",
            self.url,
            urls
        );

        for (i, url) in urls.iter().enumerate() {
            tracing::info!("[downloader] probing source {}: {}", i, url);

            // 先用 HEAD 探测
            match client.head(url).send().await {
                Ok(resp) => {
                    tracing::info!("[downloader] source {} HEAD response: status={}, content-length={:?}, accept-ranges={:?}",
                        i, resp.status(), resp.content_length(),
                        resp.headers().get("accept-ranges").and_then(|v| v.to_str().ok()));

                    if resp.status().is_success() {
                        let mut total = resp.content_length().unwrap_or(0);
                        let accept_ranges = resp
                            .headers()
                            .get("accept-ranges")
                            .and_then(|v| v.to_str().ok())
                            .unwrap_or("none")
                            != "none";

                        // 某些镜像（如 hf-mirror）HEAD 不返回 Content-Length，改用 GET + Range 探测
                        if total == 0 {
                            tracing::info!("[downloader] source {} HEAD has no content-length, trying GET+Range", i);
                            match client.get(url).header("Range", "bytes=0-0").send().await {
                                Ok(range_resp) => {
                                    tracing::info!("[downloader] source {} GET+Range status={:?}, content-length={:?}, content-range={:?}",
                                        i, range_resp.status(), range_resp.content_length(),
                                        range_resp.headers().get("content-range").and_then(|v| v.to_str().ok()));
                                    if range_resp.status().is_success()
                                        || range_resp.status().as_u16() == 206
                                    {
                                        total = range_resp.content_length().unwrap_or(0);
                                        // 从 Content-Range 头解析总大小: bytes 0-0/total
                                        if total <= 1 {
                                            if let Some(cr) = range_resp
                                                .headers()
                                                .get("content-range")
                                                .and_then(|v| v.to_str().ok())
                                            {
                                                tracing::info!("[downloader] source {} parsing Content-Range: {}", i, cr);
                                                if let Some(slash) = cr.rfind('/') {
                                                    let total_str = &cr[slash + 1..];
                                                    tracing::info!(
                                                        "[downloader] source {} total_str='{}'",
                                                        i,
                                                        total_str
                                                    );
                                                    if let Ok(t) = total_str.parse::<u64>() {
                                                        total = t;
                                                    }
                                                }
                                            }
                                        }
                                        tracing::info!(
                                            "[downloader] source {} GET+Range final total={}",
                                            i,
                                            total
                                        );
                                    }
                                }
                                Err(e) => {
                                    tracing::warn!(
                                        "[downloader] source {} GET+Range failed: {}",
                                        i,
                                        e
                                    );
                                }
                            }
                        }

                        *self.total_size.lock().await = total;
                        *self.accept_ranges.lock().await = accept_ranges && total > 0;
                        tracing::info!(
                            "[downloader] probe success: total={}, accept_ranges={}",
                            total,
                            accept_ranges
                        );
                        return Ok(());
                    } else {
                        last_err = Some(format!("HTTP {}", resp.status()));
                    }
                }
                Err(e) => {
                    tracing::warn!("[downloader] source {} failed: {}", i, e);
                    last_err = Some(format!("{}", e));
                }
            }
        }

        Err(format!(
            "无法探测文件信息: {}",
            last_err.unwrap_or_else(|| "所有源均不可用".to_string())
        ))
    }

    async fn prepare_file(&self) -> Result<(), String> {
        if let Some(parent) = self.dest.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("创建目录失败: {}", e))?;
        }

        let exists = tokio::fs::metadata(&self.dest).await.is_ok();
        if !exists {
            let file = File::create(&self.dest)
                .await
                .map_err(|e| format!("创建文件失败: {}", e))?;
            let total = *self.total_size.lock().await;
            if total > 0 {
                file.set_len(total)
                    .await
                    .map_err(|e| format!("预分配文件失败: {}", e))?;
            }
        } else {
            let meta = tokio::fs::metadata(&self.dest)
                .await
                .map_err(|e| format!("获取文件元数据失败: {}", e))?;
            let total = *self.total_size.lock().await;
            if total > 0 && meta.len() != total {
                let file = OpenOptions::new()
                    .write(true)
                    .open(&self.dest)
                    .await
                    .map_err(|e| format!("打开文件失败: {}", e))?;
                file.set_len(total)
                    .await
                    .map_err(|e| format!("调整文件大小失败: {}", e))?;
            }
        }

        Ok(())
    }

    async fn load_or_create_chunks(&self) -> Result<(), String> {
        let meta_exists = match tokio::fs::metadata(&self.meta_path).await {
            Ok(_) => true,
            Err(_) => false,
        };
        if meta_exists {
            match tokio::fs::read_to_string(&self.meta_path).await {
                Ok(content) => match serde_json::from_str::<DownloadMetaData>(&content) {
                    Ok(meta) => {
                        let url_match = meta.url == self.url;
                        let total = *self.total_size.lock().await;
                        let size_match = meta.total_size == total;
                        if url_match && size_match {
                            let mut chunks: Vec<Chunk> =
                                meta.chunks.into_iter().map(Chunk::from).collect();
                            let downloaded: u64 = chunks.iter().map(|c| c.downloaded).sum();
                            *self.downloaded_total.lock().await = downloaded;
                            for c in &mut chunks {
                                if c.status == "downloading" {
                                    c.status = "pending".to_string();
                                }
                            }
                            *self.chunks.lock().await = chunks;
                            return Ok(());
                        }
                    }
                    Err(_) => {}
                },
                Err(_) => {}
            }
        }

        // 新建分片
        let mut chunks = Vec::new();
        let total = *self.total_size.lock().await;
        let accept_ranges = *self.accept_ranges.lock().await;

        if !accept_ranges || total == 0 {
            let end = if total > 0 { total - 1 } else { 0 };
            chunks.push(Chunk {
                index: 0,
                start: 0,
                end,
                downloaded: 0,
                status: "pending".to_string(),
                source_index: 0,
                last_speed: 0.0,
                last_update_time: Instant::now(),
                last_update_bytes: 0,
            });
        } else {
            let mut idx = 0usize;
            let mut pos = 0u64;
            while pos < total {
                let end = (pos + self.chunk_size as u64 - 1).min(total - 1);
                chunks.push(Chunk {
                    index: idx,
                    start: pos,
                    end,
                    downloaded: 0,
                    status: "pending".to_string(),
                    source_index: 0,
                    last_speed: 0.0,
                    last_update_time: Instant::now(),
                    last_update_bytes: 0,
                });
                pos = end + 1;
                idx += 1;
            }
        }

        *self.chunks.lock().await = chunks;
        self.save_meta().await?;
        Ok(())
    }

    async fn save_meta(&self) -> Result<(), String> {
        let chunks = self.chunks.lock().await.clone();
        let payload = DownloadMeta {
            url: self.url.clone(),
            dest: self.dest.to_string_lossy().to_string(),
            total_size: *self.total_size.lock().await,
            chunks,
        };
        let json = serde_json::to_string_pretty(&payload)
            .map_err(|e| format!("序列化元数据失败: {}", e))?;
        let tmp = self.meta_path.with_extension("download.tmp");
        tokio::fs::write(&tmp, json)
            .await
            .map_err(|e| format!("写入元数据失败: {}", e))?;
        tokio::fs::rename(&tmp, &self.meta_path)
            .await
            .map_err(|e| format!("重命名元数据文件失败: {}", e))?;
        Ok(())
    }

    async fn remove_meta(&self) {
        let _ = tokio::fs::remove_file(&self.meta_path).await;
    }

    async fn run_download(&self) -> Result<(), String> {
        let semaphore = Arc::new(tokio::sync::Semaphore::new(self.threads));
        let mut active_tasks: Vec<(tokio::task::JoinHandle<()>, usize)> = Vec::new();

        loop {
            if self.cancelled.load(Ordering::Relaxed) {
                // 取消所有活跃任务
                for (handle, _) in active_tasks.drain(..) {
                    handle.abort();
                }
                return Err("下载已取消".to_string());
            }

            // 提交新的 pending chunk（包括之前失败的，换源重试）
            let pending: Vec<usize> = {
                let cs = self.chunks.lock().await;
                cs.iter()
                    .enumerate()
                    .filter(|(_, c)| c.status == "pending" || c.status == "failed")
                    .map(|(i, _)| i)
                    .collect()
            };

            for idx in pending {
                let permit = match semaphore.clone().try_acquire_owned() {
                    Ok(p) => p,
                    Err(_) => break, // 达到并发上限
                };

                let chunks = Arc::clone(&self.chunks);
                let downloaded_total = Arc::clone(&self.downloaded_total);
                let cancelled = Arc::clone(&self.cancelled);
                let dest = self.dest.clone();
                let source_chain = self.source_chain.clone();
                let timeout = self.timeout;
                let accept_ranges = *self.accept_ranges.lock().await;
                let url = self.url.clone();

                let handle = tokio::spawn(async move {
                    let _permit = permit;

                    let urls = source_chain.iter_urls(&url);
                    let si = {
                        let cs = chunks.lock().await;
                        if idx >= cs.len() {
                            return;
                        }
                        cs[idx].source_index % urls.len().max(1)
                    };
                    let chunk_url = urls.get(si).cloned().unwrap_or_else(|| url.clone());

                    {
                        let mut cs = chunks.lock().await;
                        if idx < cs.len() {
                            cs[idx].status = "downloading".to_string();
                            cs[idx].last_update_time = Instant::now();
                            cs[idx].last_update_bytes = cs[idx].downloaded;
                        }
                    }

                    let result = Self::download_chunk(
                        idx,
                        &chunk_url,
                        &dest,
                        accept_ranges,
                        timeout,
                        cancelled,
                        chunks.clone(),
                        downloaded_total,
                    )
                    .await;

                    let mut cs = chunks.lock().await;
                    if idx < cs.len() {
                        match result {
                            Ok(_) => {
                                cs[idx].status = "done".to_string();
                            }
                            Err(_) => {
                                cs[idx].status = "failed".to_string();
                                cs[idx].source_index += 1;
                            }
                        }
                    }
                });

                active_tasks.push((handle, idx));
            }

            if active_tasks.is_empty() {
                let all_done = {
                    let cs = self.chunks.lock().await;
                    cs.iter().all(|c| c.status == "done")
                };
                if all_done {
                    break;
                }

                sleep(Duration::from_millis(200)).await;
                self.rebuild_slow_chunks().await?;
                self.save_meta().await?;
                continue;
            }

            // 等待一小段时间，然后检查哪些任务已完成
            sleep(Duration::from_millis(500)).await;

            // 移除已完成的任务
            let mut i = 0;
            while i < active_tasks.len() {
                if active_tasks[i].0.is_finished() {
                    let (handle, _) = active_tasks.remove(i);
                    let _ = handle.await;
                } else {
                    i += 1;
                }
            }

            // 慢速检测和重建
            self.rebuild_slow_chunks().await?;

            // 保存进度
            self.save_meta().await?;
        }

        Ok(())
    }

    async fn download_chunk(
        chunk_idx: usize,
        url: &str,
        dest: &Path,
        accept_ranges: bool,
        timeout: Duration,
        cancelled: Arc<AtomicBool>,
        chunks: Arc<Mutex<Vec<Chunk>>>,
        downloaded_total: Arc<Mutex<u64>>,
    ) -> Result<(), String> {
        let client = build_client(timeout)?;

        let mut request = client.get(url);
        if accept_ranges {
            let range_start = {
                let cs = chunks.lock().await;
                if chunk_idx >= cs.len() {
                    return Err("chunk index out of range".to_string());
                }
                cs[chunk_idx].start + cs[chunk_idx].downloaded
            };
            let range_end = {
                let cs = chunks.lock().await;
                cs[chunk_idx].end
            };
            request = request.header("Range", format!("bytes={}-{}", range_start, range_end));
        }

        let response = request.send().await.map_err(|e| {
            let msg = e.to_string();
            if msg.contains("timeout") || msg.contains("timed out") {
                format!("连接超时: {}", msg)
            } else if msg.contains("dns") || msg.contains("resolve") {
                format!("DNS 解析失败: {}", msg)
            } else if msg.contains("connect") {
                format!("连接失败: {}", msg)
            } else {
                format!("请求失败: {}", msg)
            }
        })?;

        if !response.status().is_success() {
            return Err(format!(
                "HTTP 错误 {}: 文件可能不存在或需要认证",
                response.status()
            ));
        }

        // 打开文件并定位
        let seek_pos = {
            let cs = chunks.lock().await;
            if chunk_idx >= cs.len() {
                return Err("chunk index out of range".to_string());
            }
            if accept_ranges {
                cs[chunk_idx].start + cs[chunk_idx].downloaded
            } else {
                cs[chunk_idx].start
            }
        };

        let mut file = OpenOptions::new()
            .read(true)
            .write(true)
            .open(dest)
            .await
            .map_err(|e| format!("打开文件失败: {}", e))?;

        file.seek(tokio::io::SeekFrom::Start(seek_pos))
            .await
            .map_err(|e| format!("Seek 失败: {}", e))?;

        let mut stream = response.bytes_stream();
        let mut local_downloaded = {
            let cs = chunks.lock().await;
            cs[chunk_idx].downloaded
        };

        while let Some(item) = stream.next().await {
            if cancelled.load(Ordering::Relaxed) {
                let mut cs = chunks.lock().await;
                if chunk_idx < cs.len() {
                    cs[chunk_idx].status = "pending".to_string();
                }
                return Ok(());
            }

            let data = item.map_err(|e| format!("下载中断: {}", e))?;
            file.write_all(&data)
                .await
                .map_err(|e| format!("写入失败: {}", e))?;

            let len = data.len() as u64;
            local_downloaded += len;

            {
                let mut cs = chunks.lock().await;
                if chunk_idx < cs.len() {
                    cs[chunk_idx].downloaded = local_downloaded;

                    let now = Instant::now();
                    let delta = now
                        .duration_since(cs[chunk_idx].last_update_time)
                        .as_secs_f64();
                    if delta >= 1.0 {
                        let bytes_delta = local_downloaded - cs[chunk_idx].last_update_bytes;
                        cs[chunk_idx].last_speed = bytes_delta as f64 / delta;
                        cs[chunk_idx].last_update_time = now;
                        cs[chunk_idx].last_update_bytes = local_downloaded;
                    }
                }
            }

            {
                let mut dt = downloaded_total.lock().await;
                *dt += len;
            }
        }

        file.flush().await.map_err(|e| format!("刷新失败: {}", e))?;
        Ok(())
    }

    async fn rebuild_slow_chunks(&self) -> Result<(), String> {
        let mut cs = self.chunks.lock().await;
        for c in &mut *cs {
            if c.is_slow(self.min_speed, self.speed_window) && c.status == "downloading" {
                c.status = "failed".to_string();
                c.source_index += 1;
            }
        }
        Ok(())
    }
}

// ===================================================================
// 便捷函数
// ===================================================================

fn build_client(timeout: Duration) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(timeout)
        .connect_timeout(Duration::from_secs(30))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| format!("构建 HTTP 客户端失败: {}", e))
}

/// 便捷函数：一键下载（兼容旧接口）
pub async fn download_file(
    url: &str,
    dest: &Path,
    on_progress: impl Fn(DownloadProgress) + Send + Sync + 'static,
) -> Result<(u64, u64), String> {
    let downloader = Arc::new(ChunkedDownloader::new(url, dest));
    let dl_progress = Arc::clone(&downloader);
    let dl_download = Arc::clone(&downloader);

    // 启动进度报告任务
    let progress_handle = tokio::spawn(async move {
        loop {
            sleep(Duration::from_secs(1)).await;
            if dl_progress.is_cancelled() {
                break;
            }
            let prog = dl_progress.progress().await;
            on_progress(prog);
            if prog.downloaded >= prog.total && prog.total > 0 {
                break;
            }
        }
    });

    match dl_download.download().await {
        Ok(_) => {
            progress_handle.abort();
            let _ = progress_handle.await;
            let downloaded = *dl_download.downloaded_total.lock().await;
            let total = *dl_download.total_size.lock().await;
            Ok((downloaded, total))
        }
        Err(e) => {
            progress_handle.abort();
            let _ = progress_handle.await;
            Err(e)
        }
    }
}
