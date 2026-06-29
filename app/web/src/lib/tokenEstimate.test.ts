import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  MESSAGE_OVERHEAD_TOKENS,
  estimateText,
  estimateMessages,
} from '@/lib/tokenEstimate';
import type { ChatMessage } from '@/store/uiStore';

const NUM_RUNS = 200;

/** 覆盖 ASCII / CJK / emoji / 代理对 / 空串 / 超长串。 */
const textArb = fc.oneof(fc.string(), fc.fullUnicodeString(), fc.string({ minLength: 0, maxLength: 500 }));

let idCounter = 0;
const messageArb: fc.Arbitrary<ChatMessage> = fc.record({
  id: fc.constant(null).map(() => `m-${idCounter++}`),
  role: fc.constantFrom<'user' | 'assistant'>('user', 'assistant'),
  content: textArb,
});

const messagesArb = fc.array(messageArb, { maxLength: 30 });

describe('tokenEstimate', () => {
  // Feature: context-window-management, Property 1: Token 估算非负、确定且单调
  // Validates: Requirements 1.1, 1.3, 1.4
  it('estimateText is non-negative integer, deterministic, and monotonic under concatenation', () => {
    fc.assert(
      fc.property(textArb, textArb, (a, b) => {
        const ea = estimateText(a);
        const eb = estimateText(b);
        const eab = estimateText(a + b);

        expect(Number.isInteger(ea)).toBe(true);
        expect(ea).toBeGreaterThanOrEqual(0);
        // 确定性
        expect(estimateText(a)).toBe(ea);
        // 单调性
        expect(eab).toBeGreaterThanOrEqual(ea);
        expect(eab).toBeGreaterThanOrEqual(eb);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: context-window-management, Property 2: 消息列表估算等于各消息估算之和
  // Validates: Requirements 1.5, 1.6
  it('estimateMessages equals sum of per-message estimate plus overhead, and is monotonic on append', () => {
    fc.assert(
      fc.property(messagesArb, messageArb, (list, extra) => {
        const expected = list.reduce(
          (acc, m) => acc + estimateText(m.content) + MESSAGE_OVERHEAD_TOKENS,
          0,
        );
        expect(estimateMessages(list)).toBe(expected);
        // 追加一条不减少估算值
        expect(estimateMessages([...list, extra])).toBeGreaterThanOrEqual(
          estimateMessages(list),
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // 边界示例（Req 1.2, 1.6）
  it('returns 0 for empty string and empty message list', () => {
    expect(estimateText('')).toBe(0);
    expect(estimateMessages([])).toBe(0);
  });
});
