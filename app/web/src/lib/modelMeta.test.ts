// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { formatLastUsed } from '@/lib/modelMeta';

const NUM_RUNS = 200;

describe('modelMeta', () => {
  // Feature: model-management, Property 12: 相对使用时间分段文案
  // Validates: Requirements 6.4, 6.5, 6.6, 6.7, 6.8
  it('formatLastUsed produces the correct bucketed text', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.integer({ min: 0, max: 10_000_000 }),
        (lastUsed, now) => {
          const diff = now - lastUsed;
          const text = formatLastUsed(lastUsed, now);
          if (diff < 60) {
            expect(text).toBe('刚刚使用');
          } else if (diff < 3600) {
            expect(text).toBe(`${Math.floor(diff / 60)} 分钟前`);
          } else if (diff < 86400) {
            expect(text).toBe(`${Math.floor(diff / 3600)} 小时前`);
          } else {
            expect(text).toBe(`${Math.floor(diff / 86400)} 天前`);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // 单元边界用例：各分段临界值
  it('handles segment boundaries exactly', () => {
    const now = 1_000_000;
    expect(formatLastUsed(now - 0, now)).toBe('刚刚使用');
    expect(formatLastUsed(now - 59, now)).toBe('刚刚使用');
    expect(formatLastUsed(now - 60, now)).toBe('1 分钟前');
    expect(formatLastUsed(now - 3599, now)).toBe('59 分钟前');
    expect(formatLastUsed(now - 3600, now)).toBe('1 小时前');
    expect(formatLastUsed(now - 86399, now)).toBe('23 小时前');
    expect(formatLastUsed(now - 86400, now)).toBe('1 天前');
    expect(formatLastUsed(now - 86400 * 3, now)).toBe('3 天前');
  });
});
