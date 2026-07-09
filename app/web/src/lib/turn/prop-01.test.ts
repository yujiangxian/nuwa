// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-turn-reducer, Property 1: 初始状态形状与确定性

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { initialTurnState } from './reducer';
import { arbitraryTranscript } from '../messages/arbitraries';

/**
 * Property 1: For any Transcript `t`, `initialTurnState(t)` has transcript
 * referentially equal to `t`, status `awaiting_model`, and an empty
 * pendingCallIds array; two calls are deeply equal (determinism).
 *
 * Validates: Requirements 3.2, 3.3
 */
describe('Property 1: 初始状态形状与确定性', () => {
  it('initialTurnState 形状正确且确定', () => {
    fc.assert(
      fc.property(arbitraryTranscript, (t) => {
        const s = initialTurnState(t);

        // transcript is referentially equal to the input (R3.2).
        expect(s.transcript).toBe(t);
        // status is awaiting_model (R3.2).
        expect(s.status).toBe('awaiting_model');
        // pendingCallIds is an empty array (R3.2).
        expect(Array.isArray(s.pendingCallIds)).toBe(true);
        expect(s.pendingCallIds).toHaveLength(0);

        // Determinism: two calls produce deeply equal states (R3.3).
        const s2 = initialTurnState(t);
        expect(s2).toEqual(s);
      }),
      { numRuns: 100 },
    );
  });
});
