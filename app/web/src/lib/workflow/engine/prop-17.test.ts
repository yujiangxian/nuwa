// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: workflow-execution-engine, Property 17: 错误处理确定性
//
// Validates: Requirements 14.6
//
// For any two runs whose injected NodeExecutor failure set is identical (and whose
// graph and env are otherwise the same), the engine produces field-wise equal final
// ExecutionStates — failure handling introduces no partiality or non-determinism.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { initialState, run, stateEquals } from './index';
import { arbitraryValidGraph, arbitraryExecutionEnvironment } from './arbitraries';

describe('Property 17: error handling determinism', () => {
  it('two runs with the same failing node set produce semantically-equal final states', () => {
    const arb = arbitraryValidGraph().chain((g) =>
      // Choose an arbitrary subset of node ids to fail deterministically.
      fc.subarray(g.nodes.map((n) => n.id)).chain((failing) =>
        arbitraryExecutionEnvironment(g, { failingNodeIds: new Set(failing) }).map((env) => ({
          g,
          env,
        })),
      ),
    );

    fc.assert(
      fc.property(arb, ({ g, env }) => {
        const init = initialState(g);
        expect(init.ok).toBe(true);
        if (!init.ok) return;

        // Same initial state, same graph, same env (same failure set) -> same outcome.
        const r1 = run(init.state, g, env);
        const r2 = run(init.state, g, env);
        expect(r1.ok).toBe(true);
        expect(r2.ok).toBe(true);
        if (!r1.ok || !r2.ok) return;

        expect(stateEquals(r1.result.state, r2.result.state)).toBe(true);
        expect(r1.result.steps).toBe(r2.result.steps);
      }),
      { numRuns: 100 },
    );
  });
});
