// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, it, expect } from 'vitest';
import { resolveVoiceRef, type Voice } from '@/lib/voice';

/**
 * Unit tests for resolveVoiceRef.
 * _Requirements: 3.3_
 */
describe('resolveVoiceRef', () => {
  const voices: Voice[] = [
    { id: 'v1', name: 'Alice', path: '/voices/alice.wav', transcript: '你好，我是爱丽丝', sample_rate: 32000 },
    { id: 'v2', name: 'Bob', path: '/voices/bob.wav', transcript: 'hello from bob' },
    { id: 'v3', name: 'Null', path: '/voices/null.wav', transcript: null },
  ];

  it('命中音色时返回该音色的 path 与 transcript', () => {
    expect(resolveVoiceRef('v1', voices)).toEqual({
      ref_audio: '/voices/alice.wav',
      ref_text: '你好，我是爱丽丝',
    });
    expect(resolveVoiceRef('v2', voices)).toEqual({
      ref_audio: '/voices/bob.wav',
      ref_text: 'hello from bob',
    });
  });

  it('transcript 为 null 时 ref_text 映射为空串', () => {
    expect(resolveVoiceRef('v3', voices)).toEqual({
      ref_audio: '/voices/null.wav',
      ref_text: '',
    });
  });

  it('未命中音色时返回空串（让后端回退默认值）', () => {
    expect(resolveVoiceRef('does-not-exist', voices)).toEqual({
      ref_audio: '',
      ref_text: '',
    });
  });

  it('voiceId 为 undefined 时返回空串', () => {
    expect(resolveVoiceRef(undefined, voices)).toEqual({
      ref_audio: '',
      ref_text: '',
    });
  });

  it('音色列表为空时返回空串', () => {
    expect(resolveVoiceRef('v1', [])).toEqual({
      ref_audio: '',
      ref_text: '',
    });
  });
});

/**
 * Task 11.1: a Reference_Voice carrying the optional `duration_seconds` field
 * must NOT affect resolveVoiceRef — resolution still relies solely on
 * `path` / `transcript`.
 * _Requirements: 5.2, 5.5_
 */
describe('resolveVoiceRef 与 duration_seconds 字段', () => {
  it('含 duration_seconds 的条目解析结果仅取决于 path/transcript', () => {
    const withDuration: Voice[] = [
      {
        id: 'v1',
        name: 'Alice',
        path: '/voices/alice.wav',
        transcript: '你好，我是爱丽丝',
        sample_rate: 32000,
        duration_seconds: 4.2,
      },
      // duration_seconds 为 null（非 WAV 未知时长）同样不影响解析。
      {
        id: 'v2',
        name: 'Bob',
        path: '/voices/bob.wav',
        transcript: null,
        sample_rate: 0,
        duration_seconds: null,
      },
    ];

    // 与不含 duration_seconds 时完全一致。
    expect(resolveVoiceRef('v1', withDuration)).toEqual({
      ref_audio: '/voices/alice.wav',
      ref_text: '你好，我是爱丽丝',
    });
    expect(resolveVoiceRef('v2', withDuration)).toEqual({
      ref_audio: '/voices/bob.wav',
      ref_text: '',
    });
  });

  it('同一条目有无 duration_seconds 的解析结果相同', () => {
    const base: Voice = {
      id: 'v1',
      name: 'Alice',
      path: '/voices/alice.wav',
      transcript: '参考文本',
      sample_rate: 24000,
    };
    const withDur: Voice = { ...base, duration_seconds: 12.5 };

    expect(resolveVoiceRef('v1', [withDur])).toEqual(resolveVoiceRef('v1', [base]));
  });
});
