// Feature: agent-conversation-assembly, Property 6: 超限装配长度恰为上限且历史为最近后缀
//
// 对任意 a、t 与整数 max，满足 2 <= max < 1 + t.messages.length，
// assembleMessages(a, t, { maxMessages: max }) 长度恰为 max，其首元素为系统消息，
// 其余 max-1 条逐元素等于 t.messages 的末尾 max-1 条（最近后缀）。
//
// Validates: Requirements 4.4, 8.3

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { assembleMessages, systemMessageOf } from './assemble';
import { arbitraryAgent, arbitraryTranscript } from './arbitraries';

describe('Property 6: 超限装配长度恰为上限且历史为最近后缀', () => {
  it('2 <= max < 1 + len 时长度恰为 max，历史为最近后缀', () => {
    fc.assert(
      fc.property(
        arbitraryAgent,
        // Require at least 2 messages so a valid max with 2 <= max <= len
        // exists (then 2 <= max < 1 + len holds).
        arbitraryTranscript
          .filter((t) => t.messages.length >= 2)
          .chain((t) =>
            fc.record({
              t: fc.constant(t),
              max: fc.integer({ min: 2, max: t.messages.length }),
            }),
          ),
        (a, { t, max }) => {
          const res = assembleMessages(a, t, { maxMessages: max });

          expect(res.length).toBe(max);
          expect(res[0]).toEqual(systemMessageOf(a));

          const expectedHistory = t.messages.slice(t.messages.length - (max - 1));
          expect(res.slice(1)).toEqual(expectedHistory);
        },
      ),
      { numRuns: 100 },
    );
  });
});
