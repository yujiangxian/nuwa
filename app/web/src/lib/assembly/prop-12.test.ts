// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-conversation-assembly, Property 12: 校验结果 valid 当且仅当无错误且错误良构
//
// 对任意 a 与 options，validateAssembly(a, options).valid 为真当且仅当 errors 为空；
// 每条 AssemblyError 的 message 为非空字符串、location 为对象；两次调用相等；错误
// 序列按 compareAssemblyErrors 稳定排序（相邻 compare <= 0）。
// Validates: Requirements 6.1, 6.4, 6.5, 6.6, 7.9

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { validateAssembly, compareAssemblyErrors } from './validate';
import {
  arbitraryAgent,
  arbitraryLongPromptAgent,
  arbitraryAssemblyOptions,
} from './arbitraries';

describe('Property 12: 校验结果 valid 当且仅当无错误且错误良构', () => {
  it('valid 与 errors 空互为充要、错误良构、确定且稳定排序', () => {
    fc.assert(
      fc.property(
        fc.oneof(arbitraryAgent, arbitraryLongPromptAgent),
        arbitraryAssemblyOptions,
        (a, options) => {
          const vr = validateAssembly(a, options);

          // valid 当且仅当无错误。
          expect(vr.valid).toBe(vr.errors.length === 0);

          // 每条错误良构。
          for (const e of vr.errors) {
            expect(typeof e.message).toBe('string');
            expect(e.message.length).toBeGreaterThan(0);
            expect(typeof e.location).toBe('object');
            expect(e.location).not.toBeNull();
          }

          // 确定性：两次调用深度相等。
          const vr2 = validateAssembly(a, options);
          expect(vr).toEqual(vr2);

          // 稳定排序：相邻错误满足比较器 <= 0。
          for (let i = 0; i + 1 < vr.errors.length; i++) {
            expect(
              compareAssemblyErrors(vr.errors[i], vr.errors[i + 1]),
            ).toBeLessThanOrEqual(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
