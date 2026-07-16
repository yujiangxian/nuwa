// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, expect, it } from 'vitest';
import { configLlmModelId, displayModelLabel, DISPLAY_MODEL_UNSELECTED } from './displayModel';
import type { Agent } from '@/store/types';

const localAgent = {
  id: 'a',
  name: '本地',
  description: '',
  avatar: '',
  systemPrompt: '',
  voiceId: '',
  kind: 'local' as const,
  pipeline: 'text_chat_stream' as const,
};

const external = (partial: Partial<Agent>): Agent => ({
  ...localAgent,
  kind: 'external',
  protocol: 'xai-oauth',
  externalModel: 'grok-build-0.1',
  ...partial,
});

describe('displayModelLabel', () => {
  it('shows configured local LLM without inventing a name', () => {
    expect(displayModelLabel(localAgent, { current_llm_model: 'llm/qwen3:8b' })).toBe('qwen3:8b');
    expect(displayModelLabel(localAgent, { current_models: { llm: 'gemma4:e4b' } })).toBe('gemma4:e4b');
  });

  it('shows unselected when local config empty', () => {
    expect(displayModelLabel(localAgent, {})).toBe(DISPLAY_MODEL_UNSELECTED);
    expect(displayModelLabel(localAgent, null)).toBe(DISPLAY_MODEL_UNSELECTED);
  });

  it('prefers externalModel for external agents', () => {
    expect(displayModelLabel(external({}), { current_llm_model: 'llm/other' })).toBe('grok-build-0.1');
  });

  it('falls back to protocol label when externalModel empty', () => {
    expect(displayModelLabel(external({ externalModel: '' }), {})).toBe('SuperGrok（订阅 OAuth）');
    expect(displayModelLabel(external({ externalModel: '  ', protocol: 'anthropic' }), {})).toBe(
      'Anthropic 原生',
    );
  });
});

describe('configLlmModelId', () => {
  it('returns undefined for empty / whitespace', () => {
    expect(configLlmModelId({ current_llm_model: '  ' })).toBeUndefined();
    expect(configLlmModelId(undefined)).toBeUndefined();
  });
});
