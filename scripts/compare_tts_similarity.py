#!/usr/bin/env python3
"""
使用 Resemblyzer 客观比对各 TTS 模型的声纹相似度。

评估逻辑：
1. 提取所有 jyy 参考音频的 speaker embedding，构建"目标声纹空间"
2. 提取各 TTS 生成音频的 speaker embedding
3. 计算每个 TTS 输出与所有 jyy 参考音频的平均余弦相似度
4. 相似度越高，说明克隆越像原说话人
"""

import sys
import numpy as np
from pathlib import Path
from resemblyzer import VoiceEncoder, preprocess_wav

# 所有 jyy 参考音频（构建目标声纹空间）
JYY_REFS = [
    "data/jyy/sliced_final/jyy_000.wav",
    "data/jyy/sliced_final/jyy_003.wav",
    "data/jyy/sliced_final/jyy_004.wav",
    "data/jyy/sliced_final/jyy_005.wav",
]

# 各 TTS 生成音频
TTS_OUTPUTS = {
    "CosyVoice-3":   "results/showcase/tts_cosyvoice_best.wav",
    "Qwen3-TTS":     "results/showcase/tts_qwen3_best.wav",
    "GLM-TTS":       "results/showcase/tts_glm_best.wav",
    "OpenVoice":     "results/showcase/tts_openvoice_best.wav",
}

def cosine_similarity(a, b):
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))

def main():
    encoder = VoiceEncoder()

    # 提取 jyy 参考音频 embedding
    ref_embs = []
    ref_files = []
    for p in JYY_REFS:
        path = Path(p)
        if not path.exists():
            print(f"[SKIP] 参考音频不存在: {p}")
            continue
        wav = preprocess_wav(str(path))
        emb = encoder.embed_utterance(wav)
        ref_embs.append(emb)
        ref_files.append(p)
        print(f"[REF] {p} -> embedding shape {emb.shape}")

    if not ref_embs:
        print("错误: 没有可用的参考音频")
        sys.exit(1)

    # 计算 jyy 参考音频之间的平均相似度（作为同类说话人的基线）
    ref_sims = []
    for i in range(len(ref_embs)):
        for j in range(i+1, len(ref_embs)):
            ref_sims.append(cosine_similarity(ref_embs[i], ref_embs[j]))
    baseline = np.mean(ref_sims)
    print(f"\n[基线] jyy 参考音频之间的平均相似度: {baseline:.4f}")
    print("=" * 60)

    # 评估每个 TTS 输出
    results = []
    for name, p in TTS_OUTPUTS.items():
        path = Path(p)
        if not path.exists():
            print(f"[{name}] 跳过，文件不存在: {p}")
            continue
        wav = preprocess_wav(str(path))
        emb = encoder.embed_utterance(wav)
        sims = [cosine_similarity(emb, r) for r in ref_embs]
        avg_sim = np.mean(sims)
        max_sim = np.max(sims)
        min_sim = np.min(sims)
        std_sim = np.std(sims)
        results.append((name, avg_sim, max_sim, min_sim, std_sim, p))
        print(f"[{name}]")
        print(f"  与 jyy 平均相似度: {avg_sim:.4f}")
        print(f"  最高相似度:        {max_sim:.4f}")
        print(f"  最低相似度:        {min_sim:.4f}")
        print(f"  标准差:            {std_sim:.4f}")
        print(f"  文件: {p}")
        print()

    # 排序输出
    results.sort(key=lambda x: x[1], reverse=True)
    print("=" * 60)
    print("[排名] TTS 声纹相似度排名（按与 jyy 的平均余弦相似度）")
    print("=" * 60)
    for rank, (name, avg, max_s, min_s, std, p) in enumerate(results, 1):
        bar_len = int(avg * 30)
        bar = "#" * bar_len + "-" * (30 - bar_len)
        print(f"{rank}. {name:12s} | {bar} | avg={avg:.4f}  max={max_s:.4f}  std={std:.4f}")

    print("\n[说明]")
    print("   * 相似度范围 [-1, 1]，越接近 1 说明越像原说话人 jyy")
    print(f"   * jyy 不同片段之间的相似度基线为 {baseline:.4f}")
    print("   * 若 TTS 输出相似度接近或超过基线，说明克隆非常成功")
    print("   * 若远低于基线，说明克隆效果较差或使用了默认音色")

if __name__ == "__main__":
    main()
