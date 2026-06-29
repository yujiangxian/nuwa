// Feature: agent-turn-reducer, Property 9: 全部待决结算后转移到 awaiting_model
//
// 对任意 awaiting_tools 的 s（pending 非空）与恰覆盖其全部 Pending_Call_Ids 的
// outcomes，applyToolResults(s, outcomes) 成功，新 status 为 awaiting_model、
// pendingCallIds 为空，新 transcript 较输入多一条 role `tool` 的消息。
// Validates: Requirements 5.4, 5.5

import fc from 'fast-check';
import { describe, it } from 'vitest';
import { applyToolResults } from './reducer';
import { arbitraryTurnStateAwaitingTools, arbitraryToolOutcomesFull } from './arbitraries';

describe('Property 9: settling all pending calls transitions to awaiting_model', () => {
  it('succeeds, clears pending, and appends one tool message', () => {
    fc.assert(
      fc.property(
        arbitraryTurnStateAwaitingTools.chain((s) =>
          arbitraryToolOutcomesFull(s.pendingCallIds).map((o) => ({ s, o })),
        ),
        ({ s, o }) => {
          const res = applyToolResults(s, o);
          if (!res.ok) return false;
          const lastMessage =
            res.state.transcript.messages[res.state.transcript.messages.length - 1];
          return (
            res.state.status === 'awaiting_model' &&
            res.state.pendingCallIds.length === 0 &&
            res.state.transcript.messages.length === s.transcript.messages.length + 1 &&
            lastMessage.role === 'tool'
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});
