项目名称：基于多模态大模型的边缘端AI助手——类似豆包APP的笔记本部署实现
测试目标：
利用申请的高性能算力，训练声音克隆模型，并结合最新开源多模态大模型，集成文本对话、图像识别、
声音克隆和实时视频交互能力，通过量化等技术将全部模块部署至笔记本电脑
（AMD 9950HX / 32GB RAM / RTX5070 8GB）上实时运行，实现本地智能交互终端。

================================================================================
技术路线（2026.04 更新）
================================================================================

核心架构：Gemma 4 E4B + GPT-SoVITS + Whisper，分时复用 GPU

一、多模态基础模型 —— Gemma 4 E4B
  选型: Google DeepMind Gemma 4 E4B (2026.04.02 发布)
    - 有效参数 4.5B，含嵌入层总参数 8B
    - 原生支持文本 + 图像 + 音频三模态输入，文本输出
    - 128K 上下文窗口
    - Apache 2.0 开源许可，无商用限制
    - INT4 量化 (Q4_K_M) 显存占用 ~5.5-6 GB，适配 RTX 5070 8GB
  能力覆盖:
    - 文本对话: 通用问答、指令跟随、推理
    - 图像理解: OCR、图像描述、图表分析、UI 理解
    - 视频理解: 通过关键帧序列输入（最长 60s@1fps），替代独立视频模型
    - 音频理解: 原生音频输入（最长 30s），可辅助语音识别
  对比旧方案优势:
    - 旧方案需 LLaVA/Qwen-VL（文本+图像）+ VideoMAE/TimeSformer（视频）两个模型
    - 新方案 Gemma 4 E4B 一个模型覆盖文本+图像+视频+音频，架构大幅简化
  部署方式: Ollama 或 llama.cpp，Q4_K_M 量化

二、声音克隆与语音合成 —— GPT-SoVITS
  框架: GPT-SoVITS v2
  训练数据: 孙燕姿说话素材，31 条干净切片（5.8 分钟）
  训练配置: SoVITS 16 epoch + GPT 25 epoch
  模型产出: sun_speech_model.zip (320.6MB)，含 GPT 权重 + SoVITS 权重 + 参考音频
  推理显存: ~2-3 GB（推理模式比训练轻很多）
  状态: ✅ V3 训练完成，效果满意

三、语音识别输入 —— Whisper
  模型: OpenAI Whisper small/tiny
    - tiny: 39M 参数，~273 MB 内存，适合 CPU 实时推理
    - small: 244M 参数，~1 GB 内存，精度更高
  部署方式: CPU 推理（AMD 9950HX 16 核足够实时识别）
  备选: Gemma 4 E4B 自带音频理解能力，可实测对比中文 ASR 效果

四、边缘部署策略 —— 分时复用 GPU
  硬件: RTX 5070 8GB VRAM + 32GB RAM
  核心思路: 交互流程是串行的，不需要所有模型同时驻留 GPU
  运行时显存分配:
    ┌─────────────────────────────────────────────────────┐
    │ 交互流程 (串行)                                       │
    │                                                     │
    │ 1. 用户语音输入 → Whisper (CPU, 0 GPU)               │
    │ 2. 多模态理解   → Gemma 4 E4B (GPU, ~5.5-6 GB)      │
    │ 3. 语音合成     → GPT-SoVITS (GPU, ~2-3 GB)         │
    │                                                     │
    │ 任何时刻 GPU 上只有一个大模型，8GB 完全够用            │
    └─────────────────────────────────────────────────────┘
  模型管理:
    - Ollama 管理 Gemma 4 E4B，设置自动卸载超时
    - GPT-SoVITS 推理服务按需加载/释放
    - Whisper 常驻 CPU，不占 GPU
  备选方案 (若笔记本为 12GB VRAM 版本):
    - Gemma 4 E4B (~5.5GB) + GPT-SoVITS (~2-3GB) + Whisper small (~1GB) 可同时驻留
    - 无需分时复用，延迟更低

五、可选增强
  - Gemma 4 E4B 指令微调: 在超算上用中文对话数据微调，提升中文场景表现
  - Gemma 4 26B A4B (MoE): 超算推理用，激活参数仅 3.8B 但总参数 25.2B，
    256K 上下文，质量更高，可用于生成训练数据或离线批处理

================================================================================
整体产品架构（2026.04 规划）
================================================================================

四层架构，自底向上：

  ┌─────────────────────────────────────────────────────┐
  │  用户层 (User Layer)                                  │
  │  微信/企业微信/钉钉/Web UI — 用户直接交互的入口        │
  │  接收文字、语音、图片，返回文字、语音回复               │
  ├─────────────────────────────────────────────────────┤
  │  应用层 (Application Layer)                           │
  │  消息路由、会话管理、用户状态、多端适配                │
  │  协议: A2A (Agent-to-Agent Protocol)                  │
  ├─────────────────────────────────────────────────────┤
  │  Agent 层 (Agent Layer)                               │
  │  Claude Code Agent SDK / 自定义调度器                  │
  │  任务编排: 语音输入→ASR→多模态理解→TTS→语音输出       │
  │  多 Agent 协作、上下文管理、工具调用                   │
  │  协议: MCP (Model Context Protocol)                   │
  ├─────────────────────────────────────────────────────┤
  │  能力层 (Capability Layer)                            │
  │  Gemma 4 E4B — Ollama (多模态对话/图像/视频/音频)     │
  │  GPT-SoVITS — PyTorch ROCm (声音克隆 TTS)            │
  │  Whisper — PyTorch ROCm (语音识别 ASR)                │
  │  硬件: RX 9070 XT 16GB / RTX 5070 8GB                │
  └─────────────────────────────────────────────────────┘

协议说明:
  MCP (Anthropic): Agent 层 ↔ 能力层通信，把每个模型包装为 MCP Server
  A2A (Google):    Agent 层 ↔ 应用层通信，Agent 发现与任务委派
  ACP (社区):      暂不需要，适用于 5+ Agent 的复杂编排场景

IM 接入方案:
  企业微信: 官方机器人 API，最稳定，适合内部使用
  个人微信: wechaty 等开源框架，有封号风险
  钉钉/飞书: 官方机器人 API，稳定可靠
  Web UI:   FastAPI + WebSocket，自建前端

消息流转:
  用户发语音 → 应用层接收 → Agent 调度 Whisper(ASR) → Gemma 4(理解)
  → GPT-SoVITS(TTS) → 应用层返回语音 → 用户收到回复

设计原则:
  - 每层可独立替换（模型升级不影响上层）
  - 能力层全部本地运行，零数据外传
  - Agent 层通过 MCP 统一调用，不直接耦合具体模型

================================================================================
本地开发环境 (台式机)
================================================================================

硬件: AMD RX 9070 XT 16GB GDDR6 (gfx1201, RDNA 4)
系统: Windows 11

AI 环境 (已部署 2026.04.06):
  虚拟环境: ai_env\ (Python 3.11.6)
  PyTorch: 2.10.0+rocm7.13.0a20260404 (TheRock nightly, gfx120X)
  GPU 识别: ✅ AMD Radeon RX 9070 XT, 15.9 GB VRAM
  Ollama: 0.20.2, ROCm 后端, GPU 推理 233 tok/s (gemma3:1b 测试)
  Whisper: ✅ openai-whisper 已安装
  GPT-SoVITS 依赖: ✅ scipy/librosa/transformers/cn2an/pypinyin 等已安装
  HIP SDK: 7.1 (C:\Program Files\AMD\ROCm\7.1)
  环境变量:
    ROCBLAS_TENSILE_LIBPATH = C:\Program Files\AMD\ROCm\7.1\bin\rocblas\library
    TORCH_ROCM_AOTRITON_ENABLE_EXPERIMENTAL = 1
  已知问题:
    - MIOpen bug: 需设置 torch.backends.cudnn.enabled = False
    - Flash Attention: Windows ROCm 下不可用
    - ROCm 7 Windows 版仍为预览状态

  PyTorch ROCm 安装/升级命令:
    uv pip install --index-url https://rocm.nightlies.amd.com/v2-staging/gfx120X-all/ torch torchvision torchaudio

  文档: docs/rx9070xt_ai_setup.md
  验证脚本: scripts/verify_local_ai.py

开发工具:
  Claude Code: 2.1.92
  Kiro IDE: 当前使用
  Git: 2.49.0

================================================================================
超算平台连接信息
================================================================================
账户: acvcm8sr1n

区域一 (郑州·核心区一):
  登录节点: zzeshell.scnet.cn:65032
  密钥: secert/acvcm8sr1n_zzeshell.scnet.cn_RsaKeyExpireTime_2026-05-03_01-48-56.txt
  队列: hx1hdnormal, 状态: UP, 可用
  环境: ✅ 已配置 (conda env dcu_torch, Python 3.10 + PyTorch 2.5.1 DCU + DTK 25.04.4)
  资源: 16节点(8 mix + 7 alloc + 1 drain), 每节点8张BW加速卡(64GB)
  存储: /public (61PB共享存储)
  备注: 主力训练区域，GPT-SoVITS环境和预训练模型已部署
  作业状态: 148005 (speech_train) PD Priority 排队中
  ASR标注: ~/data/speech_asr_labels.list ✅ 18条 (Step 3 已完成)

区域二 (郑州·核心区二):
  登录节点: zzeshell.hpccube.com:55032
  密钥: secert/acvcm8sr1n_zzeshell.hpccube.com_RsaKeyExpireTime_2026-05-03_01-07-05.txt
  队列: hx2hdtest, 状态: DRAIN, 暂不可用
  环境: ✅ 已配置 (与区域一共享存储和环境)
  备注: 全部节点维护中 (41 drain + 11 down)

区域三 (成都·算力中心):
  登录节点: cancon.hpccube.com:65023
  密钥: secert/acvcm8sr1n_cancon.hpccube.com_RsaKeyExpireTime_2026-05-05_01-27-58.txt
  队列: kshctest (134 mix + 301 alloc), kshdtest (12 mix + 124 alloc)
  DTK: compiler/dtk/23.10 (GLIBC 2.17 兼容)
  环境: ✅ 已配置 (conda env dcu_torch, Python 3.10 + PyTorch 2.1.0a0 DTK23.10)
  存储: /public (61PB共享存储), 独立于区域一
  已安装: torch/numpy/scipy/librosa/demucs/openai-whisper/transformers/onnxruntime/cn2an/pypinyin/jieba_fast
  注意: 凡依赖torch的包必须 --no-deps 安装；whisper需 --no-build-isolation
  数据: ~/data/speech_raw/ (4个wav) ✅
  代码: ~/GPT-SoVITS-main/ ✅, ~/GPT-SoVITS-pretrained/ ✅
  Whisper缓存: 下载中 (后台 PID 23619) → ~/.cache/whisper/medium.pt
  备注: 等 whisper 下载完成后可提交训练作业

区域四 (武汉·算力中心):
  登录节点: wuzh02.hpccube.com:65091
  密钥: secert/acvcm8sr1n_wuzh02.hpccube.com_RsaKeyExpireTime_2026-05-05_01-30-18.txt
  队列: wzhdtest, 状态: UP
  DTK: 25.04.1 可用
  环境: ❌ 未配置 (GLIBC 2.17，需用 manylinux2014 版 torch)
  存储: /work (450GB), 独立存储
  资源: 17 idle + 2 mix + 19 alloc, 空闲节点多，提交即跑
  备注: 空闲资源最多，磁盘空间较小

================================================================================
环境配置详情
================================================================================

区域一 (已完成):
  PyTorch: 2.5.1+das.opt1.dtk25042 (manylinux_2_28)
  torch whl: package/torch-2.5.1+das.opt1.dtk25042-cp310-cp310-manylinux_2_28_x86_64.whl

区域三 (已完成):
  PyTorch: 2.1.0a0+git793d2b5.abi0.dtk2310 (manylinux2014, 兼容 GLIBC 2.17)
  torch whl: ~/torch-2.1.0a0-cp310-cp310-manylinux2014_x86_64.whl (已在服务器)
  已安装包: torch, numpy, scipy, soundfile, tqdm, pyyaml, cn2an, pypinyin,
            jieba_fast, onnxruntime, transformers, librosa==0.9.2, demucs==4.0.1,
            openai-whisper==20231117
  安装注意: 凡依赖 torch 的包必须用 --no-deps 安装，防止覆盖 DCU 版 torch
            whisper 需加 --no-build-isolation（setuptools 版本兼容问题）

区域四 (待配置):
  同区域三，使用 manylinux2014 版 torch whl

================================================================================
软件包资源站
================================================================================

光合开发者社区资源站 (超算内网高速，无需登录):
  主页: https://download.sourcefind.cn:65024/4/main
  API列表: GET https://download.sourcefind.cn:65024/api-static/file/ListFile?CategoryID=4&Path=<path>
  下载URL: https://download.sourcefind.cn:65024 + 响应中的 DownloadPath 字段

  关键目录:
    pytorch/                  - PyTorch DCU 版本
    pytorch/previous_release/dtk23.10/  - DTK23.10 兼容 GLIBC 2.17 的版本
    torchaudio/               - torchaudio DCU 版
    onnxruntime/              - onnxruntime DCU 版
    demucs/                   - (无，需从 PyPI 安装)

  已用包:
    torch-2.1.0a0+git793d2b5.abi0.dtk2310 (manylinux2014, 309MB)
    路径: /pytorch/previous_release/dtk23.10/
    下载命令示例:
      wget "https://download.sourcefind.cn:65024/file/4/pytorch/previous_release/dtk23.10/<filename>"

  PyPI 镜像 (已配置到 ~/.pip/pip.conf):
    index-url = https://mirrors.aliyun.com/pypi/simple/

================================================================================
训练任务进度
================================================================================

任务一: 歌曲数据训练 ✅ 完成 (V1)
  数据: 孙燕姿4首歌曲 (flac/mp3)
  产出: GPT模型 sun-e15.ckpt, SoVITS模型
  推理: output/sun/inference/sun_long_speech.wav (166秒)
  问题: 歌曲有旋律节奏，语速情感不像说话，弃用

任务二: 说话素材训练 ✅ 完成 (V3 最终版)
  迭代历程:
    V1: 4个说话视频 (3.2分钟)，效果差 (音色不像、语调机械、有杂音)
    V2: 新增 data5-10 (共10个文件，20分钟)，背景音乐/杂音多，Demucs分离不干净
    V3: 用户手动筛选切片，保留31条干净数据 (5.8分钟) ✅ 效果满意
  训练配置: SoVITS 16 epoch + GPT 25 epoch
  推理参数: temperature 0.6、不切句
  模型产出: sun_speech_model.zip (320.6MB)
    - GPT 权重 + SoVITS 权重 + 参考音频
    - 已下载到本地

任务三: 多模态基础模型部署 🔄 进行中
  模型: Gemma 4 E4B (INT4 量化)
  部署工具: Ollama + ROCm
  目标平台:
    - 台式机 RX 9070 XT 16GB ✅ Ollama GPU 推理已验证
    - 笔记本 RTX 5070 8GB (待到手)
  已完成:
    - Ollama 0.20.2 安装 + ROCm GPU 识别 ✅
    - PyTorch ROCm 2.10.0 环境部署 ✅
    - gemma3:1b GPU 推理测试通过 (233 tok/s) ✅
  进行中:
    - gemma4:e4b 模型下载中
  待办:
    - 测试 Gemma 4 E4B 多模态推理 (文本/图像/音频)
    - 可选: 在超算上用中文数据微调

任务四: 系统集成 ⏳ 待开始
  目标: 四层架构 (能力层→Agent层→应用层→用户层)
  待办:
    - 能力层: 把 Ollama/GPT-SoVITS/Whisper 包装为 MCP Server
    - Agent 层: 基于 Claude Code Agent SDK 或 FastAPI 实现调度器
    - 应用层: 消息路由、会话管理
    - 用户层: 接入企业微信/Web UI
    - 端到端延迟优化

================================================================================
本地文件结构
================================================================================

data/
  data1-4.mp4/.wav    - 说话视频/音频素材
  data5-8.mp4         - 额外说话素材
  ins/                - 中间处理文件 (分离/切片)
  upload_clean/       - 清洗后的切片 (17条)
  upload_final/       - 最终上传训练的切片 (31条)
  upload_raw/         - 原始分离音频
  孙燕姿-*.flac/.mp3  - 歌曲素材 (任务一已用)

package/
  GPT-SoVITS-main.zip                          - GPT-SoVITS 源码
  GPT-SoVITS-pretrained/                       - 预训练模型
    chinese-hubert-base/                       - HuBERT 模型
    chinese-roberta-wwm-ext-large/             - BERT 模型
    gsv-v2final-pretrained/                    - GPT-SoVITS v2 预训练权重
      s1bert25hz-5kh-longer-epoch=12-step=369668.ckpt
      s2G2333k.pth
      s2D2333k.pth
    s1bert25hz-2kh-longer-epoch=68e-step=50232.ckpt
    s2G488k.pth / s2D488k.pth
  torch-2.5.1+das.opt1.dtk25042-cp310-*.whl   - PyTorch DCU (manylinux_2_28)
  torch-2.7.1+das.opt1.dtk25042-cp310-*.whl   - PyTorch DCU 新版

output/
  sun_speech_model.zip                          - V3 最终声音克隆模型 (320.6MB)

scripts/                                        - 所有训练/推理脚本
secert/                                         - SSH 密钥文件
