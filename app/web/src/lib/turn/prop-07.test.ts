// Feature: agent-turn-reducer, Property 7: 非 awaiting_tools 时施加工具结果失败
//
// 对任意 status 不为 `awaiting_tools` 的 TurnState s 与任意 outcomes，
// applyToolResults(s, ·) 失败，code 为 TURN_INVALID_STATE 且 location.status
// 等于 s.status。
// Validates: Requirements 5.2, 7.3

import fc from 'fast-check';
import { describe, it } from 'vitest';
import { applyToolResults } from './reducer';
import { TurnErrorCode } from './types';
import type { ToolOutcome } from './types';
import {
  arbitraryTurnStateAwaitingModel,
  arbitraryCompletedState,
} from './arbitraries';

describe('Property 7: applying tool results in a non-awaiting_tools state fails', () => {
  it('fails with TURN_INVALID_STATE and reports the current status', () => {
    fc.assert(
      fc.property(
        fc.oneof(arbitraryTurnStateAwaitingModel, arbitraryCompletedState),
        fc.oneof(
          fc.constant([] as readonly ToolOutcome[]),
          fc.constant([{ callId: 'x', resultJson: '{}' }] as readonly ToolOutcome[]),
        ),
        (state, outcomes) => {
          const res = applyToolResults(state, outcomes);
          if (res.ok) return false;
          return (
            res.error.code === TurnErrorCode.TURN_INVALID_STATE &&
            res.error.location.status === state.status
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});
