// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-turn-reducer, Property 5: 无工具调用转移到 completed

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { initialTurnState, applyModelResponse } from './reducer';
import { arbitraryTranscript } from '../messages/arbitraries';
import { arbitraryModelResponseNoTools } from './arbitraries';

/**
 * Property 5: For any awaiting_model state derived from `t` and a ModelResponse
 * `r` with an empty Tool_Call_List, `applyModelResponse` succeeds, the new
 * status is `completed`, pendingCallIds is empty, and the new transcript has
 * exactly one more message (the last being role `assistant`).
 *
 * Validates: Requirements 4.5, 4.6
 */
describe('Property 5: 无工具调用转移到 completed', () => {
  it('无工具调用的模型输出成功转移到 completed', () => {
    fc.assert(
      fc.property(
        arbitraryTranscript.chain((t) =>
          arbitraryModelResponseNoTools(t).map((r) => ({ t, r })),
        ),
        ({ t, r }) => {
          const res = applyModelResponse(initialTurnState(t), r);

          expect(res.ok).toBe(true);
          if (!res.ok) {
            throw new Error('expected applyModelResponse to succeed');
          }
          const next = res.state;

          // New status is completed with empty pending (R4.5).
          expect(next.status).toBe('completed');
          expect(next.pendingCallIds).toHaveLength(0);

          // Transcript grew by exactly one message; last is role assistant (R4.6).
          expect(next.transcript.messages.length).toBe(t.messages.length + 1);
          const last = next.transcript.messages[next.transcript.messages.length - 1];
          expect(last.role).toBe('assistant');
        },
      ),
      { numRuns: 100 },
    );
  });
});
