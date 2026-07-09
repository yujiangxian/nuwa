// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { validatePreset, generatePresetId, buildInsertedText } from '@/lib/promptPreset';
import type { PromptPreset } from '@/store/types';

/**
 * Property-based tests for the pure prompt-preset logic in `lib/promptPreset.ts`.
 * Each property uses fast-check with at least 100 iterations.
 */

// A rich character pool mixing plain text, ASCII whitespace, the ideographic
// (full-width) space, multibyte CJK characters and an emoji so generated
// strings exercise whitespace-only, leading/trailing-space and multibyte cases.
const richChar = fc.constantFrom(
  'a', 'B', '1', ' ', '\t', '\n', '\r', '\u3000', // includes ideographic space
  '你', '好', '世', '界', '😀', 'é',
);
const rawArb = fc.stringOf(richChar, { maxLength: 40 });

describe('validatePreset', () => {
  it('Property 3: 字段 trim 校验语义', () => {
    // Feature: prompt-preset-management, Property 3: validatePreset(title, content) 当且仅当
    // title 与 content 各自 trim() 后均非空时返回 { ok: true } 且 title/content 为各自 trim 后值，否则 ok === false
    // Validates: Requirements 3.6, 3.7, 4.3, 4.4
    fc.assert(
      fc.property(rawArb, rawArb, (rawTitle, rawContent) => {
        const result = validatePreset(rawTitle, rawContent);
        const trimmedTitle = rawTitle.trim();
        const trimmedContent = rawContent.trim();
        const bothNonEmpty =
          trimmedTitle.length > 0 && trimmedContent.length > 0;

        // ok is true if and only if both fields are non-empty after trim.
        expect(result.ok).toBe(bothNonEmpty);
        // title/content are always the trimmed values regardless of ok.
        expect(result.title).toBe(trimmedTitle);
        expect(result.content).toBe(trimmedContent);
      }),
      { numRuns: 100 },
    );
  });
});

// An arbitrary that produces a collection of existing presets with arbitrary
// ids (including ones shaped like real generated ids) so the uniqueness check
// is exercised against realistic and adversarial id sets.
const presetArb: fc.Arbitrary<PromptPreset> = fc.record({
  id: fc.oneof(
    fc.string({ maxLength: 30 }),
    fc.constantFrom('preset-abc-123', 'preset-xyz-999', ''),
  ),
  title: fc.string({ maxLength: 20 }),
  content: fc.string({ maxLength: 40 }),
});
const existingArb = fc.array(presetArb, { maxLength: 30 });

describe('generatePresetId', () => {
  it('Property 2: 新建预设分配集内唯一 id', () => {
    // Feature: prompt-preset-management, Property 2: generatePresetId(existing) 返回的 id
    // 不等于 existing 中任何预设的 id（在集合内唯一）
    // Validates: Requirements 3.2
    fc.assert(
      fc.property(existingArb, (existing) => {
        const id = generatePresetId(existing);
        // The generated id must not collide with any existing preset id.
        expect(existing.some((p) => p.id === id)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});

// Generators for buildInsertedText: `prev` covers empty / whitespace-only /
// non-empty text, `content` is arbitrary (incl. multibyte), and `maxLen` is
// derived from the deterministic target length so the boundaries (exactly at
// the limit and slightly over) are reliably exercised.
const prevArb = fc.oneof(
  fc.constant(''), // empty
  fc.stringOf(fc.constantFrom(' ', '\t', '\n', '\r', '\u3000'), { maxLength: 5 }), // whitespace-only
  fc.stringOf(richChar, { minLength: 1, maxLength: 40 }), // arbitrary (may be empty/whitespace too)
);
const contentArb = fc.stringOf(richChar, { maxLength: 40 });

describe('buildInsertedText', () => {
  it('Property 6: 插入文本构造与长度上限（纯函数部分）', () => {
    // Feature: prompt-preset-management, Property 6: buildInsertedText(prev, content, maxLen)
    // 计算的目标文本在 prev.trim() 为空时等于 content、否则等于 prev + '\n' + content；
    // 目标文本（按码点数）≤ maxLen 时返回 { ok: true, text: 目标文本 }，否则 { ok: false, text: prev }
    // Validates: Requirements 6.2, 6.3, 6.4, 6.5
    fc.assert(
      fc.property(
        prevArb,
        contentArb,
        // offset around the target length: negative -> slightly over the limit,
        // 0 -> exactly at the limit, positive -> within the limit.
        fc.integer({ min: -3, max: 5 }),
        (prev, content, offset) => {
          // Expected target text per Req 6.3 / 6.4.
          const expectedTarget =
            prev.trim().length === 0 ? content : `${prev}\n${content}`;
          const targetCodePoints = Array.from(expectedTarget).length;
          // Derive maxLen from the target length to hit the boundary cases.
          const maxLen = Math.max(0, targetCodePoints + offset);

          const result = buildInsertedText(prev, content, maxLen);

          if (targetCodePoints <= maxLen) {
            // Within limit: ok and text equals the constructed target text.
            expect(result.ok).toBe(true);
            expect(result.text).toBe(expectedTarget);
          } else {
            // Over limit: rejected and text equals the original prev (unchanged).
            expect(result.ok).toBe(false);
            expect(result.text).toBe(prev);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
