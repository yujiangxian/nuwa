#!/usr/bin/env python3
"""GPT-SoVITS v2 TTS 推理脚本"""
import sys, io, argparse, json, time, traceback
from pathlib import Path
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

import torch
from nuwa_torch_device import resolve_torch_device
_DEVICE = resolve_torch_device(torch)

parser = argparse.ArgumentParser()
parser.add_argument('--sovits-path', required=True, help='SoVITS 权重路径 (.pth)')
parser.add_argument('--gpt-path', required=True, help='GPT 权重路径 (.ckpt)')
parser.add_argument('--text', required=True, help='要合成的文本')
parser.add_argument('--ref-audio', required=True, help='参考音频路径')
parser.add_argument('--ref-text', required=True, help='参考音频对应的文本')
parser.add_argument('--output', required=True, help='输出音频路径')
parser.add_argument('--output-json', required=True, help='输出JSON路径')
args = parser.parse_args()

try:
    # 注入 GPT-SoVITS 路径
    gsv = str(Path('GPT-SoVITS-main').resolve())
    sys.path.insert(0, gsv)
    sys.path.insert(0, str(Path(gsv) / 'GPT_SoVITS'))

    from GPT_SoVITS.TTS_infer_pack.TTS import TTS, TTS_Config

    t0 = time.time()
    tts_config = TTS_Config({
        'sovits_path': args.sovits_path,
        'gpt_path': args.gpt_path,
        'device': _DEVICE,
        'is_half': False,
    })
    tts_pipeline = TTS(tts_config)
    load_time = time.time() - t0

    t0 = time.time()
    result = tts_pipeline.run({
        'text': args.text,
        'text_lang': 'zh',
        'ref_audio_path': args.ref_audio,
        'prompt_text': args.ref_text,
        'prompt_lang': 'zh',
        'top_k': 5,
        'top_p': 1.0,
        'temperature': 1.0,
    })
    inference_time = time.time() - t0

    # 保存音频
    import soundfile as sf
    sf.write(args.output, result['audio'], result['sr'])

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
