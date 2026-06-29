// Feature: agent-conversation-assembly, Example: 具体 agent 的系统消息 role/text/id 形状
//
// Validates: Requirements 2.2, 2.3

import { describe, it, expect } from 'vitest';
import { systemMessageOf } from './assemble';
import { SYSTEM_MESSAGE_ID_PREFIX } from './types';
import type { AgentDefinition } from '../agents/types';

const agent: AgentDefinition = {
  id: 'a1',
  name: 'Agent One',
  role: 'assistant',
  systemPrompt: 'hello',
  model: {
    modelId: 'm1',
    params: { temperature: 0.7, maxTokens: 256, topP: 1 },
  },
  tools: [],
  voice: null,
  tags: [],
};

describe('Example: systemMessageOf 形状', () => {
  it('role=system、单 text 片段=systemPrompt、id=前缀+id', () => {
    const sm = systemMessageOf(agent);
    expect(sm.role).toBe('system');
    expect(sm.parts).toEqual([{ kind: 'text', text: 'hello' }]);
    expect(sm.id).toBe(SYSTEM_MESSAGE_ID_PREFIX + 'a1');
    expect(sm.id).toBe('system:a1');
  });
});
