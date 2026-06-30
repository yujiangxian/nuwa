#!/usr/bin/env python3
"""GLM-TTS 多段合成脚本 — 支持情绪表达与长音频拼接。

输入: JSON 段落数组，每段包含 text + 可选 emotion
      {"segments": [{"text": "...", "emotion": "happy"}, ...]}
输出: 拼接后的长 WAV + JSON 结果

情绪通过文本前缀注入 + 段间停顿 + seed偏移实现：
  happy    文本加"哈哈，"前缀，停顿短促
  sad      文本加"唉，"前缀，停顿长
  angry    文本加标点强化，停顿短
  excited  文本加"哇！"前缀，停顿中等
  calm     不加前缀，停顿中等，seed固定
  whisper  文本加"嘘..."前缀，停顿长
  neutral  无前缀，停顿标准
"""
import sys, io, os, argparse, json, time, traceback
from pathlib import Path
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

parser = argparse.ArgumentParser()
parser.add_argument('--model-path', required=True)
parser.add_argument('--segments', required=True, help='JSON: {"segments":[{"text":"...","emotion":"happy"},...]}')
parser.add_argument('--ref-audio', required=True)
parser.add_argument('--ref-text', required=True)
parser.add_argument('--output', required=True)
parser.add_argument('--output-json', required=True)
args = parser.parse_args()

ref_audio = os.path.abspath(args.ref_audio)
output = os.path.abspath(args.output)
output_json = os.path.abspath(args.output_json)

# 情绪配置
EMOTION_CONFIG = {
    'happy':   {'prefix': '', 'suffix': '', 'pause': 0.25, 'seed_offset': 42},
    'sad':     {'prefix': '', 'suffix': '', 'pause': 0.55, 'seed_offset': 7},
    'angry':   {'prefix': '', 'suffix': '', 'pause': 0.15, 'seed_offset': 99},
    'excited': {'prefix': '', 'suffix': '', 'pause': 0.30, 'seed_offset': 13},
    'surprised': {'prefix': '', 'suffix': '', 'pause': 0.35, 'seed_offset': 77},
    'calm':    {'prefix': '', 'suffix': '', 'pause': 0.45, 'seed_offset': 0},
    'whisper': {'prefix': '', 'suffix': '', 'pause': 0.60, 'seed_offset': 33},
    'neutral': {'prefix': '', 'suffix': '', 'pause': 0.35, 'seed_offset': 0},
}

try:
    segments = json.loads(args.segments)
    if isinstance(segments, dict):
        segments = segments.get('segments', [segments])
    if not segments:
        raise ValueError("segments 为空")
    print(f"DEBUG 收到 {len(segments)} 个段落")

    # ---- 初始化环境（复用 inference_tts_glm.py 的兼容层）----
    glm_dir = (Path(__file__).resolve().parent.parent / 'models' / 'tts' / 'glm_tts_src').resolve()
    if not (glm_dir / 'glmtts_inference.py').exists():
        raise FileNotFoundError(f'GLM-TTS 源码未找到: {glm_dir}')
    os.chdir(str(glm_dir))
    sys.path.insert(0, str(glm_dir))

    try:
        import pynini  # noqa: F401
    except ImportError:
        import types as _types
        class _PassNormalizer:
            def __init__(self, *a, **k): pass
            def normalize(self, text): return text
        _all_mods = {'pynini', 'pynini.lib', 'pynini.lib.pynutil',
                     'tn', 'tn.chinese', 'tn.english', 'tn.processor',
                     'tn.chinese.normalizer', 'tn.english.normalizer'}
        for _name in sorted(_all_mods, key=lambda x: x.count('.')):
            _mod = _types.ModuleType(_name)
            if _name.endswith('normalizer'):
                setattr(_mod, 'Normalizer', _PassNormalizer)
            sys.modules[_name] = _mod

    import torch
    import torchaudio

    _GPU = torch.cuda.is_available()
    if not _GPU:
        torch.nn.Module.cuda = lambda self, device=None: self
        if hasattr(torch.Tensor, "cuda"):
            torch.Tensor.cuda = lambda self, device=None: self
        _orig_tt = torch.Tensor.to
        _orig_mt = torch.nn.Module.to
        def _pt(self, *a, **kw):
            if a and isinstance(a[0], (str, torch.device)) and 'cuda' in str(a[0]): return self
            if kw.get('device') and 'cuda' in str(kw['device']):
                kw = {k: v for k, v in kw.items() if k != 'device'}
                if not a and not kw: return self
            return _orig_tt(self, *a, **kw)
        def _pm(self, *a, **kw):
            if a and isinstance(a[0], (str, torch.device)) and 'cuda' in str(a[0]): return self
            if kw.get('device') and 'cuda' in str(kw['device']):
                kw = {k: v for k, v in kw.items() if k != 'device'}
                if not a and not kw: return self
            return _orig_mt(self, *a, **kw)
        torch.Tensor.to = _pt
        torch.nn.Module.to = _pm
        import transformers.models.whisper.feature_extraction_whisper as _wfe
        _orig_wfe = _wfe.WhisperFeatureExtractor.__call__
        def _pwfe(self, *a, **kw):
            kw['device'] = 'cpu'
            return _orig_wfe(self, *a, **kw)
        _wfe.WhisperFeatureExtractor.__call__ = _pwfe

    if not hasattr(torch, 'npu'):
        import types as _t2
        _n = _t2.ModuleType('npu')
        _n.is_available = lambda: False
        torch.npu = _n

    import glmtts_inference as G
    import soundfile as sf

    def _sf_read(path, **kw):
        data, sample_rate = sf.read(path)
        data = torch.from_numpy(data).float()
        if data.ndim == 1: data = data.unsqueeze(0)
        else: data = data.T
        return data, sample_rate

    def _sf_write(path, data, sample_rate, **kw):
        arr = data.detach().cpu().numpy()
        if arr.ndim > 1: arr = arr.T
        sf.write(path, arr, sample_rate)

    torchaudio.load = _sf_read
    torchaudio.save = _sf_write

    def _load_wav_sf(wav, target_sr):
        data, sample_rate = sf.read(wav)
        data = torch.from_numpy(data).float()
        if data.ndim == 1: data = data.unsqueeze(0)
        else: data = data.T
        data = data.mean(dim=0, keepdim=True)
        if sample_rate != target_sr:
            data = torchaudio.transforms.Resample(orig_freq=sample_rate, new_freq=target_sr)(data)
        return data

    import utils.file_utils as _ufu
    _ufu.load_wav = _load_wav_sf
    import cosyvoice.utils.file_utils as _cfu
    _cfu.load_wav = _load_wav_sf
    import cosyvoice.cli.frontend as _frontend
    _frontend.load_wav = _load_wav_sf

    SR = 24000
    DEVICE = 'cuda' if _GPU else 'cpu'
    print(f"DEBUG device={DEVICE}")

    # ---- 加载模型（一次）----
    t0 = time.time()
    frontend, text_frontend, speech_tokenizer, llm, flow = G.load_models(use_phoneme=False, sample_rate=SR)
    load_time = time.time() - t0
    print(f"DEBUG models loaded in {load_time:.1f}s")

    # ---- 提取音色特征（一次）----
    prompt_text = text_frontend.text_normalize(args.ref_text)
    prompt_text_token = frontend._extract_text_token(prompt_text + " ")
    prompt_speech_token = frontend._extract_speech_token([ref_audio])
    speech_feat = frontend._extract_speech_feat(ref_audio, sample_rate=SR)
    embedding = frontend._extract_spk_embedding(ref_audio)
    cache_speech_token = [prompt_speech_token.squeeze().tolist()]
    flow_prompt_token = torch.tensor(cache_speech_token, dtype=torch.int32).to(G.DEVICE)

    # ---- 逐段生成 ----
    all_audio = []
    segment_details = []
    total_inference = 0.0

    for i, seg in enumerate(segments):
        raw_text = seg.get('text', '').strip()
        emotion = seg.get('emotion', 'neutral').lower()
        ecfg = EMOTION_CONFIG.get(emotion, EMOTION_CONFIG['neutral'])

        # 情绪前缀注入
        text = ecfg['prefix'] + raw_text + ecfg['suffix']

        # 构建该段的 cache
        cache = {
            'cache_text': [prompt_text],
            'cache_text_token': [prompt_text_token],
            'cache_speech_token': cache_speech_token,
            'use_cache': i > 0,  # 第一段后启用缓存加速
        }

        synth_text = text_frontend.text_normalize(text)
        seed = ecfg['seed_offset']

        t1 = time.time()
        tts_speech, _, _, _ = G.generate_long(
            frontend=frontend, text_frontend=text_frontend, llm=llm, flow=flow,
            text_info=[str(i), synth_text], cache=cache, embedding=embedding,
            seed=seed, flow_prompt_token=flow_prompt_token, speech_feat=speech_feat,
            device=G.DEVICE, use_phoneme=False,
        )
        seg_time = time.time() - t1
        total_inference += seg_time

        wav = tts_speech.detach().cpu()
        if wav.ndim == 2: wav = wav.squeeze(0)
        all_audio.append(wav)

        # 插入停顿（采样数）
        pause_samples = int(ecfg['pause'] * SR)
        if pause_samples > 0 and i < len(segments) - 1:
            all_audio.append(torch.zeros(pause_samples))

        segment_details.append({
            'index': i, 'text': raw_text, 'emotion': emotion,
            'inference_time_sec': round(seg_time, 2),
            'duration_sec': round(len(wav) / SR, 2),
        })
        print(f"DEBUG seg#{i} [{emotion}] text_len={len(raw_text)} dur={len(wav)/SR:.1f}s "
              f"pause={ecfg['pause']:.2f}s time={seg_time:.1f}s")

    # ---- 拼接 + 保存 ----
    full_wav = torch.cat(all_audio)
    os.makedirs(os.path.dirname(output) or '.', exist_ok=True)
    if full_wav.ndim == 1: full_wav = full_wav.unsqueeze(0)
    torchaudio.save(output, full_wav, SR)
    total_dur = len(full_wav.squeeze()) / SR
    size = os.path.getsize(output)

    print(f"DEBUG wrote {output} size={size} dur={total_dur:.1f}s total_inference={total_inference:.1f}s")

    output_obj = {
        'success': True,
        'output_path': output,
        'sample_rate': SR,
        'duration_sec': round(total_dur, 2),
        'segments': segment_details,
        'load_time_sec': round(load_time, 2),
        'inference_time_sec': round(total_inference, 2),
    }
except Exception as e:
    output_obj = {
        'success': False,
        'error': str(e)[:300],
        'traceback': traceback.format_exc()[-1200:],
    }

with open(output_json, 'w', encoding='utf-8') as f:
    json.dump(output_obj, f, ensure_ascii=False, indent=2)
print(json.dumps(output_obj, ensure_ascii=False))
