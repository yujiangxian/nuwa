// Feature: agent-conversation-assembly, Property 7: 上限为 1 仅系统消息
//
// 对任意 a 与 t，assembleMessages(a, t, { maxMessages: 1 }) 恰为单元素列表
// [systemMessageOf(a)]。
//
// Validates: Requirements 8.4

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { assembleMessages, systemMessageOf } from './assemble';
import { arbitraryAgent, arbitraryTranscript } from './arbitraries';

describe('Property 7: 上限为 1 仅系统消息', () => {
  it('maxMessages=1 时结果恰为 [systemMessageOf(a)]', () => {
    fc.assert(
      fc.property(arbitraryAgent, arbitraryTranscript, (a, t) => {
        const res = assembleMessages(a, t, { maxMessages: 1 });

        expect(res.length).toBe(1);
        expect(res).toEqual([systemMessageOf(a)]);
      }),
      { numRuns: 100 },
    );
  });
});
