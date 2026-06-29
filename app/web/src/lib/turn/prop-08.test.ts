// Feature: agent-turn-reducer, Property 8: 未知 Call_Id 工具结果失败
//
// 对任意 awaiting_tools 的 s 与含一个 callId 不在 s.pendingCallIds 的 outcome 的
// outcomes，applyToolResults 失败，code 为 TURN_UNKNOWN_CALL_ID 且定位该 callId。
// Validates: Requirements 5.3

import fc from 'fast-check';
import { describe, it } from 'vitest';
import { applyToolResults } from './reducer';
import { TurnErrorCode } from './types';
import { arbitraryTurnStateAwaitingTools, arbitraryJsonText } from './arbitraries';

/** Produce a Call_Id guaranteed not to be in `pending` by appending '_'. */
function freshCallId(pending: readonly string[], seed: string): string {
  let id = seed;
  while (pending.includes(id)) {
    id += '_';
  }
  return id;
}

describe('Property 8: applying a tool result for an unknown Call_Id fails', () => {
  it('fails with TURN_UNKNOWN_CALL_ID and reports the offending callId', () => {
    fc.assert(
      fc.property(
        arbitraryTurnStateAwaitingTools,
        fc.string(),
        arbitraryJsonText,
        (state, seed, resultJson) => {
          const unknown = freshCallId(state.pendingCallIds, seed);
          const res = applyToolResults(state, [{ callId: unknown, resultJson }]);
          if (res.ok) return false;
          return (
            res.error.code === TurnErrorCode.TURN_UNKNOWN_CALL_ID &&
            res.error.location.callId === unknown
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});
