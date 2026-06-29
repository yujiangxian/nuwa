#!/usr/bin/env python3
"""评估 jyy 所有切片，筛选最佳参考音频候选"""
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

import os
import numpy as np
import soundfile as sf
from pathlib import Path

DATA_DIR = Path('data/jyy/sliced_final')
results = []

print("评估 jyy 参考音频候选...")
print("=" * 70)

for wav_file in sorted(DATA_DIR.glob('*.wav')):
    try:
        data, sr = sf.read(str(wav_file), dtype='float32')
        
        # 如果是立体声，取平均值转为单声道
        if data.ndim > 1:
            data = data.mean(axis=1)
        
        duration = len(data) / sr
        rms = np.sqrt(np.mean(data**2))
        peak = np.max(np.abs(data))
        
        # 静音比例 (< 0.01 视为静音)
        silent_ratio = np.sum(np.abs(data) < 0.01) / len(data)
        
        # 有效语音比例 (RMS > 0.02 的片段)
        # 使用滑动窗口计算局部 RMS
        window_size = int(sr * 0.1)  # 100ms 窗口
        local_rms = []
        for i in range(0, len(data) - window_size, window_size):
            local_rms.append(np.sqrt(np.mean(data[i:i+window_size]**2)))
        local_rms = np.array(local_rms)
        speech_ratio = np.sum(local_rms > 0.02) / len(local_rms)
        
        # 综合评分
        # 时长 3-8 秒为佳
        duration_score = 1.0 if 3 <= duration <= 8 else 0.5 if 2 <= duration <= 10 else 0.2
        # RMS 适中为佳 (0.05-0.3)
        rms_score = 1.0 if 0.05 <= rms <= 0.3 else 0.5 if 0.02 <= rms <= 0.5 else 0.2
        # 静音比例越低越好
        silent_score = 1.0 - silent_ratio
        # 语音比例越高越好
        speech_score = speech_ratio
        # 峰值不过载
        peak_score = 1.0 if peak < 0.95 else 0.5 if peak < 1.0 else 0.0
        
        overall_score = (duration_score * 0.3 + rms_score * 0.25 + 
                        silent_score * 0.15 + speech_score * 0.2 + peak_score * 0.1)
        
        results.append({
            'file': wav_file.name,
            'duration': duration,
            'sr': sr,
            'rms': rms,
            'peak': peak,
            'silent_ratio': silent_ratio,
            'speech_ratio': speech_ratio,
            'score': overall_score
        })
    except Exception as e:
        print(f"  跳过 {wav_file.name}: {e}")

# 按评分排序
results.sort(key=lambda x: x['score'], reverse=True)

print(f"\n{'排名':<4} {'文件名':<18} {'时长(s)':<10} {'RMS':<10} {'峰值':<8} {'静音%':<8} {'语音%':<8} {'评分':<8}")
print("-" * 70)
for i, r in enumerate(results[:10]):
    print(f"{i+1:<4} {r['file']:<18} {r['duration']:<10.2f} {r['rms']:<10.4f} {r['peak']:<8.4f} {r['silent_ratio']*100:<8.1f} {r['speech_ratio']*100:<8.1f} {r['score']:<8.3f}")

# 保存前5名
print("\n" + "=" * 70)
print("推荐候选（前5名）:")
top5 = results[:5]
for r in top5:
    print(f"  {r['file']} | 时长 {r['duration']:.2f}s | 评分 {r['score']:.3f}")

# 保存结果
import json
with open('results/showcase/jyy_ref_candidates.json', 'w', encoding='utf-8') as f:
    json.dump(results, f, ensure_ascii=False, indent=2)
print("\n完整评估结果: results/showcase/jyy_ref_candidates.json")
