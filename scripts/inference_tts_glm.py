#!/usr/bin/env python3
"""GLM-TTS 单句推理脚本（zero-shot 声音克隆）。

复用 models/tts/glm_tts_src 的 load_models() 与 generate_long()，把官方
批处理（jsonl）流程改造成「单句 (text, ref_audio, ref_text) -> wav」接口，
与项目内其它推理脚本签名一致。权重经 glm_tts_src/ckpt(junction -> glm-tts-full)
提供；源码大量使用相对路径，故运行时切换工作目录到源码根。

Windows 兼容性：pynini 不可用时文本正则化降级为透传；GPU 不可用时 .cuda()/.to("cuda")
降级为 no-op；torchcodec/FFmpeg 不可用时用 soundfile 加载音频。
"""
import sys, io, os, argparse, json, time, traceback
from pathlib import Path
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

parser = argparse.ArgumentParser()
parser.add_argument('--model-path', required=True, help='兼容统一签名；GLM 实际经 ckpt 映射加载')
parser.add_argument('--text', required=True)
parser.add_argument('--ref-audio', required=True)
parser.add_argument('--ref-text', required=True)
parser.add_argument('--output', required=True)
parser.add_argument('--output-json', required=True)
args = parser.parse_args()

# chdir 前先把输入/输出路径绝对化（基于后端启动时的 cwd=项目根）
ref_audio = os.path.abspath(args.ref_audio)
output = os.path.abspath(args.output)
output_json = os.path.abspath(args.output_json)

try:
    # 定位 GLM-TTS 源码根并切换工作目录（源码用相对 ckpt/examples/frontend 路径）
    glm_dir = (Path(__file__).resolve().parent.parent / 'models' / 'tts' / 'glm_tts_src').resolve()
    if not (glm_dir / 'glmtts_inference.py').exists():
        raise FileNotFoundError(f'GLM-TTS 源码未找到: {glm_dir}')
    os.chdir(str(glm_dir))
    sys.path.insert(0, str(glm_dir))

    # ---- pynini mock：Windows 无预编译包，注入 mock 短路 import 链 ----
    try:
        import pynini  # noqa: F401
    except ImportError:
        import types as _types

        class _PassNormalizer:
            def __init__(self, *a, **k):
                pass
            def normalize(self, text):
                return text

        _leaf = {
            'tn.chinese.normalizer': 'Normalizer',
            'tn.english.normalizer': 'Normalizer',
        }
        _all_mods = {
            'pynini', 'pynini.lib', 'pynini.lib.pynutil',
            'tn', 'tn.chinese', 'tn.english',
            'tn.processor',
            'tn.chinese.normalizer', 'tn.english.normalizer',
        }
        for _name in sorted(_all_mods, key=lambda x: x.count('.')):
            _mod = _types.ModuleType(_name)
            if _name in _leaf:
                setattr(_mod, _leaf[_name], _PassNormalizer)
            sys.modules[_name] = _mod

        print("DEBUG pynini 不可用，文本正则化降级为透传（passthrough）")

    import torch
    import torchaudio
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from nuwa_torch_device import resolve_torch_device

    _DEVICE = resolve_torch_device(torch)
    _GPU = _DEVICE == "cuda"

    # ---- GPU monkey-patch：GLM-TTS 源码有多处无条件 .cuda()/.to("cuda") 调用 ----
    if not _GPU:
        torch.nn.Module.cuda = lambda self, device=None: self
        if hasattr(torch.Tensor, "cuda"):
            torch.Tensor.cuda = lambda self, device=None: self

        _orig_tensor_to = torch.Tensor.to
        _orig_module_to = torch.nn.Module.to

        def _patched_tensor_to(self, *targs, **tkwargs):
            if targs and isinstance(targs[0], (str, torch.device)):
                if 'cuda' in str(targs[0]):
                    return self
            if tkwargs.get('device') is not None:
                if 'cuda' in str(tkwargs['device']):
                    tkwargs = {k: v for k, v in tkwargs.items() if k != 'device'}
                    if not targs and not tkwargs:
                        return self
            return _orig_tensor_to(self, *targs, **tkwargs)

        def _patched_module_to(self, *targs, **tkwargs):
            if targs and isinstance(targs[0], (str, torch.device)):
                if 'cuda' in str(targs[0]):
                    return self
            if tkwargs.get('device') is not None:
                if 'cuda' in str(tkwargs['device']):
                    tkwargs = {k: v for k, v in tkwargs.items() if k != 'device'}
                    if not targs and not tkwargs:
                        return self
            return _orig_module_to(self, *targs, **tkwargs)

        torch.Tensor.to = _patched_tensor_to
        torch.nn.Module.to = _patched_module_to

        # WhisperFeatureExtractor 也会被传入 device="cuda" 关键字，强制覆盖为 cpu
        import transformers.models.whisper.feature_extraction_whisper as _wfe
        _orig_wfe_call = _wfe.WhisperFeatureExtractor.__call__

        def _patched_wfe_call(self, *args, **kwargs):
            kwargs['device'] = 'cpu'
            return _orig_wfe_call(self, *args, **kwargs)

        _wfe.WhisperFeatureExtractor.__call__ = _patched_wfe_call

        print("DEBUG GPU 不可用，.cuda()/.to('cuda')/device='cuda' 已降级为 no-op (CPU only)")

    # torch.npu（华为昇腾）在当前环境不存在，mock 为不可用，GPU/CPU 均需
    if not hasattr(torch, 'npu'):
        import types as _types2
        _npu_mod = _types2.ModuleType('npu')
        _npu_mod.is_available = lambda: False
        torch.npu = _npu_mod

    import glmtts_inference as G

    # ---- torchaudio I/O patch：torchaudio 2.10+ 依赖 torchcodec/FFmpeg DLL，降级为 soundfile ----
    import soundfile as sf

    def _sf_read(path, **kw):
        """soundfile-based replacement for torchaudio.load()."""
        data, sample_rate = sf.read(path)
        data = torch.from_numpy(data).float()
        if data.ndim == 1:
            data = data.unsqueeze(0)
        else:
            data = data.T  # sf 返回 (samples, channels)，torchaudio 期望 (channels, samples)
        return data, sample_rate

    def _sf_write(path, data, sample_rate, **kw):
        """soundfile-based replacement for torchaudio.save()."""
        arr = data.detach().cpu().numpy()
        if arr.ndim > 1:
            arr = arr.T  # (channels, samples) → (samples, channels)
        sf.write(path, arr, sample_rate)

    # 全局替换，覆盖 load_wav / SpeechTokenizer.extract_speech_token / 所有内部调用
    torchaudio.load = _sf_read
    torchaudio.save = _sf_write

    # 同时修补源码中已缓存的 from-import 引用
    def _load_wav_sf(wav, target_sr):
        """soundfile-based load_wav: 单声道 + 可选重采样 → Tensor(1, samples)"""
        data, sample_rate = sf.read(wav)
        data = torch.from_numpy(data).float()
        if data.ndim == 1:
            data = data.unsqueeze(0)
        else:
            data = data.T
        data = data.mean(dim=0, keepdim=True)
        if sample_rate != target_sr:
            data = torchaudio.transforms.Resample(
                orig_freq=sample_rate, new_freq=target_sr
            )(data)
        return data

    import utils.file_utils as _ufu
    _ufu.load_wav = _load_wav_sf
    import cosyvoice.utils.file_utils as _cfu
    _cfu.load_wav = _load_wav_sf
    import cosyvoice.cli.frontend as _frontend
    _frontend.load_wav = _load_wav_sf

    SR = 24000
    print(f"DEBUG glm_dir={glm_dir} device={'cuda' if _GPU else 'cpu'}")

    t0 = time.time()
    frontend, text_frontend, speech_tokenizer, llm, flow = G.load_models(use_phoneme=False, sample_rate=SR)
    load_time = time.time() - t0
    print(f"DEBUG models loaded in {load_time:.1f}s")

    # 参考音色特征提取
    prompt_text = text_frontend.text_normalize(args.ref_text)
    synth_text = text_frontend.text_normalize(args.text)
    prompt_text_token = frontend._extract_text_token(prompt_text + " ")
    prompt_speech_token = frontend._extract_speech_token([ref_audio])
    speech_feat = frontend._extract_speech_feat(ref_audio, sample_rate=SR)
    embedding = frontend._extract_spk_embedding(ref_audio)
    cache_speech_token = [prompt_speech_token.squeeze().tolist()]
    flow_prompt_token = torch.tensor(cache_speech_token, dtype=torch.int32).to(G.DEVICE)
    cache = {
        'cache_text': [prompt_text],
        'cache_text_token': [prompt_text_token],
        'cache_speech_token': cache_speech_token,
        'use_cache': True,
    }

    t0 = time.time()
    tts_speech, _, _, _ = G.generate_long(
        frontend=frontend, text_frontend=text_frontend, llm=llm, flow=flow,
        text_info=['0', synth_text], cache=cache, embedding=embedding, seed=0,
        flow_prompt_token=flow_prompt_token, speech_feat=speech_feat,
        device=G.DEVICE, use_phoneme=False,
    )
    inference_time = time.time() - t0

    os.makedirs(os.path.dirname(output) or '.', exist_ok=True)
    wav = tts_speech.detach().cpu()
    if wav.ndim == 1:
        wav = wav.unsqueeze(0)
    torchaudio.save(output, wav, SR)
    size = os.path.getsize(output) if os.path.exists(output) else 0
    print(f"DEBUG wrote {output} size={size} sr={SR}")
    if size <= 0:
        raise RuntimeError('GLM-TTS 推理未产出音频')

    output_obj = {
        'success': True,
        'output_path': output,
        'sample_rate': SR,
        'load_time_sec': round(load_time, 2),
        'inference_time_sec': round(inference_time, 2),
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
