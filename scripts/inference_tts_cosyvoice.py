#!/usr/bin/env python3
"""CosyVoice TTS 推理脚本"""
import sys, io, os, argparse, json, time, traceback
from pathlib import Path
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

import torch
torch.backends.cudnn.enabled = False

parser = argparse.ArgumentParser()
parser.add_argument('--model-path', required=True, help='CosyVoice 模型目录')
parser.add_argument('--text', required=True, help='要合成的文本')
parser.add_argument('--ref-audio', required=True, help='参考音频路径')
parser.add_argument('--ref-text', required=True, help='参考音频对应的文本')
parser.add_argument('--output', required=True, help='输出音频路径')
parser.add_argument('--output-json', required=True, help='输出JSON路径')
args = parser.parse_args()

# 调试: 打印参数
print(f"DEBUG args.output = {args.output}")
print(f"DEBUG args.output_json = {args.output_json}")
print(f"DEBUG cwd = {os.getcwd()}")

try:
    # 注入 CosyVoice 源码路径
    cv_main = str(Path('external/indextts/IndexTTS-2-modelscope/CosyVoice-main').resolve())
    if not Path(cv_main).exists():
        # fallback: 使用 models/tts/cosyvoice_src
        cv_main = str(Path('models/tts/cosyvoice_src/CosyVoice-main').resolve())
    matcha = str(Path(cv_main) / 'third_party/Matcha-TTS')
    sys.path.insert(0, cv_main)
    sys.path.insert(0, matcha)

    import soundfile as sf
    from cosyvoice.cli.cosyvoice import CosyVoice

    t0 = time.time()
    model = CosyVoice(args.model_path, load_jit=False, load_trt=False)
    load_time = time.time() - t0

    t0 = time.time()
    out = model.inference_zero_shot(args.text, args.ref_text, args.ref_audio, stream=False)
    inference_time = time.time() - t0

    # 保存音频
    for i, o in enumerate(out):
        audio = o['tts_speech'].numpy()
        if audio.ndim == 2:
            audio = audio.T
        sf.write(args.output, audio, 22050)
        print(f"DEBUG: wrote audio to {args.output}, exists={os.path.exists(args.output)}, size={os.path.getsize(args.output) if os.path.exists(args.output) else 0}")
        break

    output = {
        'success': True,
        'output_path': args.output,
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
