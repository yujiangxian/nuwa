// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-turn-reducer, Property 3: 重复 Message_Id 施加模型输出失败

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { initialTurnState, applyModelResponse } from './reducer';
import { TurnErrorCode } from './types';
import type { ModelResponse } from './types';
import { arbitraryTranscript } from '../messages/arbitraries';

/**
 * Property 3: For any awaiting_model state `s` derived from a non-empty
 * Transcript `t`, and a ModelResponse whose messageId already exists in
 * `s.transcript`, `applyModelResponse` fails with code
 * `TURN_DUPLICATE_MESSAGE_ID` and locates that messageId.
 *
 * Validates: Requirements 4.3
 */
describe('Property 3: 重复 Message_Id 施加模型输出失败', () => {
  it('applyModelResponse 在 messageId 已存在时失败并定位该 id', () => {
    fc.assert(
      fc.property(
        arbitraryTranscript
          .filter((t) => t.messages.length > 0)
          .chain((t) =>
            // Pick an existing message id from the transcript.
            fc
              .nat({ max: t.messages.length - 1 })
              .map((i) => ({ t, existingId: t.messages[i].id })),
          ),
        ({ t, existingId }) => {
          const s = initialTurnState(t);
          const response: ModelResponse = { messageId: existingId, toolCalls: [] };

          const res = applyModelResponse(s, response);

          expect(res.ok).toBe(false);
          if (res.ok) {
            throw new Error('expected applyModelResponse to fail');
          }
          expect(res.error.code).toBe(TurnErrorCode.TURN_DUPLICATE_MESSAGE_ID);
          expect(res.error.location.messageId).toBe(existingId);
        },
      ),
      { numRuns: 100 },
    );
  });
});
