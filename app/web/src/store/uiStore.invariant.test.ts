// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { useUIStore, setChatDbForTesting, defaultCharacters } from '@/store/uiStore';
import { createFakeChatDb, type FakeChatDb } from '@/store/testChatDb';

/**
 * Property 11: currentSessionId 有效性不变式（基于模型）。
 *
 * We drive the store with a random sequence of create/switch/delete/rename/
 * appendMessage operations against an in-memory fake Chat_DB. A pure reference
 * predicate models the required invariant: after every operation the live
 * `currentSessionId` must be either `null` or the id of a session that actually
 * exists in `sessions`. There must never be a dangling pointer.
 */

let fake: FakeChatDb;

function resetStore(): void {
  fake = createFakeChatDb();
  setChatDbForTesting(fake);
  useUIStore.setState({
    sessions: [],
    currentSessionId: null,
    messages: [],
    sessionsLoading: false,
    isPersistent: true,
    characters: defaultCharacters,
    currentCharacterId: 'assistant',
  });
}

beforeEach(resetStore);

type Op =
  | { type: 'create' }
  | { type: 'switch'; n: number }
  | { type: 'delete'; n: number }
  | { type: 'rename'; n: number; title: string }
  | { type: 'append'; content: string; role: 'user' | 'assistant' };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ type: fc.constant('create' as const) }),
  fc.record({ type: fc.constant('switch' as const), n: fc.nat({ max: 1000 }) }),
  fc.record({ type: fc.constant('delete' as const), n: fc.nat({ max: 1000 }) }),
  fc.record({ type: fc.constant('rename' as const), n: fc.nat({ max: 1000 }), title: fc.string({ maxLength: 10 }) }),
  fc.record({ type: fc.constant('append' as const), content: fc.string({ maxLength: 10 }), role: fc.constantFrom('user' as const, 'assistant' as const) }),
);

// Pure reference predicate: the invariant that must hold after every operation.
function invariantHolds(): boolean {
  const { currentSessionId, sessions } = useUIStore.getState();
  if (currentSessionId === null) return true;
  return sessions.some((s) => s.id === currentSessionId);
}

describe('Chat_Store currentSessionId invariant (Property 11)', () => {
  it('Property 11: currentSessionId 有效性不变式', async () => {
    // Feature: chat-session-persistence, Property 11: currentSessionId 有效性不变式
    // Validates: Requirements 7.3
    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { minLength: 1, maxLength: 25 }), async (ops) => {
        resetStore();
        // Simulate startup: empty-state handling creates an initial session.
        await useUIStore.getState().createSession('assistant');
        expect(invariantHolds()).toBe(true);

        let counter = 0;
        for (const op of ops) {
          const st = useUIStore.getState();
          switch (op.type) {
            case 'create':
              await st.createSession('assistant');
              break;
            case 'switch':
              if (st.sessions.length > 0) await st.switchSession(st.sessions[op.n % st.sessions.length].id);
              break;
            case 'delete':
              if (st.sessions.length > 0) await st.deleteSession(st.sessions[op.n % st.sessions.length].id);
              break;
            case 'rename':
              if (st.sessions.length > 0) await st.renameSession(st.sessions[op.n % st.sessions.length].id, op.title);
              break;
            case 'append':
              await st.appendMessage({ id: `m-${counter++}`, role: op.role, content: op.content });
              break;
          }
          // Invariant must hold after each operation.
          expect(invariantHolds()).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});
