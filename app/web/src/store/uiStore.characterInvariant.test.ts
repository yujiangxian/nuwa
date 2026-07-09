// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import {
  useUIStore,
  setCharacterDbForTesting,
  type CharacterInput,
} from '@/store/uiStore';
import { createCharacterDb } from '@/lib/characterDb';

/**
 * Model-based property test for the Character_Store invariants (task 4.6).
 *
 * Property 9: For any sequence of create/update/delete/setCurrentCharacter
 * operations, after execution `characters` contains at least one character and
 * `currentCharacterId` always points to an existing character's id.
 */

const gradientArb = fc.constantFrom(
  'linear-gradient(135deg, #48CAE4, #0096C7)',
  'linear-gradient(135deg, #FF6B9D, #D44D7A)',
  'linear-gradient(135deg, #52B788, #40916C)',
);

function characterInputArb(): fc.Arbitrary<CharacterInput> {
  return fc.record({
    name: fc.oneof(
      // mostly valid names, occasionally blank (no-op) to exercise both paths
      fc.string({ minLength: 1, maxLength: 12 }).map((s) => s.trim() || 'n'),
      fc.constant('   '),
    ),
    systemPrompt: fc.string({ maxLength: 20 }),
    description: fc.string({ maxLength: 20 }),
    avatar: gradientArb,
    voiceId: fc.oneof(fc.constant(''), fc.string({ maxLength: 6 })),
  });
}

type Op =
  | { kind: 'create'; input: CharacterInput }
  | { kind: 'update'; idx: number; input: CharacterInput }
  | { kind: 'delete'; idx: number }
  | { kind: 'setCurrent'; idx: number };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ kind: fc.constant('create' as const), input: characterInputArb() }),
  fc.record({ kind: fc.constant('update' as const), idx: fc.nat(), input: characterInputArb() }),
  fc.record({ kind: fc.constant('delete' as const), idx: fc.nat() }),
  fc.record({ kind: fc.constant('setCurrent' as const), idx: fc.nat() }),
);

async function injectFreshDb() {
  const db = createCharacterDb(new IDBFactory());
  await db.init();
  setCharacterDbForTesting(db);
}

beforeEach(() => {
  useUIStore.setState({
    characters: [],
    currentCharacterId: 'assistant',
    charactersLoading: true,
    charactersPersistent: true,
  });
});

describe('Character_Store invariants (Property 9)', () => {
  it('always keeps >=1 character and a valid currentCharacterId across op sequences', async () => {
    // Feature: character-persona-management, Property 9: 角色状态不变式（基于模型）
    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { minLength: 1, maxLength: 25 }), async (ops) => {
        await injectFreshDb();
        // Start from seeded state (loadCharacters seeds defaults into a fresh DB).
        useUIStore.setState({
          characters: [],
          currentCharacterId: 'assistant',
          charactersLoading: true,
          charactersPersistent: true,
        });
        await useUIStore.getState().loadCharacters();

        for (const op of ops) {
          const state = useUIStore.getState();
          const chars = state.characters;
          if (op.kind === 'create') {
            await state.createCharacter(op.input);
          } else if (op.kind === 'update') {
            if (chars.length > 0) {
              await state.updateCharacter(chars[op.idx % chars.length].id, op.input);
            }
          } else if (op.kind === 'delete') {
            if (chars.length > 0) {
              await state.deleteCharacter(chars[op.idx % chars.length].id);
            }
          } else {
            if (chars.length > 0) {
              state.setCurrentCharacter(chars[op.idx % chars.length].id);
            }
          }

          // Invariants hold after every operation.
          const next = useUIStore.getState();
          expect(next.characters.length).toBeGreaterThanOrEqual(1);
        }

        // Final invariants: at least one character and currentCharacterId valid.
        const final = useUIStore.getState();
        expect(final.characters.length).toBeGreaterThanOrEqual(1);
        // Note: setCurrentCharacter can point to a then-deleted id only if a
        // later delete removed it; deleteCharacter re-points current when it
        // removes the active character, so current must always exist.
        const exists = final.characters.some((c) => c.id === final.currentCharacterId);
        expect(exists).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
