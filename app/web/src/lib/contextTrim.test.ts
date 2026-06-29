import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { trimMessages } from '@/lib/contextTrim';
import { estimateMessages } from '@/lib/tokenEstimate';
import type { ChatMessage } from '@/store/uiStore';

const NUM_RUNS = 200;

const textArb = fc.oneof(fc.string(), fc.fullUnicodeString());

/** 生成 id 唯一的 ChatMessage 列表（便于保序子序列断言）。 */
const messagesArb: fc.Arbitrary<ChatMessage[]> = fc
  .array(
    fc.record({
      role: fc.constantFrom<'user' | 'assistant'>('user', 'assistant'),
      content: textArb,
    }),
    { maxLength: 30 },
  )
  .map((arr) => arr.map((m, i) => ({ id: `t-${i}`, role: m.role, content: m.content })));

/** 裁剪参数（混合极小 / 适中 contextLength 以触发裁剪分支）。 */
const paramArb = fc.record({
  systemPromptTokens: fc.integer({ min: 0, max: 100 }),
  contextLength: fc.integer({ min: 1, max: 300 }),
  reservedTokens: fc.integer({ min: 0, max: 100 }),
});

function fits(
  list: ChatMessage[],
  systemPromptTokens: number,
  contextLength: number,
  reservedTokens: number,
): boolean {
  return systemPromptTokens + reservedTokens + estimateMessages(list) <= contextLength;
}

describe('contextTrim.trimMessages', () => {
  // Feature: context-window-management, Property 9: 未超预算时裁剪为恒等且幂等
  // Validates: Requirements 6.1
  it('is identity when within budget, and idempotent for any input', () => {
    fc.assert(
      fc.property(messagesArb, paramArb, (messages, p) => {
        const first = trimMessages({ messages, ...p });
        // 幂等：对输出再次裁剪得到等价结果
        const second = trimMessages({ messages: first.messages, ...p });
        expect(second.messages).toEqual(first.messages);
        expect(second.trimmedCount).toBe(0);

        if (fits(messages, p.systemPromptTokens, p.contextLength, p.reservedTokens)) {
          expect(first.messages).toEqual(messages);
          expect(first.trimmedCount).toBe(0);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: context-window-management, Property 10: 裁剪始终保留 System_Prompt 与 Latest_User_Message
  // Validates: Requirements 6.3, 6.4
  it('always retains the latest user message when one exists (system prompt never in messages)', () => {
    fc.assert(
      fc.property(messagesArb, paramArb, (messages, p) => {
        const { messages: out } = trimMessages({ messages, ...p });
        // 定位 Latest_User_Message
        let latestUserId: string | null = null;
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].role === 'user') {
            latestUserId = messages[i].id;
            break;
          }
        }
        if (latestUserId !== null) {
          expect(out.some((m) => m.id === latestUserId)).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: context-window-management, Property 11: 裁剪输出为输入的保序子序列且优先丢弃最旧消息
  // Validates: Requirements 6.2, 6.5
  it('output is an order-preserving subsequence dropping oldest non-protected first', () => {
    fc.assert(
      fc.property(messagesArb, paramArb, (messages, p) => {
        const { messages: out } = trimMessages({ messages, ...p });
        const inputIds = messages.map((m) => m.id);
        const outIds = out.map((m) => m.id);
        const outSet = new Set(outIds);

        // (a) 保序子序列：outIds 按 inputIds 的相对顺序出现
        let cursor = 0;
        for (const id of outIds) {
          const found = inputIds.indexOf(id, cursor);
          expect(found).toBeGreaterThanOrEqual(cursor);
          cursor = found + 1;
        }

        // (b) 最旧优先：被删除的「非受保护」消息构成「非受保护索引序列」的一个前缀
        let keepIdx = -1;
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].role === 'user') {
            keepIdx = i;
            break;
          }
        }
        const nonProtected = messages
          .map((m, i) => ({ m, i }))
          .filter(({ i }) => i !== keepIdx);
        // 标记每个非受保护消息是否被删除
        const removedFlags = nonProtected.map(({ m }) => !outSet.has(m.id));
        // 前缀性质：一旦出现「保留」(false)，其后不应再出现「删除」(true)
        let sawKept = false;
        for (const removed of removedFlags) {
          if (!removed) sawKept = true;
          if (sawKept) expect(removed).toBe(false);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: context-window-management, Property 12: trimmedCount 等于输入与输出条数之差
  // Validates: Requirements 6.6
  it('trimmedCount equals input length minus output length and is non-negative', () => {
    fc.assert(
      fc.property(messagesArb, paramArb, (messages, p) => {
        const { messages: out, trimmedCount } = trimMessages({ messages, ...p });
        expect(trimmedCount).toBe(messages.length - out.length);
        expect(trimmedCount).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(trimmedCount)).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: context-window-management, Property 13: 裁剪确定性
  // Validates: Requirements 6.7
  it('is deterministic for equal inputs', () => {
    fc.assert(
      fc.property(messagesArb, paramArb, (messages, p) => {
        const a = trimMessages({ messages, ...p });
        const b = trimMessages({ messages, ...p });
        expect(a).toEqual(b);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
