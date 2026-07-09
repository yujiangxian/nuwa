// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-turn-reducer, Property 2: 非 awaiting_model 施加模型输出失败

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { applyModelResponse } from './reducer';
import { TurnErrorCode } from './types';
import {
  arbitraryTurnStateAwaitingTools,
  arbitraryCompletedState,
  arbitraryModelResponse,
} from './arbitraries';

/**
 * Property 2: For any TurnState `s` whose status is not `awaiting_model`
 * (i.e. `awaiting_tools` or `completed`) and any ModelResponse,
 * `applyModelResponse(s, ·)` fails with code `TURN_INVALID_STATE` and
 * `location.status` equal to `s.status`.
 *
 * Validates: Requirements 4.2, 7.3
 */
describe('Property 2: 非 awaiting_model 施加模型输出失败', () => {
  it('applyModelResponse 在非 awaiting_model 状态下失败并定位当前状态', () => {
    const arbitraryNonAwaitingModel = fc.oneof(
      arbitraryTurnStateAwaitingTools,
      arbitraryCompletedState,
    );

    fc.assert(
      fc.property(
        arbitraryNonAwaitingModel.chain((s) =>
          arbitraryModelResponse(s.transcript).map((response) => ({ s, response })),
        ),
        ({ s, response }) => {
          expect(s.status).not.toBe('awaiting_model');

          const res = applyModelResponse(s, response);

          expect(res.ok).toBe(false);
          if (res.ok) {
            throw new Error('expected applyModelResponse to fail');
          }
          expect(res.error.code).toBe(TurnErrorCode.TURN_INVALID_STATE);
          expect(res.error.location.status).toBe(s.status);
        },
      ),
      { numRuns: 100 },
    );
  });
});
