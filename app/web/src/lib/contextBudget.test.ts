import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  DEFAULT_RESERVED_TOKENS,
  WARNING_THRESHOLD,
  computeBudget,
  resolveReservedTokens,
} from '@/lib/contextBudget';
import { estimateText, estimateMessages } from '@/lib/tokenEstimate';
import { PARAM_SPECS, type ChatGenParams } from '@/lib/generationParams';
import type { ChatMessage } from '@/store/types';

const NUM_RUNS = 200;

const textArb = fc.oneof(fc.string(), fc.fullUnicodeString());

let idCounter = 0;
const messageArb: fc.Arbitrary<ChatMessage> = fc.record({
  id: fc.constant(null).map(() => `b-${idCounter++}`),
  role: fc.constantFrom<'user' | 'assistant'>('user', 'assistant'),
  content: textArb,
});
const messagesArb = fc.array(messageArb, { maxLength: 25 });

/** 任意 ChatParamState（含 active 与 value，value 含 -1 与越界）。 */
function paramStateArb(key: keyof typeof PARAM_SPECS) {
  const spec = PARAM_SPECS[key];
  const valueArb = spec.integer
    ? fc.integer({ min: spec.min, max: spec.max })
    : fc.double({ min: spec.min, max: spec.max, noNaN: true });
  const choices = spec.allowUnlimited ? [valueArb, fc.constant(-1)] : [valueArb];
  return fc.record({ active: fc.boolean(), value: fc.oneof(...choices) });
}

const chatGenParamsArb: fc.Arbitrary<ChatGenParams> = fc.record({
  temperature: paramStateArb('temperature'),
  topP: paramStateArb('topP'),
  numPredict: paramStateArb('numPredict'),
  topK: paramStateArb('topK'),
  repeatPenalty: paramStateArb('repeatPenalty'),
});

describe('contextBudget', () => {
  // Feature: context-window-management, Property 4: Used_Tokens 等于系统提示与全部消息估算之和
  // Validates: Requirements 3.1
  it('usedTokens equals estimateText(systemPrompt) + estimateMessages(messages)', () => {
    fc.assert(
      fc.property(textArb, messagesArb, (systemPrompt, messages) => {
        const budget = computeBudget({
          contextLength: 4096,
          isEstimated: false,
          systemPrompt,
          messages,
          reservedTokens: 512,
        });
        expect(budget.usedTokens).toBe(
          estimateText(systemPrompt) + estimateMessages(messages),
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: context-window-management, Property 5: Reserved_Response_Tokens 由 Num_Predict 决定
  // Validates: Requirements 3.2
  it('resolveReservedTokens returns numPredict when active positive integer, else default', () => {
    fc.assert(
      fc.property(chatGenParamsArb, (params) => {
        const np = params.numPredict;
        const reserved = resolveReservedTokens(params);
        if (np.active && Number.isInteger(np.value) && np.value > 0) {
          expect(reserved).toBe(np.value);
        } else {
          expect(reserved).toBe(DEFAULT_RESERVED_TOKENS);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: context-window-management, Property 6: Remaining_Tokens 等式与 Usage_Ratio 钳制
  // Validates: Requirements 3.3, 3.4
  it('remainingTokens equation holds and usageRatio is clamped to [0,1]', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 200000 }),
        textArb,
        messagesArb,
        fc.integer({ min: 0, max: 100000 }),
        (contextLength, systemPrompt, messages, reservedTokens) => {
          const budget = computeBudget({
            contextLength,
            isEstimated: false,
            systemPrompt,
            messages,
            reservedTokens,
          });
          expect(budget.remainingTokens).toBe(
            contextLength - budget.usedTokens - reservedTokens,
          );
          const raw = (budget.usedTokens + reservedTokens) / contextLength;
          const expected = Math.max(0, Math.min(1, raw));
          expect(budget.usageRatio).toBeCloseTo(expected, 10);
          expect(budget.usageRatio).toBeGreaterThanOrEqual(0);
          expect(budget.usageRatio).toBeLessThanOrEqual(1);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: context-window-management, Property 7: 预算计算确定性
  // Validates: Requirements 3.5
  it('computeBudget is deterministic for equal inputs', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 200000 }),
        textArb,
        messagesArb,
        fc.integer({ min: 0, max: 100000 }),
        (contextLength, systemPrompt, messages, reservedTokens) => {
          const a = computeBudget({
            contextLength,
            isEstimated: true,
            systemPrompt,
            messages,
            reservedTokens,
          });
          const b = computeBudget({
            contextLength,
            isEstimated: true,
            systemPrompt,
            messages,
            reservedTokens,
          });
          expect(a).toEqual(b);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: context-window-management, Property 8: Usage_State 三态分类正确
  // Validates: Requirements 4.1, 4.2, 4.3
  it('usageState classifies over / warning / normal correctly', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 2000 }),
        textArb,
        messagesArb,
        fc.integer({ min: 0, max: 4000 }),
        (contextLength, systemPrompt, messages, reservedTokens) => {
          const budget = computeBudget({
            contextLength,
            isEstimated: false,
            systemPrompt,
            messages,
            reservedTokens,
          });
          const overBudget = budget.usedTokens + reservedTokens > contextLength;
          if (overBudget) {
            expect(budget.usageState).toBe('over');
          } else if (budget.usageRatio >= WARNING_THRESHOLD) {
            expect(budget.usageState).toBe('warning');
          } else {
            expect(budget.usageState).toBe('normal');
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
