#!/usr/bin/env python3
"""TTS 全模型效果测试 v3"""
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

import os, time, json, traceback, warnings, shutil
from pathlib import Path
from datetime import datetime
from dataclasses import dataclass, asdict

import torch
torch.backends.cudnn.enabled = False

TEST_AUDIO = 'data/jyy/sliced_final/jyy_000.wav'
SYN_TEXT = '大家好，这是人工智能语音克隆的效果测试，希望你能喜欢这个声音。'
REF_TEXT = '大家好，这是人工智能语音克隆的效果测试，希望你能喜欢这个声音。'
RESULTS_DIR = Path('results/showcase')
RESULTS_DIR.mkdir(parents=True, exist_ok=True)

@dataclass
class R:
    model_name: str
    task: str
    status: str = 'pending'
    output_path: str = ''
    load_time_sec: float = 0.0
    inference_time_sec: float = 0.0
    memory_mb: float = 0.0
    error: str = ''

def gm():
    return torch.cuda.max_memory_allocated()/1024/1024 if torch.cuda.is_available() else 0

def rg():
    if torch.cuda.is_available():
        torch.cuda.reset_peak_memory_stats()
        torch.cuda.empty_cache()

results = []

# 1. CosyVoice 3
print('>>> CosyVoice-3'); rg(); t0=time.time()
try:
    cv_main = str(Path('models/tts_models/cosyvoice_src/CosyVoice-main').resolve())
    matcha = str(Path('models/tts_models/cosyvoice_src/CosyVoice-main/third_party/Matcha-TTS').resolve())
    sys.path.insert(0, cv_main)
    sys.path.insert(0, matcha)
    import torchaudio, soundfile as sf2
    _orig = torchaudio.load
    def _p(f, **kwargs):
        d, sr = sf2.read(f, dtype='float32')
        d = d.mean(axis=1) if d.ndim > 1 else d
        return d.unsqueeze(0) if hasattr(d, 'unsqueeze') else torch.from_numpy(d).unsqueeze(0), sr
    torchaudio.load = _p
    from cosyvoice.cli.cosyvoice import CosyVoice
    from cosyvoice.utils.file_utils import load_wav
    mp = str(Path('models/tts_models/cosyvoice3/iic/CosyVoice-300M').resolve())
    model = CosyVoice(mp, load_jit=False, load_trt=False)
    lt = time.time()-t0; rg(); t0=time.time()
    prompt = load_wav(TEST_AUDIO, 16000)
    out = model.inference_zero_shot(SYN_TEXT, REF_TEXT, prompt, stream=False)
    it = time.time()-t0
    op = RESULTS_DIR / 'tts_cosyvoice.wav'
    for i, o in enumerate(out):
        a = o['tts_speech'].numpy()
        if a.ndim == 2: a = a.T
        sf2.write(str(op), a, 22050)
        break
    results.append(R('CosyVoice-3','TTS','success',str(op),lt,it,gm()))
    print(f'  OK: {op}')
    torchaudio.load = _orig
except Exception as e:
    results.append(R('CosyVoice-3','TTS','failed','',0,0,0,str(e)[:200]))
    traceback.print_exc()

# 2. GLM-TTS
print('>>> GLM-TTS'); rg(); t0=time.time()
try:
    # Remove CosyVoice paths to avoid import conflict
    cv_paths = [str(Path('models/tts_models/cosyvoice_src/CosyVoice-main').resolve()),
                str(Path('models/tts_models/cosyvoice_src/CosyVoice-main/third_party/Matcha-TTS').resolve())]
    for p in cv_paths:
        while p in sys.path:
            sys.path.remove(p)
    glm_dir = str(Path('external/glm-tts-src').resolve())
    if glm_dir not in sys.path:
        sys.path.insert(0, glm_dir)
    os.chdir(glm_dir)
    import torchaudio, soundfile as sf2
    def _pl(f, **kwargs):
        d, sr = sf2.read(f, dtype='float32')
        if d.ndim == 1: d = d[None, :]
        else: d = d.T
        return torch.from_numpy(d), sr
    torchaudio.load = _pl
    def _ps(fp, src, sr, **kwargs):
        sf2.write(fp, src.squeeze().cpu().numpy(), sr)
    torchaudio.save = _ps
    class _MN:
        def __init__(self, **k): pass
        def normalize(self, t): return t
    class _MM: pass
    _mt = _MM(); _mt.chinese = _MM(); _mt.chinese.normalizer = _MM(); _mt.chinese.normalizer.Normalizer = _MN
    _mt.english = _MM(); _mt.english.normalizer = _MM(); _mt.english.normalizer.Normalizer = _MN
    for k in ['tn','tn.chinese','tn.chinese.normalizer','tn.english','tn.english.normalizer']:
        sys.modules.setdefault(k, _mt)
    class _MNP:
        @staticmethod
        def is_available(): return False
    torch.npu = _MNP()
    from glmtts_inference import load_models, generate_long
    frontend, text_frontend, speech_tokenizer, llm, flow = load_models()
    lt = time.time()-t0; rg(); t0=time.time()
    prompt_text = '他当时还跟线下其他的站姐吵架，然后，打架进局子了。'
    prompt_text_tn = text_frontend.text_normalize(prompt_text)
    syn_text_tn = text_frontend.text_normalize(SYN_TEXT)
    pt = frontend._extract_text_token(prompt_text_tn + ' ')
    pst = frontend._extract_speech_token(['examples/prompt/jiayan_zh.wav'])
    sf_feat = frontend._extract_speech_feat('examples/prompt/jiayan_zh.wav', sample_rate=24000)
    emb = frontend._extract_spk_embedding('examples/prompt/jiayan_zh.wav')
    cst = [pst.squeeze().tolist()]
    fpt = torch.tensor(cst, dtype=torch.int32).to(flow.device)
    cache = {'cache_text': [prompt_text_tn], 'cache_text_token': [pt], 'cache_speech_token': cst, 'use_cache': False}
    tts_speech, _, _, _ = generate_long(
        frontend=frontend, text_frontend=text_frontend, llm=llm, flow=flow,
        text_info=['showcase', syn_text_tn], cache=cache, embedding=emb,
        seed=0, flow_prompt_token=fpt, speech_feat=sf_feat, device=flow.device
    )
    it = time.time()-t0
    op = RESULTS_DIR / 'tts_glm.wav'
    torchaudio.save(str(op), tts_speech, 24000)
    results.append(R('GLM-TTS','TTS','success',str(op),lt,it,gm()))
    print(f'  OK: {op}')
except Exception as e:
    results.append(R('GLM-TTS','TTS','failed','',0,0,0,str(e)[:200]))
    traceback.print_exc()
finally:
    os.chdir(str(Path(__file__).resolve().parent.parent))

# 3. Qwen3-TTS-Base
print('>>> Qwen3-TTS-Base'); rg(); t0=time.time()
try:
    from qwen_tts import Qwen3TTSModel
    model = Qwen3TTSModel.from_pretrained(
        'models/tts_models/qwen3-tts-base-ms',
        device_map='cuda:0', dtype=torch.float32, attn_implementation='eager'
    )
    lt = time.time()-t0; rg(); t0=time.time()
    wavs, sr = model.generate_voice_clone(
        text=SYN_TEXT, ref_audio=TEST_AUDIO, x_vector_only_mode=True,
        language='Chinese', max_new_tokens=2048
    )
    it = time.time()-t0
    op = RESULTS_DIR / 'tts_qwen3.wav'
    sf2.write(str(op), wavs[0], sr)
    results.append(R('Qwen3-TTS-Base','TTS','success',str(op),lt,it,gm()))
    print(f'  OK: {op}')
except Exception as e:
    results.append(R('Qwen3-TTS-Base','TTS','failed','',0,0,0,str(e)[:200]))
    traceback.print_exc()

# 4. OpenVoice (copy existing)
print('>>> OpenVoice'); rg()
try:
    existing = Path('results/tts_tests/openvoice_test.wav')
    if existing.exists():
        op = RESULTS_DIR / 'tts_openvoice.wav'
        shutil.copy(str(existing), str(op))
        results.append(R('OpenVoice','TTS','success',str(op),0,0,0,'使用已有测试结果'))
        print(f'  OK (已有): {op}')
    else:
        results.append(R('OpenVoice','TTS','failed','',0,0,0,'缺少已有测试结果'))
        print('  SKIP: 无已有结果')
except Exception as e:
    results.append(R('OpenVoice','TTS','failed','',0,0,0,str(e)[:200]))
    traceback.print_exc()

# 5. Fish Speech
print('>>> Fish-Speech'); rg()
try:
    import fish_speech
    results.append(R('Fish-Speech','TTS','failed','',0,0,0,'缺少完整推理代码'))
    print('  SKIP: 缺少完整推理代码')
except Exception as e:
    results.append(R('Fish-Speech','TTS','failed','',0,0,0,str(e)[:200]))
    print('  SKIP: 导入失败')

# 6. IndexTTS-2
print('>>> IndexTTS-2'); rg()
try:
    results.append(R('IndexTTS-2','TTS','failed','',0,0,0,'缺少官方推理入口'))
    print('  SKIP: 缺少推理源码')
except Exception as e:
    results.append(R('IndexTTS-2','TTS','failed','',0,0,0,str(e)[:200]))

# save
rp = RESULTS_DIR / 'tts_showcase_v3.json'
with open(rp, 'w', encoding='utf-8') as f:
    json.dump({'timestamp': datetime.now().isoformat(), 'models': [asdict(x) for x in results]}, f, ensure_ascii=False, indent=2)

print('\n' + '='*60)
print('TTS 测试结果汇总 v3')
print('='*60)
for x in results:
    icon = 'OK' if x.status == 'success' else 'FAIL'
    print(f'  [{icon}] {x.model_name:18s} | 加载 {x.load_time_sec:5.1f}s | 推理 {x.inference_time_sec:5.1f}s | 显存 {x.memory_mb:6.1f}MB')
    if x.output_path:
        print(f'       输出: {x.output_path}')
print(f'\n报告已保存: {rp}')
