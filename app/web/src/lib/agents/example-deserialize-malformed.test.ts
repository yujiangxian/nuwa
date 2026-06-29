// Feature: agent-definition-registry, Example: 反序列化拒斥典型畸形串
import { describe, it, expect } from 'vitest';
import { deserializeRegistry } from './serialize';
import { AgentErrorCode } from './types';

describe('example: deserializeRegistry rejects malformed JSON', () => {
  const cases: ReadonlyArray<{ readonly label: string; readonly input: string }> = [
    { label: 'empty string', input: '' },
    { label: 'truncated object', input: '{' },
    { label: 'agents is not an array', input: '{"agents":1}' },
    {
      label: 'entry missing model',
      input: '{"version":1,"agents":[{"id":"a","name":"n","role":"","systemPrompt":""}]}',
    },
  ];

  for (const { label, input } of cases) {
    it(`fails with AGENT_MALFORMED_JSON for ${label}`, () => {
      const result = deserializeRegistry(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(AgentErrorCode.AGENT_MALFORMED_JSON);
      }
    });
  }
});
