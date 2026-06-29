// Feature: agent-turn-reducer, Property 15: 推进保持 Transcript 良构

import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { initialTurnState, applyModelResponse, applyToolResults } from './reducer';
import { validateTranscript } from '../messages/validate';
import { arbitraryTranscript } from '../messages/arbitraries';
import { arbitraryModelResponseWithTools, arbitraryToolOutcomesFull } from './arbitraries';

// Validates: Requirements 7.5
describe('Property 15: 推进保持 Transcript 良构', () => {
  it('从初始状态经 applyModelResponse → applyToolResults 推进后，transcript 在 validateTranscript 下仍良构', () => {
    fc.assert(
      fc.property(
        arbitraryTranscript.chain((t) =>
          arbitraryModelResponseWithTools(t).chain((r) => {
            const s0 = initialTurnState(t);
            const res1 = applyModelResponse(s0, r);
            const pending = res1.ok ? res1.state.pendingCallIds : [];
            return arbitraryToolOutcomesFull(pending).map((outcomes) => ({ t, r, outcomes }));
          }),
        ),
        ({ t, r, outcomes }) => {
          // Property precondition: t0 is well-formed, and the turn advances via
          // legal model responses (a Model_Response carries a non-empty message id).
          fc.pre(validateTranscript(t).valid);
          fc.pre(r.messageId !== '');

          const s0 = initialTurnState(t);
          const res1 = applyModelResponse(s0, r);
          fc.pre(res1.ok);
          if (!res1.ok) return;
          expect(validateTranscript(res1.state.transcript).valid).toBe(true);

          const res2 = applyToolResults(res1.state, outcomes);
          fc.pre(res2.ok);
          if (!res2.ok) return;
          expect(validateTranscript(res2.state.transcript).valid).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});
