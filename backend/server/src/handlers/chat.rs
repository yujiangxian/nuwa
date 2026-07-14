// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::constants::OLLAMA_CHAT_URL;
use crate::state::AppState;

const OLLAMA_URL: &str = OLLAMA_CHAT_URL;

#[derive(Debug, Deserialize)]
pub struct ChatRequest {
    pub(crate) messages: Vec<ChatMessage>,
    #[serde(default = "default_model")]
    pub(crate) model: String,
    #[serde(default)]
    pub(crate) system: Option<String>,
    // —— 新增：生成参数，均为可选；缺省（None）即不下发对应 option。
    // 缺失字段经 #[serde(default)] 落为 None；存在但类型非法的字段经 lenient 反序列化
    // 落为 None（视为未提供），不导致整体反序列化失败（Req 5.1）。
    #[serde(default, deserialize_with = "lenient_opt_f64")]
    pub(crate) temperature: Option<f64>,
    #[serde(default, deserialize_with = "lenient_opt_f64")]
    pub(crate) top_p: Option<f64>,
    #[serde(default, deserialize_with = "lenient_opt_i64")]
    pub(crate) num_predict: Option<i64>,
    #[serde(default, deserialize_with = "lenient_opt_i64")]
    pub(crate) top_k: Option<i64>,
    #[serde(default, deserialize_with = "lenient_opt_f64")]
    pub(crate) repeat_penalty: Option<f64>,
}

/// 宽松反序列化为 Option<f64>：数值（含整数）→ Some；其余（字符串/布尔/null/对象/数组）→ None。
/// 仅在字段存在时被调用（缺失由 #[serde(default)] 处理）。
fn lenient_opt_f64<'de, D>(d: D) -> Result<Option<f64>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let v = serde_json::Value::deserialize(d)?;
    Ok(v.as_f64())
}

/// 宽松反序列化为 Option<i64>：整数 → Some；浮点取整 → Some；其余 → None。
fn lenient_opt_i64<'de, D>(d: D) -> Result<Option<i64>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let v = serde_json::Value::deserialize(d)?;
    Ok(v.as_i64().or_else(|| v.as_f64().map(|f| f.round() as i64)))
}

/// 经钳制后的生成参数集合：每个字段保持「提供与否」(Option) 语义，
/// 但若为 Some，则其值已被钳制到合法范围（与前端 Param_Validator 等价）。
#[derive(Debug, Clone, PartialEq)]
pub struct ClampedParams {
    pub temperature: Option<f64>,
    pub top_p: Option<f64>,
    pub num_predict: Option<i64>,
    pub top_k: Option<i64>,
    pub repeat_penalty: Option<f64>,
}

/// 浮点钳制到闭区间 [min, max]。
fn clamp_f64(v: f64, min: f64, max: f64) -> f64 {
    if v < min {
        min
    } else if v > max {
        max
    } else {
        v
    }
}

/// 整型钳制到闭区间 [min, max]。
fn clamp_i64(v: i64, min: i64, max: i64) -> i64 {
    v.max(min).min(max)
}

/// Server_Param_Validator：对请求中提供（Some）的每个参数应用与前端 Param_Validator
/// 等价的范围钳制；None 字段保持 None（不被注入）。对已合法值幂等。
/// - temperature ∈ [0.0, 2.0]；top_p ∈ [0.0, 1.0]；repeat_penalty ∈ [0.0, 2.0]
/// - top_k ∈ [0, 100]（整型）
/// - num_predict：-1 原样保留（Unlimited_Length）；其余 ∈ [1, 8192]（整型）
pub fn clamp_params(req: &ChatRequest) -> ClampedParams {
    ClampedParams {
        temperature: req.temperature.map(|v| clamp_f64(v, 0.0, 2.0)),
        top_p: req.top_p.map(|v| clamp_f64(v, 0.0, 1.0)),
        repeat_penalty: req.repeat_penalty.map(|v| clamp_f64(v, 0.0, 2.0)),
        top_k: req.top_k.map(|v| clamp_i64(v, 0, 100)),
        num_predict: req
            .num_predict
            .map(|v| if v == -1 { -1 } else { clamp_i64(v, 1, 8192) }),
    }
}

/// 把 ClampedParams 转为 Ollama options 对象；当所有字段均为 None 时返回 None
/// （从而 build_ollama_body 不写入 options 键）。键名固定使用 Ollama 约定。
pub fn params_to_options(p: &ClampedParams) -> Option<serde_json::Map<String, serde_json::Value>> {
    let mut map = serde_json::Map::new();
    if let Some(v) = p.temperature {
        map.insert("temperature".to_string(), serde_json::json!(v));
    }
    if let Some(v) = p.top_p {
        map.insert("top_p".to_string(), serde_json::json!(v));
    }
    if let Some(v) = p.num_predict {
        map.insert("num_predict".to_string(), serde_json::json!(v));
    }
    if let Some(v) = p.top_k {
        map.insert("top_k".to_string(), serde_json::json!(v));
    }
    if let Some(v) = p.repeat_penalty {
        map.insert("repeat_penalty".to_string(), serde_json::json!(v));
    }
    if map.is_empty() {
        None
    } else {
        Some(map)
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChatMessage {
    pub(crate) role: String,
    pub(crate) content: String,
}

#[derive(Debug, Serialize)]
pub struct ChatResponse {
    role: String,
    content: String,
    model: String,
    done: bool,
}

#[derive(Debug, Serialize)]
pub struct ChatError {
    error: String,
}

fn default_model() -> String {
    "gemma4:e4b".to_string()
}

/// Model_Selection 回退顺序：current_llm_model → 请求体 model。
pub fn resolve_model(current_llm_model: Option<String>, request_model: &str) -> String {
    current_llm_model.unwrap_or_else(|| request_model.to_string())
}

/// 把内部模型 ID 规范化为 Ollama 实际模型名（Ollama_Model_Name）。
///
/// 模型扫描器对 Ollama 模型构造的内部 ID 形如 `llm/<name>`（见 model_scanner
/// `scan_ollama_models`，`id: format!("llm/{}", name)`），而 Ollama `/api/chat`
/// 期望的是裸模型名 `<name>`（如 `gemma4:e4b`）。此函数剥离单一的 `llm/` 前缀；
/// 无前缀（如请求体直接给出的裸名）时原样返回。纯函数，便于属性测试。
///
/// 注意：Ollama 标签本身可能含 `/`（如 `library/llama3`），但内部 ID 仅在最前
/// 附加固定的 `llm/`，故只剥离一次前缀即可还原原始标签。
pub fn ollama_model_name(model_id: &str) -> &str {
    model_id.strip_prefix("llm/").unwrap_or(model_id)
}

/// 构造发往 Ollama 的 messages：存在 System_Prompt 时以一条 role:"system" 为首条，
/// 其余按原顺序追加。
pub fn build_ollama_messages(
    system: Option<&str>,
    messages: &[ChatMessage],
) -> Vec<serde_json::Value> {
    let mut out = Vec::with_capacity(messages.len() + 1);
    if let Some(sys) = system {
        out.push(serde_json::json!({
            "role": "system",
            "content": sys,
        }));
    }
    for m in messages {
        out.push(serde_json::json!({
            "role": m.role,
            "content": m.content,
        }));
    }
    out
}

/// 构造发往 Ollama /api/chat 的请求体。纯函数，便于属性测试。
/// - system 为 Some 时，messages 首条置入 {role:"system", content:system}（与现状一致）。
/// - options 为 None 时，产出的 JSON **不含 `options` 键**（缺省无回归，Req 6.1/6.2），
///   即仅含 `model`/`messages`/`stream`，与本特性引入前逐字段等价。
/// - options 为 Some(map) 时，置入 `options` 字段，其键恰为调用方提供的参数集合。
///
/// 被 `chat`（非流式）与 `chat_stream`（流式）复用，区别仅 `stream` 取值（Req 5.5）。
pub fn build_ollama_body(
    model: &str,
    system: Option<&str>,
    messages: &[ChatMessage],
    stream: bool,
    options: Option<serde_json::Map<String, serde_json::Value>>,
) -> serde_json::Value {
    let mut body = serde_json::json!({
        "model": model,
        "messages": build_ollama_messages(system, messages),
        "stream": stream,
    });
    if let Some(map) = options {
        body.as_object_mut()
            .expect("body 必为 JSON 对象")
            .insert("options".to_string(), serde_json::Value::Object(map));
    }
    body
}

/// 非流式对话 — 转发到 Ollama
pub async fn chat(
    State(state): State<Arc<RwLock<AppState>>>,
    Json(req): Json<ChatRequest>,
) -> Result<Json<ChatResponse>, Json<ChatError>> {
    let config = {
        let state = state.read().await;
        state.config.clone()
    };

    let model = resolve_model(config.current_llm_model, &req.model);
    // 规范化为 Ollama 裸模型名（剥离内部 `llm/` 前缀），否则 Ollama 报 model not found。
    let model = ollama_model_name(&model).to_string();

    // 钳制生成参数（可信边界）→ 组装 options → 构造 Ollama 请求体（缺省无回归核心）。
    let options = params_to_options(&clamp_params(&req));
    let ollama_req =
        build_ollama_body(&model, req.system.as_deref(), &req.messages, false, options);

    let client = reqwest::Client::new();
    let res = client
        .post(OLLAMA_URL)
        .json(&ollama_req)
        .timeout(std::time::Duration::from_secs(120))
        .send()
        .await;

    match res {
        Ok(resp) => {
            if !resp.status().is_success() {
                let text = resp.text().await.unwrap_or_default();
                return Err(Json(ChatError {
                    error: format!("Ollama error: {}", text),
                }));
            }

            let body: serde_json::Value = match resp.json().await {
                Ok(v) => v,
                Err(e) => {
                    return Err(Json(ChatError {
                        error: format!("Failed to parse Ollama response: {}", e),
                    }));
                }
            };

            let content = body
                .get("message")
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_str())
                .unwrap_or("")
                .to_string();

            Ok(Json(ChatResponse {
                role: "assistant".to_string(),
                content,
                model: model.clone(),
                done: true,
            }))
        }
        Err(e) => Err(Json(ChatError {
            error: format!(
                "Failed to connect to Ollama: {}. 请确认 Ollama 已启动且模型已加载。",
                e
            ),
        })),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    // Feature: streaming-chat-output, Property 4: Model_Selection 回退顺序
    // Validates: Requirements 1.2, 7.2
    // 对任意 (current_llm_model, current_model_id, request_model)（前两者各可 Some/None），
    // resolve_model 返回值等于 current_llm_model 若 Some，否则 request_model。
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(200))]

        #[test]
        fn prop_resolve_model_fallback_order(
            llm in proptest::option::of(".*"),
            request_model in ".*",
        ) {
            let result = resolve_model(llm.clone(), &request_model);
            let expected = llm.unwrap_or_else(|| request_model.clone());
            prop_assert_eq!(result, expected);
        }
    }

    #[test]
    fn resolve_model_prefers_llm_model() {
        assert_eq!(resolve_model(Some("a".into()), "c"), "a");
    }

    #[test]
    fn resolve_model_falls_back_to_request_model() {
        assert_eq!(resolve_model(None, "c"), "c");
    }

    #[test]
    fn ollama_model_name_strips_llm_prefix() {
        assert_eq!(ollama_model_name("llm/gemma4:e4b"), "gemma4:e4b");
        assert_eq!(ollama_model_name("llm/gemma3:1b"), "gemma3:1b");
    }

    #[test]
    fn ollama_model_name_passthrough_when_no_prefix() {
        // 请求体直接给出的裸名原样返回。
        assert_eq!(ollama_model_name("gemma4:e4b"), "gemma4:e4b");
    }

    #[test]
    fn ollama_model_name_only_strips_leading_prefix_once() {
        // 仅剥离最前一次 `llm/`，保留标签内可能的其余路径分段。
        assert_eq!(ollama_model_name("llm/library/llama3"), "library/llama3");
    }

    // ---------- chat-generation-parameters: 辅助构造 ----------

    fn cmsg(role: &str, content: &str) -> ChatMessage {
        ChatMessage {
            role: role.to_string(),
            content: content.to_string(),
        }
    }

    /// 用给定生成参数构造 ChatRequest（messages/model/system 取默认占位）。
    fn req_with(
        temperature: Option<f64>,
        top_p: Option<f64>,
        num_predict: Option<i64>,
        top_k: Option<i64>,
        repeat_penalty: Option<f64>,
    ) -> ChatRequest {
        ChatRequest {
            messages: vec![cmsg("user", "hi")],
            model: default_model(),
            system: None,
            temperature,
            top_p,
            num_predict,
            top_k,
            repeat_penalty,
        }
    }

    // Feature: chat-generation-parameters, Property 1: Param_Validator 钳制正确性与幂等（后端侧）
    // Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(200))]

        #[test]
        fn prop_clamp_params_ranges_and_idempotence(
            t in proptest::option::of(-100.0f64..100.0),
            p in proptest::option::of(-100.0f64..100.0),
            np in proptest::option::of(-100000i64..100000),
            k in proptest::option::of(-100000i64..100000),
            rp in proptest::option::of(-100.0f64..100.0),
        ) {
            let req = req_with(t, p, np, k, rp);
            let c = clamp_params(&req);

            // 范围正确性 + None 保持 None
            if let Some(v) = c.temperature {
                prop_assert!((0.0..=2.0).contains(&v));
            } else {
                prop_assert!(t.is_none());
            }
            if let Some(v) = c.top_p {
                prop_assert!((0.0..=1.0).contains(&v));
            } else {
                prop_assert!(p.is_none());
            }
            if let Some(v) = c.repeat_penalty {
                prop_assert!((0.0..=2.0).contains(&v));
            } else {
                prop_assert!(rp.is_none());
            }
            if let Some(v) = c.top_k {
                prop_assert!((0..=100).contains(&v));
            } else {
                prop_assert!(k.is_none());
            }
            if let Some(v) = c.num_predict {
                // -1（Unlimited_Length）恒保留，否则落在 [1, 8192]
                prop_assert!(v == -1 || (1..=8192).contains(&v));
                if np == Some(-1) {
                    prop_assert_eq!(v, -1);
                }
            } else {
                prop_assert!(np.is_none());
            }

            // 幂等：对已钳制结果再次钳制不变
            let req2 = req_with(
                c.temperature,
                c.top_p,
                c.num_predict,
                c.top_k,
                c.repeat_penalty,
            );
            let c2 = clamp_params(&req2);
            prop_assert_eq!(c, c2);
        }
    }

    // Feature: chat-generation-parameters, Property 5: Ollama 请求体组装（options 精确性与缺省逐字段等价）
    // Validates: Requirements 5.3, 5.4, 5.5, 6.1, 6.2
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(200))]

        #[test]
        fn prop_build_ollama_body_options_precision(
            t in proptest::option::of(0.0f64..2.0),
            p in proptest::option::of(0.0f64..1.0),
            np in proptest::option::of(1i64..8192),
            k in proptest::option::of(0i64..100),
            rp in proptest::option::of(0.0f64..2.0),
            system in proptest::option::of("[a-z ]{0,20}"),
            stream in any::<bool>(),
        ) {
            let req = req_with(t, p, np, k, rp);
            let options = params_to_options(&clamp_params(&req));
            let body = build_ollama_body(
                "gemma4:e4b",
                system.as_deref(),
                &req.messages,
                stream,
                options,
            );

            // 提供的参数集合（期望出现在 options 的键）
            let mut expected: std::collections::BTreeSet<&str> = std::collections::BTreeSet::new();
            if t.is_some() { expected.insert("temperature"); }
            if p.is_some() { expected.insert("top_p"); }
            if np.is_some() { expected.insert("num_predict"); }
            if k.is_some() { expected.insert("top_k"); }
            if rp.is_some() { expected.insert("repeat_penalty"); }

            // 外层始终含 model/messages/stream，且 stream 取值正确
            prop_assert_eq!(body["stream"].as_bool(), Some(stream));
            prop_assert_eq!(body["model"].as_str(), Some("gemma4:e4b"));
            prop_assert!(body.get("messages").is_some());

            if expected.is_empty() {
                // 缺省无回归：不含 options 键，且与「仅 model/messages/stream」逐字段等价
                prop_assert!(body.get("options").is_none());
                let baseline = serde_json::json!({
                    "model": "gemma4:e4b",
                    "messages": build_ollama_messages(system.as_deref(), &req.messages),
                    "stream": stream,
                });
                prop_assert_eq!(&body, &baseline);
            } else {
                // options 键集合恰为提供的参数集合
                let opts = body["options"].as_object().unwrap();
                let actual: std::collections::BTreeSet<&str> =
                    opts.keys().map(|s| s.as_str()).collect();
                prop_assert_eq!(actual, expected);
            }
        }
    }

    // ---------- Property 4: 前后端钳制等价 —— 共享测试向量 ----------

    /// 共享测试向量：(参数 key, 原始输入, 期望钳制值)。
    /// 前端（generationParams.test.ts）维护同一份向量并断言一致，从而间接保证两侧相等。
    /// 注：参数 key 用前端键名（camelCase），与前端共享向量一一对应。
    struct ClampCase {
        key: &'static str,
        raw: f64,
        expected: f64,
    }

    fn shared_clamp_vectors() -> Vec<ClampCase> {
        vec![
            // temperature [0, 2]
            ClampCase {
                key: "temperature",
                raw: -5.0,
                expected: 0.0,
            },
            ClampCase {
                key: "temperature",
                raw: 0.0,
                expected: 0.0,
            },
            ClampCase {
                key: "temperature",
                raw: 1.3,
                expected: 1.3,
            },
            ClampCase {
                key: "temperature",
                raw: 2.0,
                expected: 2.0,
            },
            ClampCase {
                key: "temperature",
                raw: 9.0,
                expected: 2.0,
            },
            // top_p [0, 1]
            ClampCase {
                key: "topP",
                raw: -1.0,
                expected: 0.0,
            },
            ClampCase {
                key: "topP",
                raw: 0.5,
                expected: 0.5,
            },
            ClampCase {
                key: "topP",
                raw: 1.0,
                expected: 1.0,
            },
            ClampCase {
                key: "topP",
                raw: 3.0,
                expected: 1.0,
            },
            // repeat_penalty [0, 2]
            ClampCase {
                key: "repeatPenalty",
                raw: -2.0,
                expected: 0.0,
            },
            ClampCase {
                key: "repeatPenalty",
                raw: 1.1,
                expected: 1.1,
            },
            ClampCase {
                key: "repeatPenalty",
                raw: 5.0,
                expected: 2.0,
            },
            // top_k [0, 100] 整型
            ClampCase {
                key: "topK",
                raw: -10.0,
                expected: 0.0,
            },
            ClampCase {
                key: "topK",
                raw: 3.7,
                expected: 4.0,
            },
            ClampCase {
                key: "topK",
                raw: 40.0,
                expected: 40.0,
            },
            ClampCase {
                key: "topK",
                raw: 250.0,
                expected: 100.0,
            },
            // num_predict: -1 逃逸 + [1, 8192] 整型
            ClampCase {
                key: "numPredict",
                raw: -1.0,
                expected: -1.0,
            },
            ClampCase {
                key: "numPredict",
                raw: 0.0,
                expected: 1.0,
            },
            ClampCase {
                key: "numPredict",
                raw: 512.4,
                expected: 512.0,
            },
            ClampCase {
                key: "numPredict",
                raw: 99999.0,
                expected: 8192.0,
            },
        ]
    }

    /// 按 key 用 clamp_params 钳制单个原始值，返回 f64 以便与前端向量比较。
    fn clamp_single(key: &str, raw: f64) -> f64 {
        match key {
            "temperature" => clamp_params(&req_with(Some(raw), None, None, None, None))
                .temperature
                .unwrap(),
            "topP" => clamp_params(&req_with(None, Some(raw), None, None, None))
                .top_p
                .unwrap(),
            "repeatPenalty" => clamp_params(&req_with(None, None, None, None, Some(raw)))
                .repeat_penalty
                .unwrap(),
            // 整型参数：前端先 Math.round 再 clamp；后端入参为已取整 i64，
            // 故此处显式取整以复刻前端语义。
            "topK" => clamp_params(&req_with(None, None, None, Some(raw.round() as i64), None))
                .top_k
                .unwrap() as f64,
            "numPredict" => {
                let v = if raw == -1.0 { -1 } else { raw.round() as i64 };
                clamp_params(&req_with(None, None, Some(v), None, None))
                    .num_predict
                    .unwrap() as f64
            }
            _ => panic!("unknown key {}", key),
        }
    }

    // Feature: chat-generation-parameters, Property 4: 前后端钳制等价（Server_Param_Validator 侧）
    // Validates: Requirements 5.2
    #[test]
    fn clamp_params_matches_shared_vectors() {
        for case in shared_clamp_vectors() {
            let got = clamp_single(case.key, case.raw);
            assert!(
                (got - case.expected).abs() < 1e-9,
                "key={} raw={} expected={} got={}",
                case.key,
                case.raw,
                case.expected,
                got
            );
        }
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(200))]

        // 随机输入复核范围正确性（与前端 Property 4 随机断言对应）
        #[test]
        fn prop_clamp_params_range_recheck(
            t in -50.0f64..50.0,
            k in -500i64..500,
            np in -500i64..50000,
        ) {
            let c = clamp_params(&req_with(Some(t), None, Some(np), Some(k), None));
            prop_assert!((0.0..=2.0).contains(&c.temperature.unwrap()));
            prop_assert!((0..=100).contains(&c.top_k.unwrap()));
            let v = c.num_predict.unwrap();
            prop_assert!(v == -1 || (1..=8192).contains(&v));
        }
    }

    // ---------- 2.3 反序列化契约 / 端点一致性 / 缺省无回归 示例测试 ----------

    #[test]
    fn deserialize_without_gen_params() {
        let json = r#"{"messages":[{"role":"user","content":"hi"}]}"#;
        let req: ChatRequest = serde_json::from_str(json).unwrap();
        assert!(req.temperature.is_none());
        assert!(req.top_p.is_none());
        assert!(req.num_predict.is_none());
        assert!(req.top_k.is_none());
        assert!(req.repeat_penalty.is_none());
    }

    #[test]
    fn deserialize_with_partial_gen_params() {
        let json = r#"{"messages":[{"role":"user","content":"hi"}],"temperature":1.4,"top_k":40}"#;
        let req: ChatRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.temperature, Some(1.4));
        assert_eq!(req.top_k, Some(40));
        assert!(req.top_p.is_none());
    }

    #[test]
    fn deserialize_invalid_type_falls_back_to_none() {
        // 非法类型（字符串）经 #[serde(default)] 落为 None，而非反序列化报错。
        let json = r#"{"messages":[{"role":"user","content":"hi"}],"temperature":"hot"}"#;
        let req: ChatRequest = serde_json::from_str(json).unwrap();
        assert!(req.temperature.is_none());
    }

    #[test]
    fn default_state_body_has_no_options() {
        // 缺省无回归：无任何生成参数 → 不含 options，仅 model/messages/stream。
        let req = req_with(None, None, None, None, None);
        let options = params_to_options(&clamp_params(&req));
        let body = build_ollama_body("gemma4:e4b", None, &req.messages, false, options);
        assert!(body.get("options").is_none());
        let expected = serde_json::json!({
            "model": "gemma4:e4b",
            "messages": build_ollama_messages(None, &req.messages),
            "stream": false,
        });
        assert_eq!(body, expected);
    }

    #[test]
    fn chat_and_stream_produce_same_options() {
        // 端点一致性：相同输入下 chat（stream=false）与 chat_stream（stream=true）
        // 经 build_ollama_body 产出的 options 相同，仅 stream 取值不同。
        let req = req_with(Some(1.4), None, Some(512), Some(40), None);
        let options = params_to_options(&clamp_params(&req));
        let non_stream = build_ollama_body("m", None, &req.messages, false, options.clone());
        let stream = build_ollama_body("m", None, &req.messages, true, options);
        assert_eq!(non_stream["options"], stream["options"]);
        assert_eq!(non_stream["options"]["temperature"], 1.4);
        assert_eq!(non_stream["options"]["num_predict"], 512);
        assert_eq!(non_stream["options"]["top_k"], 40);
        assert_eq!(non_stream["stream"], false);
        assert_eq!(stream["stream"], true);
    }
}
