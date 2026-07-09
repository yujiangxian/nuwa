// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-conversation-assembly, Property 2: truncateHistory 长度与后缀
//
// 对任意消息列表 ms 与整数 max >= 1，truncateHistory(ms, max) 的长度等于
// min(ms.length, max)，且其结果逐元素等于 ms 的对应后缀（ms.slice(ms.length - 结果.length)）。
//
// Validates: Requirements 5.1, 5.3, 5.4, 5.5

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { truncateHistory } from './assemble';
import { arbitraryMaxMessages } from './arbitraries';
import { arbitraryValidMessage } from '../messages/arbitraries';

describe('Property 2: truncateHistory 长度与后缀', () => {
  it('长度为 min(len, max)，结果逐元素等于原列表后缀（引用相等）', () => {
    fc.assert(
      fc.property(fc.array(arbitraryValidMessage), arbitraryMaxMessages, (ms, max) => {
        const r = truncateHistory(ms, max);

        expect(r.length).toBe(Math.min(ms.length, max));

        const suffix = ms.slice(ms.length - r.length);
        expect(r.length).toBe(suffix.length);
        for (let i = 0; i < r.length; i++) {
          // Reference equality: truncation keeps the original message objects.
          expect(r[i]).toBe(suffix[i]);
        }
      }),
      { numRuns: 100 },
    );
  });
});
