import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
import json

with open('results/all_models_test_20260503_035040.json', 'r', encoding='utf-8') as f:
    d = json.load(f)

print('=' * 60)
print('历史测试结果 (2026-05-03 03:50:40)')
print('=' * 60)
print(f"GPU: {d.get('gpu', 'N/A')}")
print(f"PyTorch: {d.get('torch_version', 'N/A')}")
print()

asr = [r for r in d['models'] if r['task'] == 'ASR']
tts = [r for r in d['models'] if r['task'] == 'TTS']

print('【ASR 模型】')
for r in asr:
    icon = '✅' if r['status'] == 'success' else '❌'
    print(f"  {icon} {r['model_name']:18s} | 加载 {r['load_time_sec']:5.1f}s | 推理 {r['inference_time_sec']:5.1f}s | 显存 {r['memory_mb']:6.1f}MB")
    if r.get('text'):
        print(f"      识别结果: {r['text']}")
    if r.get('error'):
        print(f"      错误: {r['error'][:100]}")

print()
print('【TTS 模型】')
for r in tts:
    icon = '✅' if r['status'] == 'success' else '❌'
    print(f"  {icon} {r['model_name']:18s} | 加载 {r['load_time_sec']:5.1f}s | 推理 {r['inference_time_sec']:5.1f}s | 显存 {r['memory_mb']:6.1f}MB")
    if r.get('notes'):
        print(f"      备注: {r['notes']}")
    if r.get('error'):
        print(f"      错误: {r['error'][:100]}")

print()
print('【已有音频文件】')
import os
from pathlib import Path
for p in sorted(Path('results/tts_tests').glob('*.wav'), key=lambda x: x.stat().st_mtime, reverse=True):
    size_kb = p.stat().st_size / 1024
    print(f"  {p.name:35s} {size_kb:8.1f} KB")
