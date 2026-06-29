#!/usr/bin/env python3
"""GLM-TTS 单独测试 - 使用 jyy 参考音频"""
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

import os, time, json
from pathlib import Path

# 切换到 glm-tts-src 目录
glm_dir = str(Path('external/glm-tts-src').resolve())
if glm_dir not in sys.path:
    sys.path.insert(0, glm_dir)
os.chdir(glm_dir)

import torch
import soundfile as sf2
import librosa
import torchaudio

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

torch.backends.cudnn.enabled = False

from glmtts_inference import load_models, generate_long

# 加载jyy音频并resample到24000Hz
audio_jyy, sr_jyy = sf2.read('../../data/jyy/sliced_final/jyy_000.wav', dtype='float32')
if audio_jyy.ndim > 1:
    audio_jyy = audio_jyy.mean(axis=1)
if sr_jyy != 24000:
    audio_jyy = librosa.resample(audio_jyy, orig_sr=sr_jyy, target_sr=24000)
sf2.write('_temp_jyy_24k.wav', audio_jyy, 24000)

REF_TEXT = '穿上它能更好完成任务它很美'
SYN_TEXT = '大家好，这是人工智能语音克隆的效果测试，希望你能喜欢这个声音。'

t0 = time.time()
frontend, text_frontend, speech_tokenizer, llm, flow = load_models()
lt = time.time() - t0

prompt_text = REF_TEXT
prompt_text_tn = text_frontend.text_normalize(prompt_text)
syn_text_tn = text_frontend.text_normalize(SYN_TEXT)
pt = frontend._extract_text_token(prompt_text_tn + ' ')
pst = frontend._extract_speech_token(['_temp_jyy_24k.wav'])
sf_feat = frontend._extract_speech_feat('_temp_jyy_24k.wav', sample_rate=24000)
emb = frontend._extract_spk_embedding('_temp_jyy_24k.wav')
cst = [pst.squeeze().tolist()]
fpt = torch.tensor(cst, dtype=torch.int32).to(flow.device)
cache = {'cache_text': [prompt_text_tn], 'cache_text_token': [pt], 'cache_speech_token': cst, 'use_cache': False}

t0 = time.time()
tts_speech, _, _, _ = generate_long(
    frontend=frontend, text_frontend=text_frontend, llm=llm, flow=flow,
    text_info=['showcase', syn_text_tn], cache=cache, embedding=emb,
    seed=0, flow_prompt_token=fpt, speech_feat=sf_feat, device=flow.device
)
it = time.time() - t0

op = '../../results/showcase/tts_glm_fixed.wav'
torchaudio.save(op, tts_speech, 24000)
print(f'OK: {op}')
print(f'加载: {lt:.1f}s, 推理: {it:.1f}s')

os.remove('_temp_jyy_24k.wav')
