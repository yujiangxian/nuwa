# ASR / TTS 模型最终测试报告

> 测试时间: 2026-05-03
> 测试环境: Windows 11 + AMD RX 9070 XT (ROCm)
> PyTorch: 2.10.0+rocm7.13.0a20260404
> Transformers: 5.8.0.dev0 (nightly)
> Python: 3.11.6

---

## 一、ASR 模型测试结果 (4/6 成功)

| 模型 | 状态 | 识别结果 | 加载时间 | 推理时间 | 显存占用 | 备注 |
|------|------|----------|---------|---------|---------|------|
| **Paraformer-large** | ✅ 成功 | 穿上它能更好完成任务它很美 | 2.45s | 6.21s | 928MB | FunASR，最稳定 |
| **Whisper-small** | ✅ 成功 | 揣手他,能更好完成任務他很美 | 1.65s | 1.01s | 1134MB | OpenAI 基准 |
| **GLM-ASR-Nano** | ✅ 成功 | 穿上它能更好完成任务，它很美。 | 6.47s | 1.04s | 4428MB | 需 16000Hz 音频 |
| **Qwen3-ASR-0.6B** | ✅ 成功 | 穿上它，能更好完成任务。它很美。 | 0.88s | 6.63s | ~1600MB* | 子进程+transformers 4.57.6 |
| **MiMo-V2.5-ASR** | ❌ 失败 | - | - | - | - | transformers 5.8.0.dev0 不兼容 |
| **Dolphin-small** | ❌ 失败 | - | - | - | - | transformers/espnet 版本不兼容 |

\* Qwen3-ASR 在子进程中运行，显存统计未返回

### 成功模型详细分析

**1. Paraformer-large (FunASR)**
- 中文识别效果优秀，无标点但内容准确
- 推理速度适中，显存占用最低（~928MB）
- 最稳定的生产环境选择

**2. Whisper-small**
- 加载最快（1.65s），推理最快（1.01s）
- 识别结果为繁体中文（"任務"），内容基本准确
- 显存占用 1134MB

**3. GLM-ASR-Nano**
- 识别结果带标点，语义完整
- 显存占用最高（4.4GB），但推理速度快（1.04s）
- **关键注意事项**: 传入音频必须是 **16000Hz** 采样率，否则 feature extractor 会输出常量特征，导致识别结果错误

**4. Qwen3-ASR-0.6B**
- 识别结果最规范，带标点和正确断句
- 由于 `qwen-asr 0.0.6` 与 `transformers 5.8.0.dev0` 存在多处不兼容，采用 **子进程+temp_qwen_env(transformers 4.57.6)** 方式运行
- 这是当前测试环境中识别效果最好的模型

### 失败模型分析

**5. MiMo-V2.5-ASR (8B)**
- 错误: `'MiMoAudioTokenizer' object has no attribute 'all_tied_weights_keys'`
- 根因: MiMo 的 tokenizer 代码依赖的 transformers API 在 5.8.0.dev0 中已变更
- 模型文件完整（30.6GB），tokenizer 也完整
- **修复建议**: 在隔离环境（transformers 4.4x ~ 4.5x）中运行，或等待 MiMo 官方更新代码

**6. Dolphin-small**
- 错误: `'DolphinSpeech2Text' object has no attribute 'partial_ar'`
- 根因: `dolphin` 库依赖的 `espnet2` 与当前 torch/transformers 版本不兼容
- 模型加载成功（4.53s），但推理失败
- **修复建议**: 安装与 Dolphin 兼容的 espnet 版本，或在隔离环境中测试

---

## 二、TTS 模型测试结果 (0/6 成功)

所有 TTS 模型均因**依赖安装失败**或**模型格式不完整**无法在当前环境下完成推理。

| 模型 | 状态 | 失败阶段 | 详细原因 |
|------|------|---------|---------|
| **Fish Audio S2** | ❌ 失败 | 依赖导入 | `audiotools` 安装后仍因 `torch.distributed.ReduceOp.AVG` 不存在而导入失败。numpy 版本冲突（要求 <=1.26.4，实际 2.0.2） |
| **CosyVoice 3** | ❌ 失败 | 库安装 | PyPI 上的 `cosyvoice` 包非官方包，无法导入 `cosyvoice.cli`。GitHub 克隆失败（网络连接超时） |
| **Qwen3-TTS** | ❌ 失败 | 模型不完整 + 依赖冲突 | 仅下载了 Talker 的 GGUF 权重（Q8_0），缺少 Predictor/Encoder/Decoder/Tokenizer。`qwen-tts` 包与 transformers 5.8.0.dev0 不兼容（`check_model_inputs` 装饰器错误） |
| **IndexTTS-2** | ❌ 失败 | 库安装 | `pip install git+https://github.com/index-tts/index-tts.git` 因网络超时失败 |
| **GLM-TTS** | ❌ 失败 | 库安装 | `pip install git+https://github.com/zai-org/GLM-TTS.git` 因网络超时失败 |
| **OpenVoice** | ❌ 失败 | 库安装 | PyPI 无 `openvoice` 包，`pip install git+https://github.com/myshell-ai/OpenVoice.git` 因网络超时失败 |

### TTS 失败根因总结

1. **网络限制**: GitHub (github.com) 连接超时，导致所有需要从 GitHub 克隆/安装的 TTS 库无法获取
2. **PyPI 包名不匹配**: CosyVoice、OpenVoice 在 PyPI 上没有官方包，或包名被占用
3. **模型文件不完整**: Qwen3-TTS 仅下载了 GGUF 格式的 Talker 权重，缺少完整的 pipeline 组件
4. **依赖版本冲突**: Fish Speech 要求 numpy<=1.26.4，但当前环境为 2.0.2；torch.distributed API 不兼容
5. **Transformers 版本冲突**: qwen-tts 与 transformers 5.8.0.dev0 不兼容

---

## 三、环境与兼容性限制

### 核心限制因素

| 限制 | 影响 |
|------|------|
| **transformers 5.8.0.dev0** | Qwen3-ASR、qwen-tts、MiMo、Dolphin 均不兼容 |
| **ROCm torch 2.10.0 nightly** | 部分库缺少 ROCm 预编译 wheel（如 onnxruntime-gpu、torchcodec） |
| **GitHub 网络不通** | 无法克隆 CosyVoice、IndexTTS、GLM-TTS、OpenVoice 等仓库 |
| **Windows 编译环境** | Dolphin 的 sentencepiece、flash-attn 等需要 MSVC 编译 |
| **模型文件不完整** | Qwen3-TTS 仅有 GGUF，缺少其余组件 |

### 已创建的辅助环境

- **temp_qwen_env**: 安装了 transformers 4.57.6，用于成功运行 Qwen3-ASR

---

## 四、下一步修复建议

### ASR (优先级高)

1. **MiMo-V2.5-ASR**
   - 创建隔离环境，安装 `transformers==4.45.0` 或 `4.46.0`
   - 克隆 https://github.com/XiaomiMiMo/MiMo-V2.5-ASR
   - 运行 `pip install -r requirements.txt`

2. **Dolphin-small**
   - 创建隔离环境
   - 安装兼容版本的 espnet: `pip install espnet==202402`
   - 或尝试直接从 transformers 加载（绕过 dolphin 库）

### TTS (优先级中)

1. **解决网络问题**
   - 配置 GitHub 代理或镜像
   - 或使用 ModelScope/HuggingFace 镜像下载项目源码

2. **Fish Audio S2**
   - 创建隔离环境，安装 `numpy==1.26.4`
   - 从 ModelScope 下载 fish-speech 源码: `git clone https://github.com/fishaudio/fish-speech.git`
   - 安装完整依赖（包括 audiotools 等）

3. **CosyVoice 3**
   - 从 ModelScope 克隆: `git clone --recursive https://github.com/FunAudioLLM/CosyVoice.git`
   - 安装依赖: `pip install -r requirements.txt`
   - 模型文件已下载，可直接使用本地路径加载

4. **Qwen3-TTS**
   - 方案A: 下载完整的 HuggingFace 格式模型（非 GGUF）
   - 方案B: 使用 `qwen-tts` PyPI 包，但需在 transformers 4.57.x 环境中运行

5. **IndexTTS-2 / GLM-TTS / OpenVoice**
   - 均需先解决 GitHub 网络访问问题
   - 然后克隆仓库并安装依赖

### 环境优化建议

1. **创建多个隔离环境**:
   ```powershell
   # ASR 环境 (transformers 5.x)
   python -m venv asr_env

   # Qwen3-ASR 环境 (transformers 4.57.x)
   python -m venv qwen_env

   # TTS 环境 (各模型独立)
   python -m venv cosyvoice_env
   ```

2. **降级 numpy 到 1.26.4** 在专门的 TTS 环境中

3. **安装 GitHub 代理** 或使用 gitee 镜像

---

## 五、测试脚本索引

| 脚本 | 用途 |
|------|------|
| `scripts/test_asr_final.py` | ASR 完整测试（4个成功模型） |
| `scripts/test_qwen3_gpu.py` | Qwen3-ASR GPU 测试 |
| `scripts/test_glm_asr_resample.py` | GLM-ASR-Nano 16000Hz 测试 |
| `scripts/test_mimo_dolphin_asr.py` | MiMo/Dolphin 测试 |
| `scripts/test_tts_all.py` | TTS 全模型测试 |
| `results/asr_tests/asr_final_test_*.json` | ASR 测试报告 JSON |
| `results/asr_tests/mimo_dolphin_test_result.json` | MiMo/Dolphin 测试结果 |

---

## 六、结论

在当前测试环境（Windows 11 + ROCm + transformers 5.8.0.dev0）下：

- **ASR**: **4/6 模型成功运行**，Paraformer、Whisper、GLM-ASR-Nano、Qwen3-ASR 均可正常使用。MiMo 和 Dolphin 因 transformers 版本不兼容需要隔离环境。
- **TTS**: **0/6 模型成功运行**，主要受限于 GitHub 网络不通、PyPI 包缺失、依赖版本冲突和模型文件不完整。

**推荐方案**:
- ASR 生产环境首选 **Paraformer-large**（稳定、低显存）或 **Qwen3-ASR-0.6B**（识别效果最佳）
- TTS 需要在解决网络/依赖问题后重新测试
