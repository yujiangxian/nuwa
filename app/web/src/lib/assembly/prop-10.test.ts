// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-conversation-assembly, Property 10: 装配确定性与不可变性
//
// 对任意 a、t 与 options，两次 assembleMessages 返回逐元素相同的列表；调用不改变
// a、t、options（以调用前后序列化比较）。
// Validates: Requirements 1.3, 1.4, 4.6

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { assembleMessages } from './assemble';
import {
  arbitraryAgent,
  arbitraryTranscript,
  arbitraryAssemblyOptions,
} from './arbitraries';

describe('Property 10: 装配确定性与不可变性', () => {
  it('确定性：两次调用结果深度相等；不可变性：输入序列化不变', () => {
    fc.assert(
      fc.property(
        arbitraryAgent,
        arbitraryTranscript,
        arbitraryAssemblyOptions,
        (a, t, options) => {
          const aBefore = JSON.stringify(a);
          const tBefore = JSON.stringify(t);
          const optionsBefore = JSON.stringify(options);

          const first = assembleMessages(a, t, options);
          const second = assembleMessages(a, t, options);

          // 确定性。
          expect(first).toEqual(second);

          // 不可变性。
          expect(JSON.stringify(a)).toBe(aBefore);
          expect(JSON.stringify(t)).toBe(tBefore);
          expect(JSON.stringify(options)).toBe(optionsBefore);
        },
      ),
      { numRuns: 100 },
    );
  });
});
