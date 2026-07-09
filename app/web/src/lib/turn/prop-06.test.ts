// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-turn-reducer, Property 6: 施加模型输出不可变性与确定性

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { initialTurnState, applyModelResponse } from './reducer';
import { arbitraryTranscript } from '../messages/arbitraries';
import { arbitraryModelResponse } from './arbitraries';

/**
 * Property 6: For any awaiting_model state `s` derived from `t` and any
 * ModelResponse `r`, two calls to `applyModelResponse(s, r)` return deeply
 * equal results (determinism), and the call mutates neither `s` nor `r`
 * (compared by serialization).
 *
 * Validates: Requirements 1.3, 1.4, 4.7
 */
describe('Property 6: 施加模型输出不可变性与确定性', () => {
  it('applyModelResponse 确定且不修改输入', () => {
    fc.assert(
      fc.property(
        arbitraryTranscript.chain((t) =>
          arbitraryModelResponse(t).map((r) => ({ t, r })),
        ),
        ({ t, r }) => {
          const s = initialTurnState(t);

          // Snapshot inputs before the operation.
          const sBefore = JSON.stringify(s);
          const rBefore = JSON.stringify(r);

          const res1 = applyModelResponse(s, r);
          const res2 = applyModelResponse(s, r);

          // Determinism: two calls return deeply equal results (R4.7).
          expect(res2).toEqual(res1);

          // Immutability: inputs are unchanged by the calls (R1.3, R1.4).
          expect(JSON.stringify(s)).toBe(sBefore);
          expect(JSON.stringify(r)).toBe(rBefore);
        },
      ),
      { numRuns: 100 },
    );
  });
});
