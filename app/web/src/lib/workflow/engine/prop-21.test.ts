// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: workflow-execution-engine, Property 21: step 与 run 一致性
//
// Validates: Requirements 16.3
//
// Manually looping `step` from the initial state until terminal/paused (bounded by
// `stepBudget`, exactly mirroring the run-to-completion driver) yields a final state that
// is semantically equal to the state returned by `run(s0, graph, env)`.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { initialState, step, run, stepBudget, stateEquals } from './index';
import { arbitraryValidGraph, arbitraryExecutionEnvironment } from './arbitraries';

describe('Property 21: step and run consistency', () => {
  it('manually looping step matches run() final state', () => {
    const arb = arbitraryValidGraph().chain((graph) =>
      arbitraryExecutionEnvironment(graph).map((env) => ({ graph, env })),
    );

    fc.assert(
      fc.property(arb, ({ graph, env }) => {
        const init = initialState(graph);
        expect(init.ok).toBe(true);
        if (!init.ok) return;
        const s0 = init.state;

        // Drive the engine by hand, one micro-step at a time, until the run settles.
        const budget = stepBudget(graph);
        let current = s0;
        let steps = 0;
        while (
          current.runStatus !== 'Completed' &&
          current.runStatus !== 'Failed' &&
          current.runStatus !== 'Paused' &&
          steps < budget
        ) {
          const outcome = step(current, graph, env);
          expect(outcome.ok).toBe(true);
          if (!outcome.ok) break;
          steps += 1;
          current = outcome.result.state;
          if (!outcome.result.progress) break; // converged: no further progress
        }

        const runOutcome = run(s0, graph, env);
        expect(runOutcome.ok).toBe(true);
        if (!runOutcome.ok) return;

        // The manual loop and the driver must reach semantically-equal final states.
        expect(stateEquals(current, runOutcome.result.state)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
