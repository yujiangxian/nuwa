// Feature: agent-message-protocol, Property 7: validateMessage 完整报告、确定与稳定排序
//
// 对任意注入 k≥2 处独立违规的 Message，validateMessage 报告每处对应码（不短路），
// 两次调用相等，错误按 compareMessageErrors 稳定排序。
//
// Validates: Requirements 7.7, 7.8

import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { validateMessage, compareMessageErrors } from './validate';
import { arbitraryValidMessage } from './arbitraries';
import { MessageErrorCode } from './types';
import type { Message, MessageError } from './types';

function hasCode(errors: readonly MessageError[], code: MessageErrorCode): boolean {
  return errors.some((e) => e.code === code);
}

describe('Property 7: validateMessage reports all violations, deterministically and stably sorted', () => {
  it('empty id + empty parts: both codes reported, deterministic, stably sorted', () => {
    fc.assert(
      fc.property(arbitraryValidMessage, (base) => {
        const m: Message = { ...base, id: '', parts: [] };

        const first = validateMessage(m);
        const second = validateMessage(m);

        // Each independent violation gets its code (no short-circuit).
        expect(hasCode(first.errors, MessageErrorCode.MESSAGE_EMPTY_ID)).toBe(true);
        expect(hasCode(first.errors, MessageErrorCode.MESSAGE_EMPTY_PARTS)).toBe(true);
        expect(first.errors.length).toBeGreaterThanOrEqual(2);

        // Determinism: two calls produce equal results.
        expect(second).toEqual(first);

        // Stable ordering: adjacent errors respect the comparator.
        for (let i = 0; i + 1 < first.errors.length; i++) {
          expect(compareMessageErrors(first.errors[i], first.errors[i + 1])).toBeLessThanOrEqual(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('empty id + part with empty callId and empty toolName: every code reported', () => {
    fc.assert(
      fc.property(arbitraryValidMessage, (base) => {
        const m: Message = {
          ...base,
          id: '',
          parts: [{ kind: 'tool_call', callId: '', toolName: '', argumentsJson: '{}' }],
        };

        const first = validateMessage(m);
        const second = validateMessage(m);

        expect(hasCode(first.errors, MessageErrorCode.MESSAGE_EMPTY_ID)).toBe(true);
        expect(hasCode(first.errors, MessageErrorCode.MESSAGE_EMPTY_CALL_ID)).toBe(true);
        expect(hasCode(first.errors, MessageErrorCode.MESSAGE_EMPTY_TOOL_NAME)).toBe(true);
        expect(first.errors.length).toBeGreaterThanOrEqual(2);

        expect(second).toEqual(first);

        for (let i = 0; i + 1 < first.errors.length; i++) {
          expect(compareMessageErrors(first.errors[i], first.errors[i + 1])).toBeLessThanOrEqual(0);
        }
      }),
      { numRuns: 100 },
    );
  });
});
