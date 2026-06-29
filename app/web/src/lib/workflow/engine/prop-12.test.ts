// Feature: workflow-execution-engine, Property 12: 终止性、步数有界与进展性
//
// Validates: Requirements 4.6, 11.1, 11.2, 11.3, 11.5
//
// For any Valid_Graph, initial ExecutionState and any env, `run` settles at a
// Terminal_Status or Paused within a finite number of steps that never exceeds
// `stepBudget(g)` (a static bound derived from the node count and each loop's
// maxIterations, independent of any clock). Additionally, every micro-step that
// reports `progress=true` actually changes the state (stateEquals is false before
// and after the step).

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { initialState, run, step, stepBudget, stateEquals } from './index';
import { arbitraryValidGraph, arbitraryExecutionEnvironment } from './arbitraries';

describe('Property 12: termination, bounded steps and progress', () => {
  it('run settles within stepBudget and every progressing step changes the state', () => {
    const arb = arbitraryValidGraph().chain((g) =>
      arbitraryExecutionEnvironment(g).map((env) => ({ g, env })),
    );

    fc.assert(
      fc.property(arb, ({ g, env }) => {
        const init = initialState(g);
        // A valid graph always yields a constructible initial state.
        expect(init.ok).toBe(true);
        if (!init.ok) return;

        const budget = stepBudget(g);

        // --- run terminates within the static step budget (R11.1, R11.2, R11.5) ---
        const outcome = run(init.state, g, env);
        expect(outcome.ok).toBe(true);
        if (!outcome.ok) return;

        const final = outcome.result.state;
        // The run must settle at a terminal status or pause (R11.1).
        expect(['Completed', 'Failed', 'Paused']).toContain(final.runStatus);
        // The applied step count is bounded by the defensive static budget (R11.2).
        expect(outcome.result.steps).toBeLessThanOrEqual(budget);

        // --- progress implies a genuine state change (R4.6, R11.3) ---
        let current = init.state;
        // Cap the manual loop defensively; `run` already proved the bound holds.
        for (let i = 0; i <= budget + 5; i++) {
          if (
            current.runStatus === 'Completed' ||
            current.runStatus === 'Failed' ||
            current.runStatus === 'Paused'
          ) {
            break;
          }
          const out = step(current, g, env);
          expect(out.ok).toBe(true);
          if (!out.ok) break;

          if (out.result.progress) {
            // A progressing step advances at least one node status or a loop counter,
            // so the resulting state must differ from the one before it (R11.3).
            expect(stateEquals(current, out.result.state)).toBe(false);
            current = out.result.state;
          } else {
            // No-progress convergence: the run cannot advance further.
            break;
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});
