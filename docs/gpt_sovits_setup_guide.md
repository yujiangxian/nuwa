# GPT-SoVITS 生产环境搭建指南

> 目标：将 GPT-SoVITS 接入现有 TTS 对比测试流程，克隆 jyy 音色

---

## 一、当前状态诊断

### 已有资源
- `Stefanie_Sun/G_27200.pth` —— 孙燕姿的 **SoVITS Stage 2** 权重（542MB）
- `Stefanie_Sun/config.json` —— 模型配置（44100Hz, vec256l9）
- `Stefanie_Sun/kmeans_10000.pt` —— 语义 token 聚类中心

### 缺失资源（无法运行推理）
- **GPT-SoVITS 源码**（GitHub: RVC-Boss/GPT-SoVITS）
- **预训练模型**（HuBERT + BERT + GPT 预训练权重）
- **GPT Stage 1 权重**（孙燕姿的 GPT 检查点，如 `sun-e25.ckpt`）

> 注意：GPT-SoVITS 推理需要 **Stage 1 (GPT) + Stage 2 (SoVITS)** 两个权重缺一不可。当前只有 SoVITS，缺少 GPT，因此孙燕姿模型无法直接推理。

### 结论
**建议直接用 jyy 的数据训练一个新的 GPT-SoVITS 模型**，而非寻找孙燕姿的 GPT 权重。原因：
1. jyy 数据已经清洗好（20 条切片，约 3-4 分钟）
2. GPT-SoVITS v2 的微调门槛很低（1-3 分钟音频即可）
3. 训练后的模型可直接用于生产环境

---

## 二、手动下载清单

### Step 1：下载 GPT-SoVITS v2 源码

```bash
# 方式 A：GitHub（需要科学上网）
git clone --depth 1 https://github.com/RVC-Boss/GPT-SoVITS.git GPT-SoVITS-main

# 方式 B：如果 GitHub 连不上，从本项目的 model-test 目录直接复制（如果你在其他地方已有源码）
```

下载后放在项目根目录：
```
F:\mystudy\model-test\GPT-SoVITS-main\
```

---

### Step 2：下载预训练模型（约 4GB）

GPT-SoVITS v2 需要以下预训练模型，**从 HuggingFace 下载**：

| 模型 | HuggingFace 地址 | 本地存放路径 |
|:---|:---|:---|
| **GPT 预训练** | `RVC-Boss/GPT-SoVITS/pretrained_models` | `GPT-SoVITS-main/pretrained_models/` |
| **Chinese-RoBERTa** | `hfl/chinese-roberta-wwm-ext-large` | `GPT-SoVITS-main/pretrained_models/chinese-roberta-wwm-ext-large/` |
| **Chinese-HuBERT** | `hfl/chinese-hubert-base` | `GPT-SoVITS-main/pretrained_models/chinese-hubert-base/` |

**推荐的下载方式：**

1. **从 HuggingFace 官网手动下载**（需要科学上网）：
   - https://huggingface.co/RVC-Boss/GPT-SoVITS/tree/main/pretrained_models
   - https://huggingface.co/hfl/chinese-roberta-wwm-ext-large
   - https://huggingface.co/hfl/chinese-hubert-base

2. **从 HuggingFace 镜像站下载**（国内可访问）：
   - https://hf-mirror.com/RVC-Boss/GPT-SoVITS/tree/main/pretrained_models
   - https://hf-mirror.com/hfl/chinese-roberta-wwm-ext-large
   - https://hf-mirror.com/hfl/chinese-hubert-base

3. **用 huggingface-cli 命令行下载**（推荐，可断点续传）：
   ```bash
   # 设置镜像站
   set HF_ENDPOINT=https://hf-mirror.com
   
   # 下载 GPT-SoVITS 预训练模型
   huggingface-cli download RVC-Boss/GPT-SoVITS --local-dir GPT-SoVITS-main --local-dir-use-symlinks False
   
   # 下载 BERT
   huggingface-cli download hfl/chinese-roberta-wwm-ext-large --local-dir GPT-SoVITS-main/pretrained_models/chinese-roberta-wwm-ext-large --local-dir-use-symlinks False
   
   # 下载 HuBERT
   huggingface-cli download hfl/chinese-hubert-base --local-dir GPT-SoVITS-main/pretrained_models/chinese-hubert-base --local-dir-use-symlinks False
   ```

> 如果 `huggingface-cli` 未安装，先执行：`pip install huggingface_hub`

---

### Step 3：准备 jyy 训练数据

数据已经就绪，无需额外下载：
```
data/jyy/sliced_final/
  jyy_000.wav ~ jyy_019.wav  （共 20 条，约 3-4 分钟）
```

**需要补充：ASR 标注文件**

训练 GPT-SoVITS 需要每条音频对应的文本标注。可以用现有 ASR 结果：

```
data/jyy/sliced_final/
  jyy_000.wav  →  "穿上它能更好完成任务它很美"
  jyy_001.wav  →  （需要 ASR）
  ...
```

标注格式（GPT-SoVITS 标准格式）：
```
路径|说话人|文本
```

示例 `filelists/jyy_train.txt`：
```
F:\mystudy\model-test\data\jyy\sliced_final\jyy_000.wav|jyy|穿上它能更好完成任务它很美
F:\mystudy\model-test\data\jyy\sliced_final\jyy_001.wav|jyy|...
```

---

## 三、训练流程（本地 ROCm 环境）

### 环境准备

```powershell
# 1. 激活现有环境
.\ai_env\Scripts\Activate.ps1

# 2. 安装 GPT-SoVITS 依赖（使用 --no-deps 防止覆盖 ROCm PyTorch）
cd GPT-SoVITS-main
pip install -r requirements.txt --no-deps

# 3. 单独安装可能缺失的依赖
pip install transformers==4.43.0 librosa==0.9.2
```

### Stage 1：训练 GPT（语义预测模型）

```powershell
$env:PYTORCH_ENABLE_FLASH_ATTENTION = "0"
$env:ROCM_PATH = "C:\Program Files\AMD\ROCm\6.3"

python GPT_SoVITS/s1_train.py `
  --config_path GPT_SoVITS/configs/s1longer-v2.yaml `
  --input_file filelists/jyy_train.txt `
  --output_dir output/jyy_gpt `
  --pretrained_s1 pretrained_models/s1bert-v2.ckpt
```

- 训练时长：约 1-2 小时（RX 9070 XT，20 条数据）
- 输出：`output/jyy_gpt/*.ckpt`

### Stage 2：训练 SoVITS（音频生成模型）

```powershell
python GPT_SoVITS/s2_train.py `
  --config_path GPT_SoVITS/configs/s2-v2.json `
  --input_file filelists/jyy_train.txt `
  --output_dir output/jyy_sovits `
  --pretrained_s2 pretrained_models/s2G2333k.pth `
  --pretrained_s2D pretrained_models/s2D2333k.pth
```

- 训练时长：约 30-60 分钟
- 输出：`output/jyy_sovits/G_*.pth`

---

## 四、推理测试

训练完成后，使用以下脚本进行推理：

```python
# scripts/test_gpt_sovits_jyy.py
import sys
sys.path.insert(0, 'GPT-SoVITS-main')

from GPT_SoVITS.inference_webui import change_gpt_weights, change_sovits_weights, get_tts_wav

# 加载权重
change_gpt_weights("output/jyy_gpt/jyy-e15.ckpt")
change_sovits_weights("output/jyy_sovits/G_27200.pth")

# 推理
text = "大家好，这是人工智能语音克隆的效果测试，希望你能喜欢这个声音。"
ref_audio = "data/jyy/sliced_final/jyy_005.wav"
ref_text = "幽冥鬼火永不休止无偿与判官"

wav = get_tts_wav(ref_audio, ref_text, text, "中文")
# 保存 wav
```

---

## 五、快速验证清单

下载完成后，检查以下文件是否齐全：

```
GPT-SoVITS-main/
  ├── pretrained_models/
  │   ├── s1bert-v2.ckpt          # GPT 预训练权重
  │   ├── s2G2333k.pth            # SoVITS 生成器预训练
  │   ├── s2D2333k.pth            # SoVITS 判别器预训练
  │   ├── chinese-roberta-wwm-ext-large/   # BERT 模型
  │   └── chinese-hubert-base/             # HuBERT 模型
  ├── GPT_SoVITS/
  │   ├── s1_train.py
  │   ├── s2_train.py
  │   └── inference_webui.py
  └── requirements.txt
```

---

## 六、与现有 TTS Showcase 集成

训练完成后，将 GPT-SoVITS 加入 `scripts/compare_tts_similarity.py` 的对比列表：

```python
TTS_OUTPUTS = {
    "CosyVoice-3":   "results/showcase/tts_cosyvoice_best.wav",
    "Qwen3-TTS":     "results/showcase/tts_qwen3_best.wav",
    "GLM-TTS":       "results/showcase/tts_glm_best.wav",
    "OpenVoice":     "results/showcase/tts_openvoice_best.wav",
    "GPT-SoVITS":    "results/showcase/tts_gpt_sovits_jyy.wav",  # 新增
}
```

---

## 七、常见问题

**Q: 训练数据只有 20 条，够用吗？**
A: GPT-SoVITS v2 的微调门槛是 1-3 分钟高质量音频。jyy 的 20 条切片总计约 3-4 分钟，刚好满足最低要求。效果可能不如 10 分钟数据训练的好，但足以进行对比测试。

**Q: 能否直接用孙燕姿的 SoVITS 权重？**
A: 不能。GPT-SoVITS 推理必须同时加载 GPT 权重和 SoVITS 权重。当前只有孙燕姿的 SoVITS 权重（`G_27200.pth`），缺少对应的 GPT 权重，因此无法推理。

**Q: ROCm 兼容性如何？**
A: 训练脚本中需要设置 `torch.backends.cudnn.enabled = False`（MIOpen bug），与现有环境一致。如果训练时遇到 `flash_attn` 错误，设置环境变量 `PYTORCH_ENABLE_FLASH_ATTENTION=0`。
