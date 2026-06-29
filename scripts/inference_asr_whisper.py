#!/usr/bin/env python3
"""Whisper ASR 推理脚本"""
import sys, io, argparse, json, time, traceback, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

import torch
torch.backends.cudnn.enabled = False

parser = argparse.ArgumentParser()
parser.add_argument('--model-path', required=True, help='模型目录路径（含 pytorch_model.bin）')
parser.add_argument('--audio', required=True, help='输入音频路径')
parser.add_argument('--output-json', required=True, help='输出JSON路径')
parser.add_argument('--language', default='zh', help='语言代码')
args = parser.parse_args()

try:
    import whisper
    t0 = time.time()
    # Whisper 从目录加载
    model = whisper.load_model(args.model_path, device='cuda' if torch.cuda.is_available() else 'cpu')
    load_time = time.time() - t0

    t0 = time.time()
    result = model.transcribe(args.audio, language=args.language)
    inference_time = time.time() - t0

    text = result.get('text', '')
    output = {
        'success': True,
        'text': text,
        'load_time_sec': round(load_time, 2),
        'inference_time_sec': round(inference_time, 2),
    }
except Exception as e:
    output = {
        'success': False,
        'error': str(e)[:300],
        'traceback': traceback.format_exc()[-500:],
    }

with open(args.output_json, 'w', encoding='utf-8') as f:
    json.dump(output, f, ensure_ascii=False, indent=2)

print(json.dumps(output, ensure_ascii=False))
