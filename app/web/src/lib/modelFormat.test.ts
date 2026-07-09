// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { formatSize, formatBytes } from '@/lib/modelFormat';

const NUM_RUNS = 200;

describe('modelFormat', () => {
  // Feature: model-management, Property 15: MB 大小格式化的分段精确契约
  // Validates: Requirements 8.1, 8.2, 8.3, 8.5
  it('formatSize segments by threshold with exact decimals', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1e7, noNaN: true }), (mb) => {
        const out = formatSize(mb);
        expect(out.length).toBeGreaterThan(0);
        if (mb > 1024) {
          expect(out).toBe(`${(mb / 1024).toFixed(1)} GB`);
        } else if (mb >= 100) {
          expect(out).toBe(`${mb.toFixed(0)} MB`);
        } else {
          expect(out).toBe(`${mb.toFixed(1)} MB`);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: model-management, Property 16: 字节格式化的分段精确契约
  // Validates: Requirements 8.4, 8.5
  it('formatBytes segments by threshold with exact decimals', () => {
    fc.assert(
      fc.property(fc.nat({ max: 2_000_000_000 }), (bytes) => {
        const out = formatBytes(bytes);
        expect(out.length).toBeGreaterThan(0);
        if (bytes >= 1024 * 1024 * 1024) {
          expect(out).toBe(`${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`);
        } else if (bytes >= 1024 * 1024) {
          expect(out).toBe(`${(bytes / (1024 * 1024)).toFixed(1)} MB`);
        } else if (bytes >= 1024) {
          expect(out).toBe(`${(bytes / 1024).toFixed(1)} KB`);
        } else {
          expect(out).toBe(`${bytes} B`);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // 单元边界用例
  it('formatSize boundaries', () => {
    expect(formatSize(100)).toBe('100 MB');
    expect(formatSize(1024)).toBe('1024 MB');
    expect(formatSize(1024.0001)).toBe('1.0 GB');
    expect(formatSize(99.9)).toBe('99.9 MB');
    expect(formatSize(2048)).toBe('2.0 GB');
  });

  it('formatBytes boundaries', () => {
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1048576)).toBe('1.0 MB');
    expect(formatBytes(1073741824)).toBe('1.0 GB');
    expect(formatBytes(0)).toBe('0 B');
  });
});
