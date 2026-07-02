//! Agent 调度器 — 把 ASR/TTS/LLM 注册为 Agent，定义流水线并执行。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock, Semaphore};
use uuid::Uuid;

/// 全局单例：Agent 注册表 + 任务仓库 + 并发控制
use std::sync::OnceLock;
static SCHEDULER: OnceLock<Arc<AgentScheduler>> = OnceLock::new();

pub fn scheduler() -> Arc<AgentScheduler> {
    SCHEDULER
        .get_or_init(|| Arc::new(AgentScheduler::new()))
        .clone()
}

// ===== Agent 能力定义 =====

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentCapability {
    /// 能力 ID: "asr", "tts", "llm", "transcribe", "synthesize", "chat"
    pub id: String,
    pub name: String,
    /// 关联的模型 ID，如 "asr/paraformer-large", "tts/glm-tts-full"
    pub model_id: String,
    /// 输入类型: "audio" | "text" | "prompt" | "ref_audio"
    pub input_kind: String,
    /// 输出类型: "text" | "audio" | "stream"
    pub output_kind: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PipelineDef {
    pub id: String,
    pub name: String,
    /// 按顺序执行的 Agent 步骤
    pub steps: Vec<PipelineStep>,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PipelineStep {
    /// 步骤标签（给前端展示）
    pub label: String,
    /// 引用 Agent 能力 ID
    pub agent_id: String,
}

/// 可用能力和流水线的快照
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRegistry {
    pub agents: Vec<AgentCapability>,
    pub pipelines: Vec<PipelineDef>,
}

// ===== 任务生命周期 =====

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskEvent {
    pub task_id: String,
    pub status: TaskStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentTask {
    pub id: String,
    pub pipeline_id: String,
    pub status: TaskStatus,
    pub current_step: Option<String>,
    pub result: Option<String>,
    pub error: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
pub struct RunRequest {
    pub pipeline: String,
    /// 输入参数，按 pipeline 定义填充
    pub input: serde_json::Value,
}

// ===== 调度器 =====

pub struct AgentScheduler {
    pub tasks: RwLock<HashMap<String, AgentTask>>,
    /// 广播通道：每个任务的进度事件
    pub events: RwLock<HashMap<String, broadcast::Sender<TaskEvent>>>,
    /// 并发控制：每个 agent（按 model_id）最多 1 个并发
    pub model_sem: RwLock<HashMap<String, Arc<Semaphore>>>,
}

impl AgentScheduler {
    pub fn new() -> Self {
        Self {
            tasks: RwLock::new(HashMap::new()),
            events: RwLock::new(HashMap::new()),
            model_sem: RwLock::new(HashMap::new()),
        }
    }

    /// 列出所有可用能力和流水线
    pub fn registry(&self) -> AgentRegistry {
        AgentRegistry {
            agents: vec![
                AgentCapability {
                    id: "tts".into(),
                    name: "语音合成".into(),
                    model_id: "tts/glm-tts-full".into(),
                    input_kind: "text".into(),
                    output_kind: "audio".into(),
                    description: "GLM-TTS zero-shot 声音克隆，可选多段情绪合成".into(),
                },
                AgentCapability {
                    id: "asr".into(),
                    name: "语音识别".into(),
                    model_id: "asr/paraformer-large".into(),
                    input_kind: "audio".into(),
                    output_kind: "text".into(),
                    description: "FunASR Paraformer-Large 中文语音识别".into(),
                },
                AgentCapability {
                    id: "llm".into(),
                    name: "智能对话".into(),
                    model_id: "llm/gemma4:e4b".into(),
                    input_kind: "text".into(),
                    output_kind: "text".into(),
                    description: "Ollama Gemma 4 E4B 多轮对话".into(),
                },
            ],
            pipelines: vec![
                PipelineDef {
                    id: "voice_reply".into(),
                    name: "语音回复".into(),
                    steps: vec![
                        PipelineStep { label: "语音识别".into(), agent_id: "asr".into() },
                        PipelineStep { label: "AI 思考".into(), agent_id: "llm".into() },
                        PipelineStep { label: "语音合成".into(), agent_id: "tts".into() },
                    ],
                    description: "音频输入 → ASR 转文本 → LLM 回复 → TTS 合成语音".into(),
                },
                PipelineDef {
                    id: "text_chat".into(),
                    name: "文本对话".into(),
                    steps: vec![
                        PipelineStep { label: "AI 思考".into(), agent_id: "llm".into() },
                        PipelineStep { label: "语音合成".into(), agent_id: "tts".into() },
                    ],
                    description: "文本输入 → LLM 回复 → TTS 合成语音".into(),
                },
                PipelineDef {
                    id: "transcribe".into(),
                    name: "语音转文字".into(),
                    steps: vec![
                        PipelineStep { label: "语音识别".into(), agent_id: "asr".into() },
                    ],
                    description: "音频输入 → ASR 转文本".into(),
                },
                PipelineDef {
                    id: "synthesize".into(),
                    name: "文字转语音".into(),
                    steps: vec![
                        PipelineStep { label: "语音合成".into(), agent_id: "tts".into() },
                    ],
                    description: "文本输入 → TTS 合成语音".into(),
                },
            ],
        }
    }

    /// 获取或创建某个模型的信号量（每个模型最多 1 并发）
    pub async fn model_semaphore(&self, model_id: &str) -> Arc<Semaphore> {
        let mut map = self.model_sem.write().await;
        map.entry(model_id.to_string())
            .or_insert_with(|| Arc::new(Semaphore::new(1)))
            .clone()
    }

    /// 发起一次流水线执行（异步，返回 task_id 立即返回）
    pub async fn submit(&self, req: RunRequest, project_root: &PathBuf) -> Result<String, String> {
        let registry = self.registry();
        let pipeline = registry
            .pipelines
            .iter()
            .find(|p| p.id == req.pipeline)
            .ok_or_else(|| format!("未知流水线: {}", req.pipeline))?;

        let task_id = format!("agent_{}", Uuid::new_v4().to_string()[..8].to_string());
        let now = chrono::Utc::now().to_rfc3339();

        let (tx, _) = broadcast::channel::<TaskEvent>(32);
        {
            let mut events = self.events.write().await;
            events.insert(task_id.clone(), tx.clone());
        }

        // 记录任务
        let task = AgentTask {
            id: task_id.clone(),
            pipeline_id: req.pipeline.clone(),
            status: TaskStatus::Pending,
            current_step: None,
            result: None,
            error: None,
            created_at: now,
        };
        {
            let mut tasks = self.tasks.write().await;
            tasks.insert(task_id.clone(), task.clone());
        }

        // 异步执行
        let steps = pipeline.steps.clone();
        let input = req.input.clone();
        let root = project_root.clone();
        let tid = task_id.clone();

        tokio::spawn(async move {
            let scheduler = scheduler();
            let _ = scheduler
                .run_pipeline(&tid, &steps, &input, &root, &tx)
                .await;
        });

        Ok(task_id)
    }

    async fn run_pipeline(
        &self,
        task_id: &str,
        steps: &[PipelineStep],
        input: &serde_json::Value,
        project_root: &PathBuf,
        tx: &broadcast::Sender<TaskEvent>,
    ) -> Result<(), ()> {
        self.send_event(tx, TaskEvent {
            task_id: task_id.to_string(),
            status: TaskStatus::Running,
            step: None,
            progress: Some(0.0),
            message: Some("流水线启动".into()),
        });

        let mut current_value: serde_json::Value = input.clone();
        let total = steps.len() as f64;

        for (i, step) in steps.iter().enumerate() {
            // 更新当前步骤
            {
                let mut tasks = self.tasks.write().await;
                if let Some(t) = tasks.get_mut(task_id) {
                    t.current_step = Some(step.label.clone());
                }
            }

            self.send_event(tx, TaskEvent {
                task_id: task_id.to_string(),
                status: TaskStatus::Running,
                step: Some(step.label.clone()),
                progress: Some((i as f64) / total),
                message: Some(format!("正在执行: {}", step.label)),
            });

            // 获取该 agent 对应的 model 信号量（保证独占）
            let registry = self.registry();
            let agent = registry.agents.iter().find(|a| a.id == step.agent_id).cloned();
            let sem = match &agent {
                Some(a) => self.model_semaphore(&a.model_id).await,
                None => {
                    self.fail_task(task_id, format!("未知能力: {}", step.agent_id)).await;
                    return Err(());
                }
            };
            let _permit = sem.acquire().await.map_err(|e| {
                tracing::error!("Agent 信号量异常: {}", e);
            })?;

            // 执行步骤
            let result = match step.agent_id.as_str() {
                "asr" => {
                    let audio_path = current_value
                        .get("audio_path")
                        .and_then(|v| v.as_str())
                        .unwrap_or("assets/datasets/voices/jyy_000.wav");
                    let model_id = current_value
                        .get("model_id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("asr/paraformer-large");

                    crate::services::inference::transcribe(
                        &PathBuf::from(audio_path),
                        model_id,
                    )
                    .await
                    .map(|text| serde_json::json!({ "text": text }))
                    .map_err(|e| e.to_string())
                }
                "tts" => {
                    let text = current_value
                        .get("text")
                        .and_then(|v| v.as_str())
                        .unwrap_or("你好，我是女娲助手。");
                    let model_id = current_value
                        .get("model_id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("tts/glm-tts-full");
                    let ref_audio = current_value
                        .get("ref_audio")
                        .and_then(|v| v.as_str())
                        .unwrap_or("assets/datasets/voices/jyy_000.wav");
                    let ref_text = current_value
                        .get("ref_text")
                        .and_then(|v| v.as_str())
                        .unwrap_or("穿上它能更好完成任务它很美");

                    let output_dir = project_root.join("output");
                    let _ = tokio::fs::create_dir_all(&output_dir).await;
                    let output_path =
                        output_dir.join(format!("agent_tts_{}.wav", &task_id[..8]));

                    crate::services::inference::synthesize(
                        text,
                        model_id,
                        &PathBuf::from(ref_audio),
                        ref_text,
                        &output_path,
                    )
                    .await
                    .map(|()| serde_json::json!({ "audio_path": output_path.to_string_lossy(), "text": text }))
                    .map_err(|e| e.to_string())
                }
                "llm" => {
                    let prompt = current_value
                        .get("text")
                        .or_else(|| current_value.get("prompt"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("你好");
                    let model_id = current_value
                        .get("model_id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("gemma4:e4b");

                    // 通过 Ollama API 调用
                    let ollama_body = serde_json::json!({
                        "model": model_id,
                        "messages": [{"role": "user", "content": prompt}],
                        "stream": false,
                    });

                    let client = reqwest::Client::new();
                    match client
                        .post("http://localhost:11434/api/chat")
                        .json(&ollama_body)
                        .timeout(std::time::Duration::from_secs(120))
                        .send()
                        .await
                    {
                        Ok(resp) => {
                            match resp.json::<serde_json::Value>().await {
                                Ok(body) => {
                                    let content = body["message"]["content"].as_str().unwrap_or("").to_string();
                                    Ok(serde_json::json!({ "text": content, "role": "assistant" }))
                                }
                                Err(e) => Err(format!("解析 Ollama 响应失败: {}", e)),
                            }
                        }
                        Err(e) => Err(format!("Ollama 请求失败: {}", e)),
                    }
                }
                _ => Err(format!("未实现的能力: {}", step.agent_id)),
            };

            match result {
                Ok(value) => {
                    current_value = value;
                    self.send_event(tx, TaskEvent {
                        task_id: task_id.to_string(),
                        status: TaskStatus::Running,
                        step: Some(step.label.clone()),
                        progress: Some((i as f64 + 1.0) / total),
                        message: Some(format!("完成: {}", step.label)),
                    });
                }
                Err(e) => {
                    self.fail_task(task_id, format!("步骤 [{}] 失败: {}", step.label, e)).await;
                    return Err(());
                }
            }
        }

        // 全部完成
        {
            let mut tasks = self.tasks.write().await;
            if let Some(t) = tasks.get_mut(task_id) {
                t.status = TaskStatus::Completed;
                t.result = Some(serde_json::to_string(&current_value).unwrap_or_default());
            }
        }
        self.send_event(tx, TaskEvent {
            task_id: task_id.to_string(),
            status: TaskStatus::Completed,
            step: None,
            progress: Some(1.0),
            message: Some("流水线执行完成".into()),
        });

        Ok(())
    }

    fn send_event(&self, tx: &broadcast::Sender<TaskEvent>, event: TaskEvent) {
        let _ = tx.send(event);
    }

    async fn fail_task(&self, task_id: &str, error: String) {
        let mut tasks = self.tasks.write().await;
        if let Some(t) = tasks.get_mut(task_id) {
            t.status = TaskStatus::Failed;
            t.error = Some(error.clone());
        }
        // 通过 events 通道通知失败
        if let Some(events) = self.events.write().await.get(task_id) {
            let _ = events.send(TaskEvent {
                task_id: task_id.to_string(),
                status: TaskStatus::Failed,
                step: None,
                progress: None,
                message: Some(error),
            });
        }
    }
}
