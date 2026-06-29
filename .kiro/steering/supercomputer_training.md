---
inclusion: auto
---

# 超算训练规范 (区域一 郑州·核心区一)

## 环境初始化 (必须严格遵守)

每个 SBATCH 脚本必须包含以下环境设置，不得遗漏或修改：

```bash
module load compiler/dtk/25.04.4
source ~/miniconda3/etc/profile.d/conda.sh
conda activate dcu_torch

TORCH_LIB=~/miniconda3/envs/dcu_torch/lib/python3.10/site-packages/torch/lib
export LD_LIBRARY_PATH=$TORCH_LIB:$LD_LIBRARY_PATH
PYTHON=~/miniconda3/envs/dcu_torch/bin/python3
export PYTORCH_ENABLE_FLASH_ATTENTION=0
export _CUDA_VISIBLE_DEVICES=0

HOME_DIR=/public/home/acvcm8sr1n
GSV=$HOME_DIR/GPT-SoVITS-main/GPT_SoVITS
export PYTHONPATH=$GSV:$HOME_DIR/GPT-SoVITS-main:$PYTHONPATH
```

## 关键规则

- 绝对不要用 `source activate`，必须用 `source ~/miniconda3/etc/profile.d/conda.sh && conda activate`
- DTK 版本必须是 `25.04.4`，其他版本会导致符号找不到
- 必须设置 `LD_LIBRARY_PATH` 包含 torch lib 目录
- 必须设置 `PYTORCH_ENABLE_FLASH_ATTENTION=0`（DCU 不支持 Flash Attention）
- Whisper 必须用 `device='cpu'`（DCU 上 Flash Attention 不可用，GPU 模式会报错）

## GPT-SoVITS 训练流水线

特征提取必须使用 GPT-SoVITS 自带脚本，通过环境变量传参：

```bash
# 必须 export 的环境变量
export exp_name="实验名"
export inp_text=ASR标注文件路径
export inp_wav_dir=音频目录
export opt_dir=输出目录
export bert_pretrained_dir=$HOME_DIR/GPT-SoVITS-pretrained/chinese-roberta-wwm-ext-large
export bert_path=$HOME_DIR/GPT-SoVITS-pretrained/chinese-roberta-wwm-ext-large
export cnhubert_base_dir=$HOME_DIR/GPT-SoVITS-pretrained/chinese-hubert-base
export i_part=0
export all_parts=1
export is_half=False
export version=v2
export pretrained_s2G=$HOME_DIR/GPT-SoVITS-pretrained/gsv-v2final-pretrained/s2G2333k.pth

cd $GSV

# 按顺序执行
$PYTHON prepare_datasets/1-get-text.py        # BERT 文本特征
$PYTHON prepare_datasets/2-get-hubert-wav32k.py  # HuBERT 音频特征
export s2config_path=configs/s2.json
$PYTHON prepare_datasets/3-get-semantic.py    # 语义 token
```

## 训练配置

- SoVITS 和 GPT 训练配置必须动态生成 JSON/YAML 文件，不要用命令行参数
- SoVITS: `s2_train.py --config <json>`
- GPT: `s1_train.py --config_file <yaml>`
- batch_size=4 (单卡 64GB 安全值)
- fp16_run=False (DCU 兼容性)

## 新任务时的操作原则

写新训练脚本时，必须基于 `~/scripts/submit_speech_pipeline.sh` 修改，不要从头写。
只改数据路径和实验名称，环境设置和流程保持不变。
绝对不要用批量字符串替换生成新脚本——会误改预训练模型路径（如 gsv-v2final-pretrained）和 version=v2 等固定值。
必须手动逐行检查，确保以下内容不被修改：
  - version=v2（GPT-SoVITS 模型版本，不是实验版本）
  - gsv-v2final-pretrained（预训练模型目录名）
  - chinese-roberta-wwm-ext-large（BERT 模型目录名）
  - chinese-hubert-base（HuBERT 模型目录名）

## SSH 连接

```
ssh -p 65032 -i secert/acvcm8sr1n_zzeshell.scnet.cn_RsaKeyExpireTime_2026-05-03_01-48-56.txt acvcm8sr1n@zzeshell.scnet.cn
```
