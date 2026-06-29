#!/usr/bin/env python3
"""最终汇总展示脚本"""
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

import json
from pathlib import Path

print("=" * 70)
print("全模型效果测试最终汇总")
print("=" * 70)
print()

# ASR
print("【ASR 语音识别】")
print("-" * 70)
asr_path = Path("results/showcase/asr_showcase_v2.json")
if asr_path.exists():
    with open(asr_path, "r", encoding="utf-8") as f:
        asr = json.load(f)
    for r in asr["models"]:
        icon = "✅" if r["status"] == "success" else "❌"
        print(f"  {icon} {r['model_name']:18s} | 加载 {r['load_time_sec']:5.1f}s | 推理 {r['inference_time_sec']:5.1f}s | 显存 {r['memory_mb']:6.1f}MB")
        if r.get("text"):
            print(f"       识别结果: {r['text']}")
        if r.get("error") and r["status"] != "success":
            print(f"       错误: {r['error'][:80]}")
else:
    print("  暂无ASR结果")

print()
print("【TTS 语音合成】")
print("-" * 70)

# 手动汇总TTS结果（因为最后一次运行GLM-TTS失败，但已有文件）
tts_models = [
    ("CosyVoice-3", "results/showcase/tts_cosyvoice.wav"),
    ("GLM-TTS", "results/showcase/tts_glm.wav"),
    ("Qwen3-TTS-Base", "results/showcase/tts_qwen3.wav"),
    ("OpenVoice", "results/showcase/tts_openvoice.wav"),
]

for name, path in tts_models:
    p = Path(path)
    if p.exists():
        size_kb = p.stat().st_size / 1024
        print(f"  ✅ {name:18s} | 输出: {p.name} | 大小: {size_kb:.1f} KB")
    else:
        print(f"  ❌ {name:18s} | 文件不存在")

# 失败的模型
print()
print("  ❌ Fish-Speech      | 缺少完整推理代码（audiotools/distributed 不兼容）")
print("  ❌ IndexTTS-2       | 缺少官方推理入口")

print()
print("=" * 70)
print("效果评估参考")
print("=" * 70)
print("""
ASR 效果对比（同一段 jyy 音频）:
  - Paraformer-large : "穿上它能更好完成任务它很美"
  - Whisper-small    : "揣手他,能更好完成任務他很美" （繁体，有错字）
  - GLM-ASR-Nano     : "穿上它能更好完成任务，它很美。"（有标点，准确）
  - Dolphin-small    : ", , , , , , , , , , , 。"（异常输出）
  - MiMo-V2.5-ASR    : "穿上它，能更好完成任务。它很美。"（有标点，准确）
  - Qwen3-ASR-0.6B   : "穿上它，能更好完成任务。它很美。"（有标点，准确）

TTS 效果对比（同一段文本 + jyy 参考音频）:
  - CosyVoice-3      : results/showcase/tts_cosyvoice.wav
  - GLM-TTS          : results/showcase/tts_glm.wav
  - Qwen3-TTS-Base   : results/showcase/tts_qwen3.wav
  - OpenVoice        : results/showcase/tts_openvoice.wav

推荐:
  - ASR 最佳: GLM-ASR-Nano / MiMo-V2.5-ASR / Qwen3-ASR-0.6B（准确+标点）
  - TTS 最佳: 需主观听感判断，建议对比 tts_cosyvoice.wav 和 tts_qwen3.wav
""")

print("=" * 70)
