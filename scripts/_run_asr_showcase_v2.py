#!/usr/bin/env python3
"""ASR 全模型效果测试 v2 (修复 GLM-ASR 隔离 + MiMo GenerationMixin)"""
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

import os, time, json, traceback, subprocess, librosa, soundfile as sf
from pathlib import Path
from datetime import datetime
from dataclasses import dataclass, asdict

import torch
torch.backends.cudnn.enabled = False

TEST_AUDIO = 'data/jyy/sliced_final/jyy_000.wav'
RESULTS_DIR = Path('results/showcase')
RESULTS_DIR.mkdir(parents=True, exist_ok=True)
TRANSFORMERS_50_PATH = 'F:/mystudy/model-test/transformers_50'

@dataclass
class R:
    model_name: str
    task: str
    status: str = 'pending'
    text: str = ''
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

# 1. Paraformer
print('>>> Paraformer-large'); rg(); t0=time.time()
try:
    from funasr import AutoModel
    m = AutoModel(model='models/asr_models/paraformer-large/damo/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch', device='cuda', disable_update=True)
    lt = time.time()-t0; rg(); t0=time.time()
    res = m.generate(input=TEST_AUDIO)
    it = time.time()-t0
    text = res[0]['text'] if res else ''
    results.append(R('Paraformer-large','ASR','success',text,lt,it,gm()))
    print(f'  OK: {text}')
except Exception as e:
    results.append(R('Paraformer-large','ASR','failed','',0,0,0,str(e)[:200]))
    traceback.print_exc()

# 2. Whisper
print('>>> Whisper-small'); rg(); t0=time.time()
try:
    import whisper
    m = whisper.load_model('small', device='cuda')
    lt = time.time()-t0; rg(); t0=time.time()
    res = m.transcribe(TEST_AUDIO, language='zh')
    it = time.time()-t0
    text = res['text']
    results.append(R('Whisper-small','ASR','success',text,lt,it,gm()))
    print(f'  OK: {text}')
except Exception as e:
    results.append(R('Whisper-small','ASR','failed','',0,0,0,str(e)[:200]))
    traceback.print_exc()

# 3. GLM-ASR (subprocess isolation for transformers 5.0)
print('>>> GLM-ASR-Nano (subprocess隔离)'); rg()
try:
    script = RESULTS_DIR / '_temp_glm_asr_showcase.py'
    script.write_text(f"""import sys,io,os,time,json
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8')
os.environ['PYTHONIOENCODING']='utf-8'
import torch
torch.backends.cudnn.enabled=False
import sys
sys.path.insert(0,'{TRANSFORMERS_50_PATH}')
from transformers import GlmAsrForConditionalGeneration, AutoProcessor
import soundfile as sf
import librosa
mp='models/asr_models/glm-asr-nano'
proc=AutoProcessor.from_pretrained(mp,trust_remote_code=True)
t0=time.time()
m=GlmAsrForConditionalGeneration.from_pretrained(mp,trust_remote_code=True,dtype=torch.bfloat16,device_map='auto')
lt=time.time()-t0
audio,sr=sf.read('{TEST_AUDIO}')
if len(audio.shape)>1: audio=audio[:,0]
if sr!=16000: audio=librosa.resample(audio,orig_sr=sr,target_sr=16000)
t0=time.time()
inputs=proc.apply_transcription_request(audio,prompt='请转录这段音频为文本')
inputs=inputs.to(m.device,dtype=m.dtype)
with torch.no_grad():
    outs=m.generate(**inputs,do_sample=False,max_new_tokens=500)
decoded=proc.batch_decode(outs[:,inputs['input_ids'].shape[1]:],skip_special_tokens=True)
it=time.time()-t0
t=decoded[0] if decoded else ''
print(json.dumps({{'s':'success','t':t,'lt':lt,'it':it}},ensure_ascii=False))
""", encoding='utf-8')
    env = os.environ.copy()
    env['PYTHONIOENCODING'] = 'utf-8'
    env['CUDA_VISIBLE_DEVICES'] = '0'
    env.pop('PYTHONPATH', None)
    proc = subprocess.run([sys.executable, str(script)], capture_output=True, text=True, encoding='utf-8', env=env, timeout=300)
    script.unlink(missing_ok=True)
    if proc.returncode != 0:
        results.append(R('GLM-ASR-Nano','ASR','failed','',0,0,0,proc.stderr[:300]))
        print(f'  FAIL: {proc.stderr[:200]}')
    else:
        ok = False
        for line in reversed(proc.stdout.strip().split('\n')):
            if line.startswith('{'):
                try:
                    d = json.loads(line)
                    results.append(R('GLM-ASR-Nano','ASR',d.get('s','failed'),d.get('t',''),d.get('lt',0),d.get('it',0),gm()))
                    print(f"  OK: {d.get('t','')}")
                    ok = True
                    break
                except: pass
        if not ok:
            results.append(R('GLM-ASR-Nano','ASR','failed','',0,0,0,'parse error'))
            print('  FAIL: parse error')
except Exception as e:
    results.append(R('GLM-ASR-Nano','ASR','failed','',0,0,0,str(e)[:200]))
    traceback.print_exc()

# 4. Dolphin
print('>>> Dolphin-small'); rg(); t0=time.time()
try:
    import yaml, tempfile
    with open('models/asr_models/dolphin-small/config.yaml','rb') as f:
        cfg = yaml.safe_load(f.read().decode('utf-8', errors='ignore'))
    cfg['bpemodel'] = os.path.abspath('models/asr_models/dolphin-small/bpe.model')
    cfg['normalize_conf']['stats_file'] = os.path.abspath('models/asr_models/dolphin-small/feats_stats.npz')
    if 'model_conf' in cfg and 'sym_na' in cfg['model_conf']: del cfg['model_conf']['sym_na']
    td = tempfile.mkdtemp(); ncp = os.path.join(td, 'config.yaml')
    with open(ncp, 'w', encoding='utf-8') as f: yaml.dump(cfg, f, allow_unicode=True)
    mp = os.path.abspath('models/asr_models/dolphin-small/small.pt')
    from espnet2.bin.asr_inference import Speech2Text
    m = Speech2Text(asr_train_config=ncp, asr_model_file=mp, device='cuda', dtype='float32')
    lt = time.time()-t0; rg(); t0=time.time()
    audio, sr = sf.read(TEST_AUDIO, dtype='float32')
    if len(audio.shape) > 1: audio = audio[:, 0]
    if sr != 16000: audio = librosa.resample(audio, orig_sr=sr, target_sr=16000)
    res = m(audio)
    it = time.time()-t0
    text = res[0][0] if res else ''
    results.append(R('Dolphin-small','ASR','success',text,lt,it,gm()))
    print(f'  OK: {text}')
except Exception as e:
    results.append(R('Dolphin-small','ASR','failed','',0,0,0,str(e)[:200]))
    traceback.print_exc()

# 5. MiMo
print('>>> MiMo-V2.5-ASR'); rg(); t0=time.time()
try:
    import torchaudio
    def _pl(path, **kwargs):
        d, sr = sf.read(path, dtype='float32')
        if d.ndim == 1: d = d[None, :]
        else: d = d.T
        return torch.from_numpy(d), sr
    torchaudio.load = _pl
    sys.path.insert(0, 'external/mimo-src/MiMo-V2.5-ASR')
    from src.mimo_audio.mimo_audio import MimoAudio
    m = MimoAudio(
        model_path='models/asr_models/mimo-v2.5-asr/XiaomiMiMo/MiMo-V2___5-ASR',
        mimo_audio_tokenizer_path='models/asr_models/mimo-audio-tokenizer-ms/XiaomiMiMo/MiMo-Audio-Tokenizer'
    )
    lt = time.time()-t0; rg(); t0=time.time()
    res = m.asr_sft(TEST_AUDIO)
    it = time.time()-t0
    text = str(res) if res else ''
    results.append(R('MiMo-V2.5-ASR','ASR','success',text,lt,it,gm()))
    print(f'  OK: {text}')
except Exception as e:
    results.append(R('MiMo-V2.5-ASR','ASR','failed','',0,0,0,str(e)[:200]))
    traceback.print_exc()

# 6. Qwen3-ASR (subprocess)
print('>>> Qwen3-ASR-0.6B'); rg()
try:
    temp_python = Path('temp_qwen_env/Scripts/python.exe').resolve()
    if not temp_python.exists():
        results.append(R('Qwen3-ASR-0.6B','ASR','failed','',0,0,0,'temp_qwen_env not found'))
        print('  FAIL: temp_qwen_env not found')
    else:
        script = RESULTS_DIR / '_temp_qwen3_asr_showcase.py'
        script.write_text(f"""import sys,io,os,time,json
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8')
os.environ['PYTHONIOENCODING']='utf-8'
import torch
torch.backends.cudnn.enabled=False
from qwen_asr import Qwen3ASRModel
mp='models/asr_models/qwen3-asr-0.6b/Qwen/Qwen3-ASR-0___6B'
d='cuda:0' if torch.cuda.is_available() else 'cpu'
t0=time.time()
m=Qwen3ASRModel.from_pretrained(mp,dtype=torch.bfloat16,device_map=d,max_inference_batch_size=8,max_new_tokens=256)
lt=time.time()-t0
t0=time.time()
res=m.transcribe(audio='{TEST_AUDIO}',language=None)
it=time.time()-t0
t=res[0].text if res else ''
print(json.dumps({{'s':'success','t':t,'lt':lt,'it':it}},ensure_ascii=False))
""", encoding='utf-8')
        env = os.environ.copy()
        env['PYTHONIOENCODING'] = 'utf-8'
        env['CUDA_VISIBLE_DEVICES'] = '0'
        env.pop('PYTHONPATH', None)
        proc = subprocess.run([str(temp_python), str(script)], capture_output=True, text=True, encoding='utf-8', env=env, timeout=300)
        script.unlink(missing_ok=True)
        if proc.returncode != 0:
            results.append(R('Qwen3-ASR-0.6B','ASR','failed','',0,0,0,proc.stderr[:300]))
            print(f'  FAIL: {proc.stderr[:200]}')
        else:
            ok = False
            for line in reversed(proc.stdout.strip().split('\n')):
                if line.startswith('{'):
                    try:
                        d = json.loads(line)
                        results.append(R('Qwen3-ASR-0.6B','ASR',d.get('s','failed'),d.get('t',''),d.get('lt',0),d.get('it',0),gm()))
                        print(f"  OK: {d.get('t','')}")
                        ok = True
                        break
                    except: pass
            if not ok:
                results.append(R('Qwen3-ASR-0.6B','ASR','failed','',0,0,0,'parse error'))
                print('  FAIL: parse error')
except Exception as e:
    results.append(R('Qwen3-ASR-0.6B','ASR','failed','',0,0,0,str(e)[:200]))
    traceback.print_exc()

# save
rp = RESULTS_DIR / 'asr_showcase_v2.json'
with open(rp, 'w', encoding='utf-8') as f:
    json.dump({'timestamp': datetime.now().isoformat(), 'models': [asdict(x) for x in results]}, f, ensure_ascii=False, indent=2)

print('\n' + '='*60)
print('ASR 测试结果汇总 v2')
print('='*60)
for x in results:
    icon = 'OK' if x.status == 'success' else 'FAIL'
    print(f'  [{icon}] {x.model_name:18s} | 加载 {x.load_time_sec:5.1f}s | 推理 {x.inference_time_sec:5.1f}s | 显存 {x.memory_mb:6.1f}MB')
    if x.text:
        print(f'       识别: {x.text}')
print(f'\n报告已保存: {rp}')
