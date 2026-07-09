// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { deriveTitle, DEFAULT_TITLE } from '@/lib/chatTitle';

/**
 * Property-based tests for deriveTitle.
 * _Requirements: 6.2_
 */
describe('deriveTitle', () => {
  // A generator that mixes multi-byte characters, whitespace and ASCII so the
  // produced strings exercise trimming, truncation and multi-byte safety.
  const richChar = fc.constantFrom(
    'a', 'b', 'Z', '1', ' ', '\t', '\n',
    '你', '好', '世', '界', // CJK (multi-byte in UTF-8)
    '😀', '🎉', '🚀', // emoji (surrogate pairs / multi-code-unit)
    'é', 'ñ',
  );
  const contentArb = fc.stringOf(richChar, { maxLength: 40 });

  it('Property 1: 标题截断', () => {
    // Feature: chat-session-persistence, Property 1: 标题截断
    fc.assert(
      fc.property(contentArb, fc.integer({ min: 1, max: 30 }), (content, maxLen) => {
        const result = deriveTitle(content, maxLen);
        const trimmed = content.trim();
        const trimmedPoints = Array.from(trimmed);
        const resultPoints = Array.from(result);

        if (trimmedPoints.length === 0) {
          // Trimmed content empty -> default title.
          expect(result).toBe(DEFAULT_TITLE);
          return;
        }

        if (trimmedPoints.length > maxLen) {
          // Oversized -> exactly the first maxLen code points, and a prefix.
          const expected = trimmedPoints.slice(0, maxLen).join('');
          expect(result).toBe(expected);
          expect(trimmed.startsWith(result)).toBe(true);
          expect(resultPoints.length).toBe(maxLen);
        } else {
          // Length within [1, maxLen] -> equals trimmed content.
          expect(result).toBe(trimmed);
        }

        // Result never exceeds maxLen code points.
        expect(resultPoints.length).toBeLessThanOrEqual(maxLen);
      }),
      { numRuns: 100 },
    );
  });
});
