// Feature: agent-conversation-assembly, Property 11: 校验逐类违规检测
//
// 对任意 a 与 options：当 a.systemPrompt 长度超过 SYSTEM_PROMPT_MAX_LENGTH 时，
// validateAssembly 含 ASSEMBLY_SYSTEM_PROMPT_TOO_LONG(field='systemPrompt')；当
// options.maxMessages 为非 >=1 整数（如 0、-1、1.5）时，含
// ASSEMBLY_MAX_MESSAGES_INVALID(field='maxMessages')。
// Validates: Requirements 6.2, 6.3

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { validateAssembly } from './validate';
import { AssemblyErrorCode } from './types';
import { arbitraryAgent, arbitraryLongPromptAgent } from './arbitraries';

describe('Property 11: 校验逐类违规检测', () => {
  it('systemPrompt 超长时报告 ASSEMBLY_SYSTEM_PROMPT_TOO_LONG', () => {
    fc.assert(
      fc.property(arbitraryLongPromptAgent, (a) => {
        const { errors } = validateAssembly(a, {});
        const hit = errors.some(
          (e) =>
            e.code === AssemblyErrorCode.ASSEMBLY_SYSTEM_PROMPT_TOO_LONG &&
            e.location.field === 'systemPrompt',
        );
        expect(hit).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('maxMessages 越界时报告 ASSEMBLY_MAX_MESSAGES_INVALID', () => {
    fc.assert(
      fc.property(arbitraryAgent, fc.constantFrom(0, -1, 1.5), (a, bad) => {
        const { errors } = validateAssembly(a, { maxMessages: bad });
        const hit = errors.some(
          (e) =>
            e.code === AssemblyErrorCode.ASSEMBLY_MAX_MESSAGES_INVALID &&
            e.location.field === 'maxMessages',
        );
        expect(hit).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
