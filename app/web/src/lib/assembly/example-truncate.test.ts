// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-conversation-assembly, Example: 具体列表的截断与 max=1 装配
//
// Validates: Requirements 5.2, 5.3, 8.4

import { describe, it, expect } from 'vitest';
import { truncateHistory, assembleMessages } from './assemble';
import type { AgentDefinition } from '../agents/types';
import type { Message, Transcript } from '../messages/types';

const m0: Message = { id: 'm0', role: 'user', parts: [{ kind: 'text', text: 'zero' }] };
const m1: Message = { id: 'm1', role: 'assistant', parts: [{ kind: 'text', text: 'one' }] };
const m2: Message = { id: 'm2', role: 'user', parts: [{ kind: 'text', text: 'two' }] };

const agent: AgentDefinition = {
  id: 'a1',
  name: 'Agent One',
  role: 'assistant',
  systemPrompt: 'sys',
  model: {
    modelId: 'm1',
    params: { temperature: 0.7, maxTokens: 256, topP: 1 },
  },
  tools: [],
  voice: null,
  tags: [],
};

describe('Example: truncateHistory 与 assembleMessages max=1', () => {
  it('maxMessages >= 长度时不截断', () => {
    expect(truncateHistory([m0, m1, m2], 5)).toEqual([m0, m1, m2]);
  });

  it('截断保留最近的消息', () => {
    expect(truncateHistory([m0, m1, m2], 2)).toEqual([m1, m2]);
    expect(truncateHistory([m0, m1, m2], 1)).toEqual([m2]);
  });

  it('assembleMessages maxMessages=1 仅返回系统消息', () => {
    const transcript: Transcript = { messages: [m0, m1, m2] };
    const result = assembleMessages(agent, transcript, { maxMessages: 1 });
    expect(result.length).toBe(1);
    expect(result[0].role).toBe('system');
  });
});
