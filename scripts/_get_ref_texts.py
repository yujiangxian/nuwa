#!/usr/bin/env python3
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

import json
from pathlib import Path
from funasr import AutoModel

m = AutoModel(
    model='models/asr_models/paraformer-large/damo/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch',
    device='cuda', disable_update=True
)

candidates = [
    'data/jyy/sliced_final/jyy_003.wav',
    'data/jyy/sliced_final/jyy_004.wav',
    'data/jyy/sliced_final/jyy_005.wav',
    'data/jyy/sliced_final/jyy_000.wav',
    'data/jyy/sliced_final/jyy_007.wav',
]

results = {}
for f in candidates:
    r = m.generate(input=f)
    text = r[0]['text'] if r else ''
    results[f] = text
    print(f'{f}: {text}')

with open('results/showcase/ref_texts.json', 'w', encoding='utf-8') as f:
    json.dump(results, f, ensure_ascii=False, indent=2)
