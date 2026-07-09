// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { pickLatestSession } from '@/lib/chatSession';
import type { ChatSession } from '@/store/types';

/**
 * Property-based tests for pickLatestSession.
 * _Requirements: 4.4, 7.1_
 */
describe('pickLatestSession', () => {
  const sessionArb: fc.Arbitrary<ChatSession> = fc.record({
    id: fc.uuid(),
    title: fc.string({ maxLength: 20 }),
    characterId: fc.string({ maxLength: 8 }),
    voiceId: fc.string({ maxLength: 8 }),
    // Random ISO timestamp within a wide, valid range.
    updatedAt: fc
      .date({ min: new Date('2000-01-01T00:00:00.000Z'), max: new Date('2100-01-01T00:00:00.000Z') })
      .map((d) => d.toISOString()),
    pinned: fc.boolean(),
  });

  it('Property 6: 最新会话选取', () => {
    // Feature: chat-session-persistence, Property 6: 最新会话选取
    fc.assert(
      fc.property(fc.array(sessionArb, { minLength: 1, maxLength: 30 }), (sessions) => {
        const latest = pickLatestSession(sessions);

        // Non-empty collection -> a member of the collection.
        expect(latest).not.toBeNull();
        expect(sessions).toContain(latest);

        // Its updatedAt is not earlier than any other session's.
        for (const session of sessions) {
          expect(latest!.updatedAt >= session.updatedAt).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('Property 6: 空集合返回 null', () => {
    // Feature: chat-session-persistence, Property 6: 最新会话选取 (empty case)
    expect(pickLatestSession([])).toBeNull();
  });
});
