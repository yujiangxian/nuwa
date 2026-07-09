// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-turn-reducer, Property 14: completed 为终态

import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { applyModelResponse, applyToolResults } from './reducer';
import { TurnErrorCode } from './types';
import type { ModelResponse } from './types';
import { arbitraryCompletedState } from './arbitraries';

// Validates: Requirements 7.3
describe('Property 14: completed 为终态', () => {
  it('对任意 completed 状态，applyModelResponse 与 applyToolResults 均以 TURN_INVALID_STATE 失败', () => {
    fc.assert(
      fc.property(arbitraryCompletedState, (s) => {
        expect(s.status).toBe('completed');

        const response: ModelResponse = { messageId: 'x', toolCalls: [] };
        const mr = applyModelResponse(s, response);
        expect(mr.ok).toBe(false);
        if (!mr.ok) {
          expect(mr.error.code).toBe(TurnErrorCode.TURN_INVALID_STATE);
        }

        const tr = applyToolResults(s, []);
        expect(tr.ok).toBe(false);
        if (!tr.ok) {
          expect(tr.error.code).toBe(TurnErrorCode.TURN_INVALID_STATE);
        }
      }),
      { numRuns: 100 },
    );
  });
});
