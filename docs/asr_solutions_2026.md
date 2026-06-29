# 2026 年中文 ASR 解决方案汇总

> 搜索时间：2026年5月2日
> 
> 已下载模型：Qwen3-ASR、MiMo-V2.5-ASR、Dolphin、Paraformer、GLM-ASR-Nano

## 一、已下载模型

### 1. Qwen3-ASR ★★★★★
- **开发者**: 阿里云通义千问团队
- **特点**:
  - 支持 52 种语言和方言
  - 支持语言识别和 ASR
  - 支持语音/音乐/歌曲识别
  - 基于强大的 Qwen3-Omni 基础模型
- **模型版本**:
  - Qwen3-ASR-1.7B
  - Qwen3-ASR-0.6B（轻量版，已下载）
- **本地路径**: `models/asr_models/qwen3-asr-0.6b/`
- **GitHub**: https://github.com/QwenLM/Qwen3-ASR
- **优势**: 多模态能力，支持流式识别

### 2. MiMo-V2.5-ASR ★★★★★
- **开发者**: 小米 MiMo 团队
- **特点**:
  - 支持中英双语识别
  - 支持 8 种中文方言（粤语、四川话等）
  - 支持代码切换、歌词转录
  - 支持噪声环境、多说话人场景
  - 支持知识密集型内容
- **模型大小**: 8B 参数（已下载）
- **本地路径**: `models/asr_models/mimo-v2.5-asr/`
- **GitHub**: https://huggingface.co/XiaomiMiMo/MiMo-V2.5-ASR
- **优势**: 复杂场景鲁棒性强

### 3. Dolphin ★★★★☆
- **开发者**: DataoceanAI + 清华大学
- **特点**:
  - 专为东方语言设计
  - 支持 40 种东方语言
  - 支持 22 种中文方言
  - 基于 Whisper 架构扩展
- **本地路径**: `models/asr_models/dolphin-small/`
- **HuggingFace**: https://huggingface.co/DataoceanAI/dolphin-small
- **优势**: 方言支持最广泛

### 4. Paraformer (FunASR) ★★★★☆
- **开发者**: 阿里达摩院
- **特点**:
  - 非自回归模型，推理速度快
  - FunASR 工具链完整
  - 支持 VAD、标点恢复、说话人分离
- **本地路径**: `models/asr_models/paraformer-large/`
- **GitHub**: https://github.com/modelscope/FunASR
- **优势**: 生态系统成熟，部署方便

### 5. GLM-ASR-Nano ★★★☆☆
- **开发者**: 智谱AI
- **特点**:
  - 1.5B 参数
  - 鲁棒性强
- **本地路径**: `models/asr_models/glm-asr-nano/`
- **HuggingFace**: https://huggingface.co/zai-org/GLM-ASR-Nano-2512

## 二、商业 API 服务

### 1. Doubao-ASR (豆包/字节跳动)
- **特点**: 
  - Seed-ASR 2.0 模型
  - 中文语音识别最佳
  - 需要通过火山引擎 API 调用
- **API**: 字节跳动火山引擎

### 2. 阿里云百炼 ASR
- **特点**:
  - 支持 FunASR/Paraformer
  - 支持实时和离线识别
- **API**: 阿里云百炼平台

### 3. 腾讯云 ASR
- **特点**: 
  - 支持多种语言和方言
  - 支持实时和录音文件识别
- **API**: 腾讯云语音识别

## 三、针对 jyy 古装剧台词的推荐

根据之前的测试问题（Whisper 对古装剧台词识别准确度低），推荐方案：

### 最佳选择：Qwen3-ASR
**理由**：
1. 阿里云出品，中文能力强
2. 多模态基础，理解能力更强
3. 支持 52 种语言和方言
4. 支持语音/音乐/歌曲识别

### 备选方案 1：MiMo-V2.5-ASR
**理由**：
1. 小米出品，针对复杂场景优化
2. 支持知识密集型内容
3. 支持歌词转录（古装戏剧词可能有帮助）
4. 8B 参数，能力强

### 备选方案 2：Dolphin
**理由**：
1. 支持 22 种方言
2. 东方语言专用优化
3. 清华大学合作开发

### 备选方案 3：Paraformer
**理由**：
1. 推理速度快
2. FunASR 工具链完整
3. 部署方便

## 四、模型对比表

| 模型 | 中文 CER | 方言支持 | 大小 | CPU 速度 | 本地路径 |
|------|---------|---------|------|---------|---------|
| Qwen3-ASR-0.6B | ~3% | 52语言 | 1.79 GB | 中等 | `models/asr_models/qwen3-asr-0.6b/` |
| MiMo-V2.5-ASR | ~3% | 8种方言 | 30.6 GB | 较慢 | `models/asr_models/mimo-v2.5-asr/` |
| Dolphin-small | ~4% | 22方言 | 1.42 GB | 中等 | `models/asr_models/dolphin-small/` |
| Paraformer-large | ~4% | 多语言 | 0.85 GB | 快 | `models/asr_models/paraformer-large/` |
| GLM-ASR-Nano | ~4% | 多语言 | 2.02 GB | 中等 | `models/asr_models/glm-asr-nano/` |

## 五、安装方式

**Qwen3-ASR**：
```powershell
pip install transformers torch modelscope
# 从本地加载模型
```

**MiMo-V2.5-ASR**：
```powershell
pip install transformers torch modelscope
# 从本地加载模型
```

**Dolphin**：
```powershell
pip install transformers torch
# 从本地加载模型
```

**Paraformer + FunASR**：
```powershell
pip install funasr modelscope
```

**GLM-ASR**：
```powershell
pip install transformers torch
# 从本地加载模型
```

## 六、下一步行动

1. **编写测试脚本**：对 jyy 古装剧台词进行识别测试
2. **对比测试**：各模型识别准确度对比
3. **选择最佳方案**：根据测试结果选择最适合的 ASR 模型
4. **集成到工作流**：将最佳 ASR 模型集成到声音克隆工作流
