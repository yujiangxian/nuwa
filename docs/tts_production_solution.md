# TTS 生产级解决方案

> 记录时间: 2026-05-04
> 适用场景: 本地语音对话终端（AMD RX 9070 XT + ROCm）
> 目标说话人: jyy

---

## 一、当前问题诊断

### 1. CosyVoice-3 情感平淡

**根因**: 当前部署的是 `CosyVoice-300M` 基础模型，仅支持 `inference_zero_shot`（音色克隆），**无情感控制接口**。输出情感 100% 复刻参考音频本身。当前参考音频 `jyy_005.wav` 音高标准差仅 15.9，本身语调偏平，故输出机械。

**客观数据**:
- 声纹相似度: 0.878（与 jyy 参考音频相比，排名第一）
- 音高起伏（pitch_std）: 参考音频 15.9，输出音频同样缺乏起伏

### 2. GLM-TTS 长文本音色漂移

**根因**: `generate_long()` 使用 rolling cache 机制。逐句生成时，前面合成的语音 token 被加入 cache 作为后续句子的 conditioning。`MAX_LLM_SEQ_INP_LEN = 750` 限制了输入长度，原始参考音频的 token 占比随文本长度增加而被稀释，模型逐渐回归训练集平均音色。

**现象**: 短句（"大家好"）克隆精准；长文本后半段逐渐不像 jyy。

---

## 二、生产级架构方案

### 2.1 架构总览

```
┌─────────────────────────────────────────────────────────────┐
│                    TTS Orchestrator Service                  │
│         (FastAPI, 统一入口，情感参数 + 模型路由)              │
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐    ┌─────────────────┐    ┌──────────────┐
│  文本预处理层  │    │  参考音频管理器  │    │  音频后处理层 │
│  Text Preproc │    │  Ref Audio Mgr  │    │ Audio Post   │
└───────────────┘    └─────────────────┘    └──────────────┘
        │                     │                     │
        ▼                     ▼                     ▼
┌─────────────────────────────────────────────────────────────┐
│                      模型推理层                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │ CosyVoice   │  │ GLM-TTS     │  │ GPT-SoVITS  │  (Fallback)│
│  │ -Instruct   │  │ -Patched    │  │             │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
└─────────────────────────────────────────────────────────────┘
```

---

## 三、CosyVoice 情感问题：生产级方案

### 3.1 模型层：引入 CosyVoice-300M-Instruct（必选）

基础模型无法满足生产情感控制需求。**必须下载并部署 Instruct 版本**（ModelScope: `iic/CosyVoice-300M-Instruct`，约 3GB）。

该模型支持自然语言情感指令：

```python
model.inference_instruct(
    "穿上它能更好完成任务它很美",
    spk_id="jyy",
    instruct_text="用温柔开心的语气说"
)
```

常见指令映射：
| 情感标签 | instruct_text 示例 |
|:---|:---|
| neutral | "用自然的语气说" |
| happy | "用开心活泼的语气说" |
| gentle | "用温柔亲切的语气说" |
| serious | "用严肃正式的语气说" |
| excited | "用兴奋激动的语气说" |

### 3.2 数据层：情感参考音频库

单一参考音频无法覆盖所有情感场景。生产环境需要按情感标签建立参考音频库：

```
data/ref_library/
└── jyy/
    ├── neutral/
    │   └── jyy_005.wav    (pitch_std=15.9, 平淡叙述)
    ├── happy/
    │   └── jyy_006.wav    (pitch_std=75.3, 起伏最大)
    ├── gentle/
    │   └── jyy_012.wav    (pitch_std=61.7, 柔和亲切)
    └── serious/
        └── jyy_014.wav    (pitch_std=59.0, 严肃沉稳)
```

**准入标准**:
- 时长: 3-10 秒
- ASR 转录文本对齐准确
- 信噪比 SNR > 20dB
- 音高标准差 > 阈值（按情感标签设定）

### 3.3 架构层：EmotionRouter 动态路由

```python
class EmotionRouter:
    EMOTION_MAP = {
        "neutral": {"instruct": "用自然的语气说", "ref": "jyy_005.wav"},
        "happy":   {"instruct": "用开心活泼的语气说", "ref": "jyy_006.wav"},
        "gentle":  {"instruct": "用温柔亲切的语气说", "ref": "jyy_012.wav"},
        "serious": {"instruct": "用严肃正式的语气说", "ref": "jyy_014.wav"},
    }

    def synthesize(self, text: str, speaker: str, emotion: str = "neutral"):
        cfg = self.REF_LIBRARY[speaker][emotion]
        instruct = self.EMOTION_MAP[emotion]["instruct"]
        
        if self.INSTRUCT_AVAILABLE:
            return self.cosyvoice.inference_instruct(
                text, spk_id=speaker, instruct_text=instruct
            )
        else:
            # Fallback: 用对应情感的参考音频做 zero_shot
            return self.cosyvoice.inference_zero_shot(
                text, cfg["text"], cfg["audio"]
            )
```

### 3.4 Fallback：GPT-SoVITS

如果 CosyVoice-Instruct 的情感丰富度仍不满足需求，**启用 GPT-SoVITS 作为情感增强路径**。

- GPT-SoVITS v2 的 VITS 解码器在韵律建模上优于 CosyVoice 的声码器
- 生产做法：同时部署两套模型，按 A/B 测试或场景动态路由
- 情感表现力: GPT-SoVITS > CosyVoice-Instruct > CosyVoice-ZeroShot

---

## 四、GLM-TTS 漂移问题：生产级方案

### 4.1 核心原则：禁用 Rolling Cache

Rolling cache 是漂移的根因。生产级方案必须确保**每一句话都以原始参考音频为唯一 prompt**。

### 4.2 文本层：语义感知分句

```python
def semantic_split(text: str, max_len: int = 25, min_len: int = 8) -> List[str]:
    """
    生产级语义分句：
    1. 按标点切分（。！？；…）
    2. 合并过短句（< min_len）到相邻句
    3. 截断过长句（> max_len）在逗号处分割
    4. 保留句末标点用于控制停顿
    """
    ...
```

### 4.3 生成层：每句独立生成

```python
segments = []
for sentence in semantic_split(text):
    # 每句都重新用原始参考音频做 prompt
    # cache 中只放原始参考音频，不放历史合成结果
    wav, _, _, _ = generate_long(
        ...,
        text_info=[uttid, sentence],
        cache=initial_prompt_cache,  # 始终只含原始参考音频
        ...
    )
    segments.append(wav)
```

### 4.4 音频层：Cross-Fade 拼接

独立生成的句间会有断裂。使用 **Hamming 窗 Cross-Fade** 消除：

```python
def cross_fade_concat(
    segments: List[np.ndarray],
    sr: int = 24000,
    fade_ms: int = 40
) -> np.ndarray:
    """
    生产级音频拼接：句间 cross-fade 消除断裂
    
    Args:
        segments: 各句音频数组
        sr: 采样率
        fade_ms: 淡入淡出时长（毫秒）
    """
    fade_samples = int(sr * fade_ms / 1000)
    result = segments[0]
    
    for seg in segments[1:]:
        # 前段尾部 fade-out
        fade_out = result[-fade_samples:] * np.hanning(fade_samples * 2)[:fade_samples]
        # 后段头部 fade-in
        fade_in = seg[:fade_samples] * np.hanning(fade_samples * 2)[fade_samples:]
        # 叠加混音
        mixed = fade_out + fade_in
        result = np.concatenate([
            result[:-fade_samples],
            mixed,
            seg[fade_samples:]
        ])
    
    return result
```

**为什么是生产级的**:
- 漂移问题被**根除**（每句以原始参考音频为唯一基准）
- 不修改模型源码，不维护 fork
- 句间断裂被 cross-fade 平滑处理，人耳无法感知
- 每句独立推理可**并行化**，长文本延迟可控
- 业界标准做法（Google Cloud TTS、Azure TTS 均使用类似策略）

### 4.5 模型层增强（可选）

如果必须保留 rolling cache（例如为了句间韵律连贯性），则需要 fork GLM-TTS 并修改 `get_cached_prompt`：
- 限制合成历史的长度（最多保留最近 1 句的 token）
- 确保原始 prompt 的 speech token 始终占输入序列的 >=30%
- 当 cache 过长时，优先删除合成历史，而非稀释原始 prompt

**但生产级更推荐方案 4.1+4.3+4.4（禁用 cache + cross-fade），因为实现简单、无漂移、可并行。**

---

## 五、实施路线图

### Phase 1：基础设施（1-2 周）
1. 下载 CosyVoice-300M-Instruct 模型权重（~3GB）
2. 建立参考音频库目录结构 `data/ref_library/{speaker}/{emotion}/`
3. 为 jyy 素材标注情感标签（至少 neutral/happy/gentle/serious 四类）

### Phase 2：CosyVoice 情感化（1 周）
1. 封装 `CosyVoiceTTS` 类，支持 `inference_instruct` 和 `inference_zero_shot` 双路径
2. 实现 `EmotionRouter`：根据请求 emotion 字段选择参考音频 + instruct 文本
3. A/B 测试：对比 Instruct 版 vs Zero-shot + 情感参考音频 的效果

### Phase 3：GLM-TTS 长文本稳定化（1 周）
1. 实现 `SemanticTextSplitter`：按标点 + 长度限制分句
2. 实现 `CrossFadeMixer`：音频段拼接工具
3. 重构 GLM-TTS 推理流程：每句独立调用 `generate_long`（单句模式），然后 cross-fade 拼接

### Phase 4：统一服务化（1 周）
1. 开发 `TTSOrchestrator` FastAPI 服务：
   - 统一接口：`POST /synthesize {text, speaker, emotion, model?}`
   - 模型健康检查与自动 fallback
   - 参考音频库热更新
2. 集成到现有语音对话 Demo

---

## 六、技术风险与回退策略

| 风险 | 影响 | 回退策略 |
|:---|:---|:---|
| CosyVoice-Instruct 下载失败 | 无法获得情感指令能力 | 使用 Zero-shot + 多情感参考音频库作为 fallback |
| Cross-fade 拼接音量跳动 | 听感不自然 | 调整 fade 窗口长度（20ms -> 80ms），增加 RMS 归一化 |
| 分句过短导致停顿不自然 | 节奏破碎 | 合并 < 8 字短句，保持句末标点控制停顿 |
| GLM-TTS 每句独立生成太慢 | 长文本延迟高 | 引入并发生成（每句可并行推理），或回退到 CosyVoice |
| 情感参考音频质量参差 | 克隆效果不稳定 | 建立准入门槛（SNR > 20dB，pitch_std > 阈值）|

---

## 七、参考音频质量数据（jyy 切片分析）

| 文件 | 时长(s) | RMS | PitchStd | PitchRange | 推荐情感标签 |
|:---|:---:|:---:|:---:|:---:|:---|
| jyy_000.wav | 3.32 | 0.1340 | 17.12 | 73.18 | neutral |
| jyy_001.wav | 10.00 | 0.1120 | 17.75 | 105.22 | neutral |
| jyy_002.wav | 10.00 | 0.1195 | 510.01 | 1789.52 | **排除**（异常高，疑似非语音/噪音） |
| jyy_003.wav | 3.12 | 0.1329 | 16.93 | 80.58 | neutral |
| jyy_004.wav | 7.02 | 0.1278 | 13.81 | 76.42 | neutral |
| jyy_005.wav | 4.34 | 0.1303 | 15.88 | 70.02 | neutral（当前默认） |
| jyy_006.wav | 10.00 | 0.1223 | **75.25** | 285.84 | **happy** |
| jyy_007.wav | 5.32 | 0.1281 | 15.64 | 82.28 | neutral |
| jyy_008.wav | 10.00 | 0.1282 | 16.15 | 77.25 | neutral |
| jyy_009.wav | 10.00 | 0.1233 | 19.40 | 91.06 | neutral |
| jyy_010.wav | 10.00 | 0.1298 | 22.64 | 124.45 | neutral |
| jyy_011.wav | 10.00 | 0.1215 | 20.40 | 102.29 | neutral |
| jyy_012.wav | 10.00 | 0.1208 | **61.73** | 283.82 | **gentle** |
| jyy_013.wav | 10.00 | 0.1291 | 23.42 | 131.73 | neutral |
| jyy_014.wav | 10.00 | 0.1206 | **59.04** | 283.82 | **serious** |
| jyy_015.wav | 8.70 | 0.1227 | 17.57 | 96.58 | neutral |
| jyy_016.wav | 8.02 | 0.1248 | 16.75 | 94.47 | neutral |
| jyy_017.wav | 10.00 | 0.1255 | 18.62 | 86.60 | neutral |
| jyy_018.wav | 10.00 | 0.1220 | 13.94 | 79.44 | neutral |
| jyy_019.wav | 5.28 | 0.1145 | 20.12 | 85.73 | neutral |

> **说明**: PitchStd（音高标准差）越高，说明语调起伏越大，情感越丰富。jyy_006/012/014 是情感参考音频的最佳候选。
