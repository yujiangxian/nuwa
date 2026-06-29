// Feature: agent-conversation-assembly, Property 5: 无上限装配等于系统消息后接全部历史
//
// 对任意 a 与 t，assembleMessages(a, t, undefined)（或 options 不含 maxMessages）逐元素
// 等于 [systemMessageOf(a), ...t.messages]，长度等于 1 + t.messages.length。
//
// Validates: Requirements 4.3, 4.5

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { assembleMessages, systemMessageOf } from './assemble';
import { arbitraryAgent, arbitraryTranscript } from './arbitraries';

describe('Property 5: 无上限装配等于系统消息后接全部历史', () => {
  it('options=undefined 或 {} 时逐元素等于 [system, ...history]', () => {
    fc.assert(
      fc.property(arbitraryAgent, arbitraryTranscript, (a, t) => {
        const expected = [systemMessageOf(a), ...t.messages];

        for (const res of [
          assembleMessages(a, t, undefined),
          assembleMessages(a, t, {}),
        ]) {
          expect(res.length).toBe(1 + t.messages.length);
          expect(res).toEqual(expected);
        }
      }),
      { numRuns: 100 },
    );
  });
});
