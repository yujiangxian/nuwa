// Feature: workflow-execution-engine, Property 2: 运行级确定性
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { initialState, run, stateEquals } from './index';
import type { ExecutionState, ExecutionEnvironment } from './index';
import type { WorkflowGraph } from '../types';
import {
  arbitraryValidGraph,
  arbitraryExecutionEnvironment,
  arbitraryReorderedState,
} from './arbitraries';

// The case shape produced by the composed arbitrary. `s0`/`reordered` are nullable
// to allow a defensive fall-back when a graph unexpectedly yields no initial state.
interface RunCase {
  readonly graph: WorkflowGraph;
  readonly env: ExecutionEnvironment;
  readonly s0: ExecutionState | null;
  readonly reordered: ExecutionState | null;
}

// A valid graph, an environment, the initial state and an order-permuted equivalent of it.
const arb = arbitraryValidGraph({ minNodes: 1, maxNodes: 5 }).chain((graph) =>
  arbitraryExecutionEnvironment(graph).chain((env): fc.Arbitrary<RunCase> => {
    const init = initialState(graph);
    // A valid graph always yields an initial state; fall back defensively otherwise.
    const s0 = init.ok ? init.state : null;
    if (s0 === null) return fc.constant({ graph, env, s0: null, reordered: null });
    return arbitraryReorderedState(s0).map((reordered) => ({ graph, env, s0, reordered }));
  }),
);

describe('Property 2: run-level determinism', () => {
  it('run produces field-equal final state and equal step count, order-independently', () => {
    fc.assert(
      fc.property(arb, ({ graph, env, s0, reordered }) => {
        fc.pre(s0 !== null && reordered !== null);
        if (s0 === null || reordered === null) return;

        // Same (s0, g, env): two runs agree on final state and step count.
        const r1 = run(s0, graph, env);
        const r2 = run(s0, graph, env);
        expect(r1.ok).toBe(true);
        expect(r2.ok).toBe(true);
        if (!r1.ok || !r2.ok) return;
        expect(stateEquals(r1.result.state, r2.result.state)).toBe(true);
        expect(r1.result.steps).toBe(r2.result.steps);

        // Independence from the incidental enumeration order of internal containers:
        // running from a semantically-equal but order-permuted initial state matches.
        const r3 = run(reordered, graph, env);
        expect(r3.ok).toBe(true);
        if (!r3.ok) return;
        expect(stateEquals(r1.result.state, r3.result.state)).toBe(true);
        expect(r1.result.steps).toBe(r3.result.steps);
      }),
      { numRuns: 100 },
    );
  });
});
