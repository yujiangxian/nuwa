// Feature: workflow-execution-engine, Property 4: 非法图被拒绝执行
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import type { ExecutionEnvironment } from './index';
import { initialState, step, run, ExecutorErrorCode } from './index';
import { arbitraryExecutionEnvironment, recordingRegistry } from './arbitraries';
import { arbitraryValidGraph, SINGLE_POINT_MUTATORS } from '../arbitraries';

// A valid graph, an environment, and one single-point mutator that breaks the graph.
const arb = arbitraryValidGraph({ minNodes: 1, maxNodes: 5 }).chain((graph) =>
  arbitraryExecutionEnvironment(graph).chain((env) =>
    fc.constantFrom(...SINGLE_POINT_MUTATORS).map((mutator) => ({ graph, env, mutator })),
  ),
);

describe('Property 4: invalid graphs are rejected before execution', () => {
  it('step / run / initialState return INVALID_GRAPH and execute no node', () => {
    fc.assert(
      fc.property(arb, ({ graph, env, mutator }) => {
        const mutation = mutator(graph);
        // Skip mutators whose precondition is not met for this graph.
        fc.pre(mutation !== null);
        if (mutation === null) return;
        const badGraph = mutation.graph;

        // initialState rejects the invalid graph without constructing a state.
        const init = initialState(badGraph);
        expect(init.ok).toBe(false);
        if (!init.ok) {
          expect(init.error.code).toBe(ExecutorErrorCode.INVALID_GRAPH);
        }

        // Feed step / run a well-formed state from the ORIGINAL valid graph; the engine
        // must still reject the invalid graph passed alongside it.
        const baseInit = initialState(graph);
        expect(baseInit.ok).toBe(true);
        if (!baseInit.ok) return;

        // Record executor calls to prove no node is executed on an invalid graph.
        const rec = recordingRegistry(env.executorRegistry);
        const env2: ExecutionEnvironment = { ...env, executorRegistry: rec.registry };

        const sOut = step(baseInit.state, badGraph, env2);
        expect(sOut.ok).toBe(false);
        if (!sOut.ok) expect(sOut.error.code).toBe(ExecutorErrorCode.INVALID_GRAPH);

        const rOut = run(baseInit.state, badGraph, env2);
        expect(rOut.ok).toBe(false);
        if (!rOut.ok) expect(rOut.error.code).toBe(ExecutorErrorCode.INVALID_GRAPH);

        // No NodeExecutor was ever invoked.
        expect(rec.calls().length).toBe(0);
      }),
      { numRuns: 100 },
    );
  });
});
