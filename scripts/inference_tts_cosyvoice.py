#!/usr/bin/env python3
"""CosyVoice TTS 推理脚本（兼容 CosyVoice / CosyVoice2 / CosyVoice3）。

按 model_dir 下存在的 yaml 自动选择模型类：
  cosyvoice3.yaml -> CosyVoice3
  cosyvoice2.yaml -> CosyVoice2（CosyVoice2-0.5B，效果第一梯队）
  cosyvoice.yaml  -> CosyVoice（300M base，向后兼容）

采样率取 model.sample_rate（CosyVoice2=24000、300M=22050），不再硬编码，
避免升级到 CosyVoice2 后因采样率不符导致变调/变速。
torch.cuda.is_available() 为真时 CosyVoice 内部自动使用 GPU。
"""
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

try:
    # 注入 CosyVoice 源码路径
    cv_main = str(Path('external/indextts/IndexTTS-2-modelscope/CosyVoice-main').resolve())
    if not Path(cv_main).exists():
        cv_main = str(Path('models/tts/cosyvoice_src/CosyVoice-main').resolve())
    matcha = str(Path(cv_main) / 'third_party/Matcha-TTS')
    sys.path.insert(0, cv_main)
    sys.path.insert(0, matcha)

    import soundfile as sf
    from cosyvoice.cli.cosyvoice import CosyVoice, CosyVoice2, CosyVoice3

    mp = Path(args.model_path)
    use_gpu = torch.cuda.is_available()
    # 按存在的配置文件选择模型类（fp16 仅在 GPU 上启用以提速）
    if (mp / 'cosyvoice3.yaml').exists():
        Klass, kind = CosyVoice3, 'CosyVoice3'
    elif (mp / 'cosyvoice2.yaml').exists():
        Klass, kind = CosyVoice2, 'CosyVoice2'
    else:
        Klass, kind = CosyVoice, 'CosyVoice'
    print(f"DEBUG model_class={kind} gpu={use_gpu} dir={args.model_path}")

    t0 = time.time()
    model = Klass(args.model_path, load_jit=False, load_trt=False, fp16=use_gpu)
    load_time = time.time() - t0

    sr = getattr(model, 'sample_rate', 22050)
    print(f"DEBUG sample_rate={sr}")

    t0 = time.time()
    out = model.inference_zero_shot(args.text, args.ref_text, args.ref_audio, stream=False)
    inference_time = time.time() - t0

    wrote = False
    for o in out:
        audio = o['tts_speech'].numpy()
        if audio.ndim == 2:
            audio = audio.T
        sf.write(args.output, audio, sr)
        wrote = True
        print(f"DEBUG wrote {args.output} exists={os.path.exists(args.output)} "
              f"size={os.path.getsize(args.output) if os.path.exists(args.output) else 0} sr={sr}")
        break

    if not wrote:
        raise RuntimeError('CosyVoice 推理未产出音频片段')

    output = {
        'success': True,
        'output_path': args.output,
        'model_class': kind,
        'sample_rate': sr,
        'load_time_sec': round(load_time, 2),
        'inference_time_sec': round(inference_time, 2),
    }
except Exception as e:
    output = {
        'success': False,
        'error': str(e)[:300],
        'traceback': traceback.format_exc()[-800:],
    }

with open(args.output_json, 'w', encoding='utf-8') as f:
    json.dump(output, f, ensure_ascii=False, indent=2)

print(json.dumps(output, ensure_ascii=False))
