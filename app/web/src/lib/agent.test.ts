// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, it, expect } from 'vitest';
import {
  validateName,
  generateAgentId,
  needsAgentSeeding,
  pickNextAgentId,
} from '@/lib/agent';
import type { Agent } from '@/store/types';

const sample = (id: string): Agent => ({
  id,
  name: id,
  description: '',
  avatar: 'x',
  systemPrompt: 'hi',
  voiceId: 'jyy',
  kind: 'local',
  pipeline: 'text_chat_stream',
});

describe('lib/agent', () => {
  it('validateName trims and rejects empty', () => {
    expect(validateName('  a  ')).toEqual({ ok: true, value: 'a' });
    expect(validateName('   ')).toEqual({ ok: false, value: '' });
  });

  it('generateAgentId is unique within set', () => {
    const existing = [sample('agent-a')];
    const id = generateAgentId(existing);
    expect(id).not.toBe('agent-a');
    expect(id.startsWith('agent-')).toBe(true);
  });

  it('needsAgentSeeding only when empty', () => {
    expect(needsAgentSeeding([])).toBe(true);
    expect(needsAgentSeeding([sample('a')])).toBe(false);
  });

  it('pickNextAgentId keeps current when not removed', () => {
    const agents = [sample('a'), sample('b')];
    expect(pickNextAgentId(agents, 'b', 'a')).toBe('a');
    expect(pickNextAgentId(agents, 'a', 'a')).toBe('b');
  });
});
