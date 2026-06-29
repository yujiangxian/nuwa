#!/usr/bin/env python3
"""
检查已下载的 ASR 和 TTS 模型完整性
"""

import os
from pathlib import Path

# 模型预期大小 (GB)
ASR_MODELS = {
    "qwen3-asr-0.6b": 1.8,
    "mimo-v2.5-asr": 30.0,
    "dolphin-small": 1.4,
    "paraformer-large": 0.85,
    "glm-asr-nano": 2.0,
}

TTS_MODELS = {
    "fish-audio-s2": 1.4,
    "cosyvoice3": 5.5,
    "glm-tts": 6.0,
    "openvoice": 0.43,
    "indextts2": 0.86,
    "qwen3-tts": 2.0,  # 预估
}


def get_dir_size(path):
    """计算目录大小 (GB)"""
    total = 0
    for root, dirs, files in os.walk(path):
        for f in files:
            try:
                total += os.path.getsize(os.path.join(root, f))
            except:
                pass
    return total / (1024 ** 3)


def check_models(models_dict, base_path):
    """检查模型完整性"""
    results = []
    
    for name, expected_gb in models_dict.items():
        model_path = base_path / name
        
        if not model_path.exists():
            results.append((name, 0, expected_gb, "❌ 不存在"))
            continue
        
        actual_gb = get_dir_size(model_path)
        
        # 允许 10% 误差
        if actual_gb >= expected_gb * 0.9:
            status = "✅ 完整"
        elif actual_gb > 0:
            status = "⚠️ 不完整"
        else:
            status = "❌ 空目录"
        
        results.append((name, actual_gb, expected_gb, status))
    
    return results


def main():
    print("=" * 60)
    print("模型完整性检查")
    print("=" * 60)
    
    # 检查 ASR 模型
    print("\n【ASR 模型】")
    print("-" * 60)
    asr_path = Path("models/asr_models")
    results = check_models(ASR_MODELS, asr_path)
    
    for name, actual, expected, status in results:
        print(f"{status} {name}: {actual:.2f}GB / {expected:.2f}GB")
    
    # 检查 TTS 模型
    print("\n【TTS 模型】")
    print("-" * 60)
    tts_path = Path("models/tts_models")
    results = check_models(TTS_MODELS, tts_path)
    
    for name, actual, expected, status in results:
        print(f"{status} {name}: {actual:.2f}GB / {expected:.2f}GB")
    
    # 汇总
    print("\n" + "=" * 60)
    print("汇总")
    print("=" * 60)
    
    asr_complete = sum(1 for r in check_models(ASR_MODELS, asr_path) if "✅" in r[3])
    tts_complete = sum(1 for r in check_models(TTS_MODELS, tts_path) if "✅" in r[3])
    
    print(f"ASR 模型: {asr_complete}/{len(ASR_MODELS)} 完整")
    print(f"TTS 模型: {tts_complete}/{len(TTS_MODELS)} 完整")


if __name__ == "__main__":
    main()
