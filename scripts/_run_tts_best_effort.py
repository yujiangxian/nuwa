#!/usr/bin/env python3
"""
TTS 各模型最佳效果测试
===================
为每个模型选择最优参考素材和配置，生成最佳克隆效果。

参考素材选择策略:
  CosyVoice-3   -> jyy_005.wav (4.34s, 评分0.873, 时长适中, 质量高)
  Qwen3-TTS     -> jyy_004.wav (7.02s, 评分0.874, 最长音频, x_vector利用率高)
  GLM-TTS       -> jyy_003.wav (3.12s, 评分0.891, 评分最高, 质量最好)
"""
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

import os, time, json, traceback, shutil, subprocess, librosa
from pathlib import Path
from datetime import datetime
from dataclasses import dataclass, asdict

import torch
torch.backends.cudnn.enabled = False

SYN_TEXT = '大家好，这是人工智能语音克隆的效果测试，希望你能喜欢这个声音。'
RESULTS_DIR = Path('results/showcase')
RESULTS_DIR.mkdir(parents=True, exist_ok=True)

# 各模型最优参考配置
REF_CONFIGS = {
    'CosyVoice-3': {
        'audio': 'data/jyy/sliced_final/jyy_005.wav',
        'text': '幽冥鬼火永不休止无偿与判官',
    },
    'Qwen3-TTS': {
        'audio': 'data/jyy/sliced_final/jyy_004.wav',
        'text': '唯有无常不灭别跟着我你不在阎王步上仁义是什么',
    },
    'GLM-TTS': {
        'audio': 'data/jyy/sliced_final/jyy_003.wav',
        'text': '但不太明白自夜火中重生',
    },
}

@dataclass
class R:
    model_name: str
    status: str = 'pending'
    output_path: str = ''
    load_time_sec: float = 0.0
    inference_time_sec: float = 0.0
    memory_mb: float = 0.0
    error: str = ''
    ref_audio: str = ''
    ref_text: str = ''

def gm():
    return torch.cuda.max_memory_allocated()/1024/1024 if torch.cuda.is_available() else 0

def rg():
    if torch.cuda.is_available():
        torch.cuda.reset_peak_memory_stats()
        torch.cuda.empty_cache()

results = []

# ==================== 1. CosyVoice-3 ====================
print('>>> CosyVoice-3 (最佳参考: jyy_005.wav)'); rg(); t0=time.time()
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
    mp = str(Path('models/tts_models/cosyvoice3/iic/CosyVoice-300M').resolve())
    model = CosyVoice(mp, load_jit=False, load_trt=False)
    lt = time.time()-t0; rg(); t0=time.time()
    cfg = REF_CONFIGS['CosyVoice-3']
    out = model.inference_zero_shot(SYN_TEXT, cfg['text'], cfg['audio'], stream=False)
    it = time.time()-t0
    op = RESULTS_DIR / 'tts_cosyvoice_best.wav'
    for i, o in enumerate(out):
        a = o['tts_speech'].numpy()
        if a.ndim == 2: a = a.T
        sf2.write(str(op), a, 22050)
        break
    results.append(R('CosyVoice-3','success',str(op),lt,it,gm(),'',cfg['audio'],cfg['text']))
    print(f'  OK: {op}')
    torchaudio.load = _orig
except Exception as e:
    cfg = REF_CONFIGS['CosyVoice-3']
    results.append(R('CosyVoice-3','failed','',0,0,0,str(e)[:200],cfg['audio'],cfg['text']))
    traceback.print_exc()

# ==================== 2. Qwen3-TTS-Base ====================
print('>>> Qwen3-TTS-Base (最佳参考: jyy_004.wav)'); rg(); t0=time.time()
try:
    from qwen_tts import Qwen3TTSModel
    model = Qwen3TTSModel.from_pretrained(
        'models/tts_models/qwen3-tts-base-ms',
        device_map='cuda:0', dtype=torch.float32, attn_implementation='eager'
    )
    lt = time.time()-t0; rg(); t0=time.time()
    cfg = REF_CONFIGS['Qwen3-TTS']
    wavs, sr = model.generate_voice_clone(
        text=SYN_TEXT, ref_audio=cfg['audio'], x_vector_only_mode=True,
        language='Chinese', max_new_tokens=2048
    )
    it = time.time()-t0
    op = RESULTS_DIR / 'tts_qwen3_best.wav'
    sf2.write(str(op), wavs[0], sr)
    results.append(R('Qwen3-TTS-Base','success',str(op),lt,it,gm(),'',cfg['audio'],cfg['text']))
    print(f'  OK: {op}')
except Exception as e:
    cfg = REF_CONFIGS['Qwen3-TTS']
    results.append(R('Qwen3-TTS-Base','failed','',0,0,0,str(e)[:200],cfg['audio'],cfg['text']))
    traceback.print_exc()

# ==================== 3. GLM-TTS (subprocess隔离) ====================
print('>>> GLM-TTS (最佳参考: jyy_003.wav)'); rg(); t0=time.time()
try:
    script = RESULTS_DIR / '_temp_glm_tts_best.py'
    cfg = REF_CONFIGS['GLM-TTS']
    abs_audio = str(Path(cfg['audio']).resolve()).replace('\\', '/')
    abs_syn = SYN_TEXT.replace("'", "\\'")
    abs_ref = cfg['text'].replace("'", "\\'")
    script.write_text(f"""import sys,io,os,time,json
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8')
os.environ['PYTHONIOENCODING']='utf-8'
import torch
torch.backends.cudnn.enabled=False
import soundfile as sf2
import librosa
os.chdir('external/glm-tts-src')
if 'external/glm-tts-src' not in sys.path:
    sys.path.insert(0,'external/glm-tts-src')
import torchaudio
def _pl(f,**kwargs):
    d,sr=sf2.read(f,dtype='float32')
    if d.ndim==1: d=d[None,:]
    else: d=d.T
    return torch.from_numpy(d),sr
torchaudio.load=_pl
def _ps(fp,src,sr,**kwargs):
    sf2.write(fp,src.squeeze().cpu().numpy(),sr)
torchaudio.save=_ps
class _MN:
    def __init__(self,**k): pass
    def normalize(self,t): return t
class _MM: pass
_mt=_MM(); _mt.chinese=_MM(); _mt.chinese.normalizer=_MM(); _mt.chinese.normalizer.Normalizer=_MN
_mt.english=_MM(); _mt.english.normalizer=_MM(); _mt.english.normalizer.Normalizer=_MN
sys.modules['tn']=_mt
sys.modules['tn.chinese']=_mt.chinese
sys.modules['tn.chinese.normalizer']=_mt.chinese.normalizer
sys.modules['tn.english']=_mt.english
sys.modules['tn.english.normalizer']=_mt.english.normalizer
class _MNP:
    @staticmethod
    def is_available(): return False
torch.npu=_MNP()
from glmtts_inference import load_models, generate_long
audio_ref, sr_ref = sf2.read('{abs_audio}', dtype='float32')
if audio_ref.ndim > 1:
    audio_ref = audio_ref.mean(axis=1)
if sr_ref != 24000:
    audio_ref = librosa.resample(audio_ref, orig_sr=sr_ref, target_sr=24000)
sf2.write('_temp_ref_24k.wav', audio_ref, 24000)
t0=time.time()
frontend,text_frontend,speech_tokenizer,llm,flow=load_models()
lt=time.time()-t0
prompt_text='{abs_ref}'
prompt_text_tn=text_frontend.text_normalize(prompt_text)
syn_text_tn=text_frontend.text_normalize('{abs_syn}')
pt=frontend._extract_text_token(prompt_text_tn+' ')
pst=frontend._extract_speech_token(['_temp_ref_24k.wav'])
sf_feat=frontend._extract_speech_feat('_temp_ref_24k.wav',sample_rate=24000)
emb=frontend._extract_spk_embedding('_temp_ref_24k.wav')
cst=[pst.squeeze().tolist()]
fpt=torch.tensor(cst,dtype=torch.int32).to(flow.device)
cache={{'cache_text':[prompt_text_tn],'cache_text_token':[pt],'cache_speech_token':cst,'use_cache':False}}
t0=time.time()
tts_speech,_,_,_=generate_long(
    frontend=frontend,text_frontend=text_frontend,llm=llm,flow=flow,
    text_info=['showcase',syn_text_tn],cache=cache,embedding=emb,
    seed=0,flow_prompt_token=fpt,speech_feat=sf_feat,device=flow.device
)
it=time.time()-t0
op='results/showcase/tts_glm_best.wav'
torchaudio.save(op,tts_speech,24000)
print(json.dumps({{'s':'success','op':op,'lt':lt,'it':it}},ensure_ascii=False))
os.remove('_temp_ref_24k.wav')
""", encoding='utf-8')
    env = os.environ.copy()
    env['PYTHONIOENCODING'] = 'utf-8'
    env['CUDA_VISIBLE_DEVICES'] = '0'
    env.pop('PYTHONPATH', None)
    proc = subprocess.run([sys.executable, str(script)], capture_output=True, text=True, encoding='utf-8', env=env, timeout=300)
    script.unlink(missing_ok=True)
    if proc.returncode != 0:
        results.append(R('GLM-TTS','failed','',0,0,0,proc.stderr[:300],cfg['audio'],cfg['text']))
        print(f'  FAIL: {proc.stderr[:200]}')
    else:
        ok = False
        for line in reversed(proc.stdout.strip().split('\n')):
            if line.startswith('{'):
                try:
                    d = json.loads(line)
                    results.append(R('GLM-TTS',d.get('s','failed'),d.get('op',''),d.get('lt',0),d.get('it',0),gm(),'',cfg['audio'],cfg['text']))
                    print(f"  OK: {d.get('op','')}")
                    ok = True
                    break
                except: pass
        if not ok:
            results.append(R('GLM-TTS','failed','',0,0,0,'parse error',cfg['audio'],cfg['text']))
            print('  FAIL: parse error')
except Exception as e:
    cfg = REF_CONFIGS['GLM-TTS']
    results.append(R('GLM-TTS','failed','',0,0,0,str(e)[:200],cfg['audio'],cfg['text']))
    traceback.print_exc()

# ==================== 4. OpenVoice (copy existing best result) ====================
print('>>> OpenVoice'); rg()
try:
    existing = Path('results/tts_tests/openvoice_test.wav')
    if existing.exists():
        op = RESULTS_DIR / 'tts_openvoice_best.wav'
        shutil.copy(str(existing), str(op))
        results.append(R('OpenVoice','success',str(op),0,0,0,'使用已有最佳结果','data/jyy/sliced_final/jyy_000.wav','穿上它能更好完成任务它很美'))
        print(f'  OK (已有): {op}')
    else:
        results.append(R('OpenVoice','failed','',0,0,0,'无已有结果','',''))
        print('  SKIP')
except Exception as e:
    results.append(R('OpenVoice','failed','',0,0,0,str(e)[:200],'',''))
    traceback.print_exc()

# ==================== 保存报告 ====================
rp = RESULTS_DIR / 'tts_best_effort.json'
with open(rp, 'w', encoding='utf-8') as f:
    json.dump({
        'timestamp': datetime.now().isoformat(),
        'synthesis_text': SYN_TEXT,
        'models': [asdict(x) for x in results]
    }, f, ensure_ascii=False, indent=2)

print('\n' + '='*70)
print('TTS 最佳效果测试结果')
print('='*70)
for x in results:
    icon = 'OK' if x.status == 'success' else 'FAIL'
    print(f'  [{icon}] {x.model_name:18s} | 加载 {x.load_time_sec:5.1f}s | 推理 {x.inference_time_sec:5.1f}s | 显存 {x.memory_mb:6.1f}MB')
    print(f'       参考: {x.ref_audio}')
    print(f'       文本: {x.ref_text}')
    if x.output_path:
        print(f'       输出: {x.output_path}')
print(f'\n报告已保存: {rp}')
print('='*70)
