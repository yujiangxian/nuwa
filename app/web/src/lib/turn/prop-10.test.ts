// Feature: agent-turn-reducer, Property 10: 部分结算保持 awaiting_tools
//
// 对任意 awaiting_tools 的 s（pending 长度 ≥ 2）与仅覆盖其 Pending 真子集（非空）
// 的 outcomes，applyToolResults(s, outcomes) 成功，新 status 仍为 awaiting_tools，
// 新 pendingCallIds 等于原 Pending 去除已结算 Call_Id 后的保序子序列（非空）。
// Validates: Requirements 5.6, 5.7

import fc from 'fast-check';
import { describe, it } from 'vitest';
import { applyToolResults } from './reducer';
import { arbitraryTurnStateAwaitingTools, arbitraryToolOutcomesSubset } from './arbitraries';

describe('Property 10: partial settlement remains in awaiting_tools', () => {
  it('succeeds, stays awaiting_tools, and keeps the order-preserving remainder', () => {
    fc.assert(
      fc.property(
        arbitraryTurnStateAwaitingTools
          .filter((s) => s.pendingCallIds.length >= 2)
          .chain((s) =>
            arbitraryToolOutcomesSubset(s.pendingCallIds).map((o) => ({ s, o })),
          ),
        ({ s, o }) => {
          const res = applyToolResults(s, o);
          if (!res.ok) return false;
          const settled = new Set(o.map((x) => x.callId));
          const expectedPending = s.pendingCallIds.filter((id) => !settled.has(id));
          const actual = res.state.pendingCallIds;
          const sameRemainder =
            actual.length === expectedPending.length &&
            actual.every((id, i) => id === expectedPending[i]);
          return (
            res.state.status === 'awaiting_tools' &&
            actual.length > 0 &&
            sameRemainder
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});
