// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: workflow-execution-engine, Property 18: ExecutionState 序列化往返恒等
//
// Validates: Requirements 15.3, 15.4, 15.7
//
// Round-trip identity of canonical state serialization:
//  - deserializeState(serializeState(s)) succeeds and is semantically equal to `s`,
//    preserving all six components (Node_Status_Map, ValueStore incl. each Value_Key's
//    iterationIndex, Satisfied_Edge_Set, Loop_Counter_Map, RunStatus, Pending_Human_Input);
//  - for j = serializeState(s), serializeState(deserializeState(j).state) is byte-identical to j.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { serializeState, deserializeState, stateEquals } from './index';
import {
  arbitraryValidGraph,
  arbitraryExecutionEnvironment,
  arbitraryExecutionState,
} from './arbitraries';

describe('Property 18: ExecutionState serialize round-trip identity', () => {
  it('deserialize∘serialize is semantic identity, and serialize∘deserialize is byte identity', () => {
    // A reachable, well-formed intermediate state under a deterministic environment.
    const arb = arbitraryValidGraph().chain((graph) =>
      arbitraryExecutionEnvironment(graph).chain((env) =>
        arbitraryExecutionState(graph, env),
      ),
    );

    fc.assert(
      fc.property(arb, (state) => {
        const j = serializeState(state);
        const result = deserializeState(j);

        // The round-trip must succeed (a canonical string is always well-formed).
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        // Semantic equality: every component is preserved across the round-trip.
        expect(stateEquals(result.state, state)).toBe(true);

        // Re-serializing the restored state reproduces the exact same canonical string.
        expect(serializeState(result.state)).toBe(j);
      }),
      { numRuns: 100 },
    );
  });
});
