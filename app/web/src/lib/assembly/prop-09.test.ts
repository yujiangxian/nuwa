// Feature: agent-conversation-assembly, Property 9: 装配历史均来自 transcript 且为后缀
//
// 对任意 a、t 与 options，assembleMessages 除首元素外的每条消息均为 t.messages
// 中的消息，且该尾部子序列逐元素等于 t.messages 的一个后缀。
// Validates: Requirements 8.2, 8.3

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { assembleMessages } from './assemble';
import {
  arbitraryAgent,
  arbitraryTranscript,
  arbitraryAssemblyOptions,
} from './arbitraries';

describe('Property 9: 装配历史均来自 transcript 且为后缀', () => {
  it('尾部消息均来自 transcript 且逐元素等于其后缀', () => {
    fc.assert(
      fc.property(
        arbitraryAgent,
        arbitraryTranscript,
        arbitraryAssemblyOptions,
        (a, t, options) => {
          const res = assembleMessages(a, t, options);
          const tail = res.slice(1);

          // 每个尾部元素都是 t.messages 中的元素（引用相等）。
          for (const m of tail) {
            expect(t.messages.includes(m)).toBe(true);
          }

          // tail 逐元素等于 t.messages 的对应后缀（越界 max<=1 时 tail 为空，平凡成立）。
          const suffix = t.messages.slice(t.messages.length - tail.length);
          expect(tail).toEqual(suffix);
        },
      ),
      { numRuns: 100 },
    );
  });
});
