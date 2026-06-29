// Feature: agent-conversation-assembly, Property 1: 系统消息形状与确定性
//
// 对任意 AgentDefinition a，systemMessageOf(a) 的 role 为 'system'、parts 恰含
// 一个 text 片段且其 text 等于 a.systemPrompt、id 等于 SYSTEM_MESSAGE_ID_PREFIX + a.id；
// 两次调用返回相等结果。
//
// Validates: Requirements 2.1, 2.2, 2.3, 2.4

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { systemMessageOf } from './assemble';
import { SYSTEM_MESSAGE_ID_PREFIX } from './types';
import { arbitraryAgent } from './arbitraries';

describe('Property 1: 系统消息形状与确定性', () => {
  it('role=system、单 text 片段=systemPrompt、id=前缀+id，且确定', () => {
    fc.assert(
      fc.property(arbitraryAgent, (a) => {
        const sm = systemMessageOf(a);

        expect(sm.role).toBe('system');
        expect(sm.parts.length).toBe(1);
        expect(sm.parts[0].kind).toBe('text');
        // parts[0] is a text part: assert its text equals systemPrompt.
        const part = sm.parts[0];
        expect(part.kind === 'text' && part.text === a.systemPrompt).toBe(true);
        expect(sm.id).toBe(SYSTEM_MESSAGE_ID_PREFIX + a.id);

        // Determinism: two calls return equal results.
        expect(systemMessageOf(a)).toEqual(sm);
      }),
      { numRuns: 100 },
    );
  });
});
