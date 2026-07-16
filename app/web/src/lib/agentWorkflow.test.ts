// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, it, expect } from 'vitest';
import {
  makeSteps,
  resolvePipelineFromSteps,
  shouldAutoTts,
} from '@/lib/agentWorkflow';

describe('agentWorkflow', () => {
  it('makeSteps labels capabilities', () => {
    const steps = makeSteps(['asr', 'llm', 'tts']);
    expect(steps).toHaveLength(3);
    expect(steps.map((s) => s.capability)).toEqual(['asr', 'llm', 'tts']);
  });

  it('resolvePipelineFromSteps maps common chains', () => {
    expect(resolvePipelineFromSteps(makeSteps(['llm']))).toBe('text_chat_stream');
    expect(resolvePipelineFromSteps(makeSteps(['llm', 'tts']))).toBe('text_chat');
    expect(resolvePipelineFromSteps(makeSteps(['asr', 'llm', 'tts']))).toBe('voice_reply');
  });

  it('shouldAutoTts for steps and pipelines', () => {
    expect(shouldAutoTts(makeSteps(['llm', 'tts']), 'text_chat_stream')).toBe(true);
    expect(shouldAutoTts(makeSteps(['llm']), 'text_chat_stream')).toBe(false);
    expect(shouldAutoTts(undefined, 'text_chat')).toBe(true);
    expect(shouldAutoTts(undefined, 'text_chat_stream')).toBe(false);
  });
});
