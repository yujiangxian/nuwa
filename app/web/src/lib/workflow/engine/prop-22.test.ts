// Feature: workflow-execution-engine, Property 22: 环境外延确定性
//
// Validates: Requirements 16.2
//
// Two Execution_Environments whose injected functions (NodeExecutor registry,
// Condition_Evaluator, Human_Input_Provider) return the same result for the same input
// (extensional equality) produce field-equal final ExecutionStates on the same (s0, graph).
//
// We construct both environments deterministically from the same options: the second
// executor registry is built separately from `arbitraryNodeExecutorRegistry` with the same
// (default) options, and the evaluator / provider are wrapped in fresh closures that delegate
// to the first environment's pure functions — so the two environments are distinct objects
// with extensionally-equal injected functions.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import type { ExecutionEnvironment } from './index';
import { initialState, run, stateEquals } from './index';
import {
  arbitraryValidGraph,
  arbitraryExecutionEnvironment,
  arbitraryNodeExecutorRegistry,
} from './arbitraries';

describe('Property 22: environment extensional determinism', () => {
  it('two extensionally-equal environments yield field-equal final states', () => {
    const arb = arbitraryValidGraph().chain((graph) =>
      arbitraryExecutionEnvironment(graph).chain((env) =>
        // A second registry built with the SAME (default) options: its executors are
        // extensionally equal to env's (identical deterministic derivation).
        arbitraryNodeExecutorRegistry(graph).map((registry2) => ({ graph, env, registry2 })),
      ),
    );

    fc.assert(
      fc.property(arb, ({ graph, env, registry2 }) => {
        // A distinct environment object with extensionally-equal injected functions.
        const env2: ExecutionEnvironment = {
          executorRegistry: registry2,
          conditionEvaluator: (node, inputs) => env.conditionEvaluator(node, inputs),
          humanInputProvider: (node) => env.humanInputProvider(node),
          errorPolicy: env.errorPolicy,
        };

        const init = initialState(graph);
        expect(init.ok).toBe(true);
        if (!init.ok) return;

        const r1 = run(init.state, graph, env);
        const r2 = run(init.state, graph, env2);
        expect(r1.ok).toBe(true);
        expect(r2.ok).toBe(true);
        if (!r1.ok || !r2.ok) return;

        // Extensional equality of the environment implies an identical final state.
        expect(stateEquals(r1.result.state, r2.result.state)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
