import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { Character } from '@/store/uiStore';
import {
  needsSeeding,
  validateName,
  generateCharacterId,
  pickNextCurrentId,
} from '@/lib/character';

/**
 * Property-based tests for the pure character logic in `lib/character.ts`.
 * Each property uses fast-check with at least 100 iterations.
 */

// A gradient generator drawn from a small preset pool (mirrors Gradient_Presets).
const gradientArb = fc.constantFrom(
  'linear-gradient(135deg, #48CAE4, #0096C7)',
  'linear-gradient(135deg, #FF6B9D, #D44D7A)',
  'linear-gradient(135deg, #52B788, #40916C)',
  'linear-gradient(135deg, #7B82E1, #5A60C0)',
);

// A character generator: random name (incl. whitespace/multibyte), random
// avatar, random voiceId (incl. empty string), random systemPrompt/description.
function characterArb(): fc.Arbitrary<Character> {
  return fc.record({
    id: fc.string({ minLength: 1, maxLength: 12 }),
    name: fc.string({ maxLength: 24 }),
    avatar: gradientArb,
    systemPrompt: fc.string({ maxLength: 40 }),
    voiceId: fc.oneof(fc.constant(''), fc.string({ maxLength: 8 })),
    description: fc.string({ maxLength: 40 }),
  });
}

// A collection of characters with unique ids.
function uniqueCharactersArb(opts?: { minLength?: number }): fc.Arbitrary<Character[]> {
  return fc
    .uniqueArray(characterArb(), {
      selector: (c) => c.id,
      minLength: opts?.minLength ?? 0,
      maxLength: 8,
    });
}

describe('needsSeeding', () => {
  it('Property 3: 种子判定函数', () => {
    // Feature: character-persona-management, Property 3: needsSeeding(stored) 当且仅当 stored 为空返回 true
    fc.assert(
      fc.property(uniqueCharactersArb(), (stored) => {
        expect(needsSeeding(stored)).toBe(stored.length === 0);
      }),
      { numRuns: 100 },
    );
  });
});

describe('validateName', () => {
  it('Property 4: 名称 trim 校验语义', () => {
    // Feature: character-persona-management, Property 4: trim 非空 -> { ok:true, value:trimmed }，否则 ok:false
    // Mix whitespace-only, leading/trailing-space, multibyte and plain text inputs.
    const richChar = fc.constantFrom(
      'a', 'B', '1', ' ', '\t', '\n', '\u3000', // includes ideographic space
      '你', '好', '世', '界', '😀', 'é',
    );
    const rawArb = fc.stringOf(richChar, { maxLength: 30 });
    fc.assert(
      fc.property(rawArb, (raw) => {
        const result = validateName(raw);
        const trimmed = raw.trim();
        if (trimmed.length === 0) {
          expect(result.ok).toBe(false);
          expect(result.value).toBe('');
        } else {
          expect(result.ok).toBe(true);
          expect(result.value).toBe(trimmed);
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe('generateCharacterId', () => {
  it('Property 5: 新建角色分配集内唯一 id', () => {
    // Feature: character-persona-management, Property 5: generateCharacterId(existing) 不等于 existing 中任何 id
    fc.assert(
      fc.property(uniqueCharactersArb(), (existing) => {
        const id = generateCharacterId(existing);
        expect(existing.some((c) => c.id === id)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});

describe('pickNextCurrentId', () => {
  it('Property 8: 删除后当前角色重选', () => {
    // Feature: character-persona-management, Property 8: 返回值存在于剩余集合；removedId!==currentId 时保持 currentId，否则取剩余某条
    fc.assert(
      fc.property(
        // ≥ 2 characters so the post-delete remainder is always non-empty.
        uniqueCharactersArb({ minLength: 2 }),
        fc.nat(),
        fc.nat(),
        (chars, ci, ri) => {
          const currentId = chars[ci % chars.length].id;
          const removedId = chars[ri % chars.length].id;
          const result = pickNextCurrentId(chars, removedId, currentId);

          const remaining = chars.filter((c) => c.id !== removedId);
          // Result must be a member of the post-delete collection.
          expect(result).not.toBeNull();
          expect(remaining.some((c) => c.id === result)).toBe(true);

          if (removedId !== currentId) {
            // currentId still exists -> kept unchanged.
            expect(result).toBe(currentId);
          } else {
            // Removed the current -> picks some remaining character's id.
            expect(remaining.some((c) => c.id === result)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
