// Feature: agent-conversation-assembly, Property 3: truncateHistory 不截断分支
//
// 对任意消息列表 ms 与整数 max >= ms.length，truncateHistory(ms, max) 逐元素等于 ms。
//
// Validates: Requirements 5.2

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { truncateHistory } from './assemble';
import { arbitraryValidMessage } from '../messages/arbitraries';

describe('Property 3: truncateHistory 不截断分支', () => {
  it('max >= ms.length 时结果逐元素等于 ms（引用相等）', () => {
    fc.assert(
      fc.property(
        fc.array(arbitraryValidMessage).chain((ms) =>
          fc.record({
            ms: fc.constant(ms),
            // max >= ms.length, and also >= 1 even when ms is empty.
            max: fc.integer({ min: Math.max(1, ms.length), max: ms.length + 10 }),
          }),
        ),
        ({ ms, max }) => {
          const r = truncateHistory(ms, max);

          expect(r.length).toBe(ms.length);
          for (let i = 0; i < ms.length; i++) {
            expect(r[i]).toBe(ms[i]);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
