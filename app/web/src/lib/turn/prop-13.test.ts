// Feature: agent-turn-reducer, Property 13: 状态与待决集合一致

import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { initialTurnState, applyModelResponse, applyToolResults } from './reducer';
import { arbitraryTranscript } from '../messages/arbitraries';
import {
  arbitraryModelResponse,
  arbitraryTurnStateAwaitingTools,
  arbitraryToolOutcomesFull,
  arbitraryToolOutcomesSubset,
} from './arbitraries';

// Validates: Requirements 7.2, 7.4
describe('Property 13: 状态与待决集合一致', () => {
  it('applyModelResponse 成功所得新 state：awaiting_tools ⇔ pendingCallIds 非空，且 pending 无重复', () => {
    fc.assert(
      fc.property(
        arbitraryTranscript.chain((t) =>
          arbitraryModelResponse(t).map((r) => ({ t, r })),
        ),
        ({ t, r }) => {
          const res = applyModelResponse(initialTurnState(t), r);
          fc.pre(res.ok);
          if (!res.ok) return;
          const s = res.state;
          expect(s.status === 'awaiting_tools').toBe(s.pendingCallIds.length > 0);
          expect(new Set(s.pendingCallIds).size).toBe(s.pendingCallIds.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('applyToolResults 成功所得新 state：awaiting_tools ⇔ pendingCallIds 非空，且 pending 无重复', () => {
    fc.assert(
      fc.property(
        arbitraryTurnStateAwaitingTools.chain((s) =>
          fc
            .oneof(
              arbitraryToolOutcomesFull(s.pendingCallIds),
              arbitraryToolOutcomesSubset(s.pendingCallIds),
            )
            .map((outcomes) => ({ s, outcomes })),
        ),
        ({ s, outcomes }) => {
          const res = applyToolResults(s, outcomes);
          fc.pre(res.ok);
          if (!res.ok) return;
          const next = res.state;
          expect(next.status === 'awaiting_tools').toBe(next.pendingCallIds.length > 0);
          expect(new Set(next.pendingCallIds).size).toBe(next.pendingCallIds.length);
        },
      ),
      { numRuns: 100 },
    );
  });
});
