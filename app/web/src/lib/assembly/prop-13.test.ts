// Feature: agent-conversation-assembly, Property 13: 合法输入校验通过
//
// 对任意 a 其 systemPrompt 长度不超过上界、与 options 不含 maxMessages 或其
// maxMessages 为 >=1 整数，validateAssembly(a, options).valid 为真、errors 为空。
// Validates: Requirements 6.4

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { validateAssembly } from './validate';
import { arbitraryAgent, arbitraryMaxMessages } from './arbitraries';

describe('Property 13: 合法输入校验通过', () => {
  it('合法 agent 与合法 options 校验通过且无错误', () => {
    fc.assert(
      fc.property(
        arbitraryAgent,
        fc.oneof(
          fc.constant({}),
          arbitraryMaxMessages.map((maxMessages) => ({ maxMessages })),
        ),
        (a, options) => {
          const vr = validateAssembly(a, options);
          expect(vr.valid).toBe(true);
          expect(vr.errors.length).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
