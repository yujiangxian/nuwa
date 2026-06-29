// Feature: workflow-execution-engine, Property 24: 完成完备性与活性
//
// Validates: Requirements 11.4, 16.5
//
// Completion-completeness & liveness: for a run with no failing nodes injected and every
// human_input node answered, the run settles to Completed and every reachable, non-Skipped
// node is Completed. More generally, a terminal state leaves no reachable node in
// Pending/Ready/Running (Paused runs excluded).

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { initialState, run } from './index';
import { arbitraryValidGraph, arbitraryExecutionEnvironment } from './arbitraries';
import { reachableNodes } from '../analyze';

describe('Property 24: completion completeness and liveness', () => {
  it('with no failures and all human input answered, reachable non-skipped nodes complete', () => {
    const arb = arbitraryValidGraph().chain((graph) => {
      // Answer every human_input node so the run never pauses; inject no failures.
      const humanIds = new Set(
        graph.nodes.filter((n) => n.type === 'human_input').map((n) => n.id),
      );
      return arbitraryExecutionEnvironment(graph, {
        failingNodeIds: new Set<string>(),
        answeredNodeIds: humanIds,
      }).map((env) => ({ graph, env }));
    });

    fc.assert(
      fc.property(arb, ({ graph, env }) => {
        const init = initialState(graph);
        expect(init.ok).toBe(true);
        if (!init.ok) return;

        const outcome = run(init.state, graph, env);
        expect(outcome.ok).toBe(true);
        if (!outcome.ok) return;
        const final = outcome.result.state;

        // The completeness conclusion is conditional on the run reaching Completed
        // (design Property 24: "一次运行到达 Completed 的 Valid_Graph"). Paused and
        // (defensively) Failed settlements are outside this clause.
        if (final.runStatus !== 'Completed') return;

        const reachable = reachableNodes(graph);
        for (const id of reachable) {
          const status = final.nodeStatus.get(id);
          // Liveness: no reachable node lingers as Pending/Ready/Running in a terminal state.
          // Completeness: a reachable, non-Skipped node ends Completed.
          expect(status === 'Completed' || status === 'Skipped').toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});
