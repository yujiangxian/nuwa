// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: workflow-execution-engine, Property 19: 规范化序列化输出唯一
//
// Validates: Requirements 15.5
//
// Canonical-serialization uniqueness: two semantically-equal ExecutionStates (which may
// differ only in the internal Map/Set enumeration order) produce a byte-for-byte identical
// Canonical_State_Json. We obtain a semantically-equal sibling via `arbitraryReorderedState`,
// which permutes the internal container construction order while preserving meaning.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { serializeState } from './index';
import {
  arbitraryValidGraph,
  arbitraryExecutionEnvironment,
  arbitraryExecutionState,
  arbitraryReorderedState,
} from './arbitraries';

describe('Property 19: canonical serialization output is unique', () => {
  it('order-permuted, semantically-equal states serialize byte-for-byte identically', () => {
    const arb = arbitraryValidGraph().chain((graph) =>
      arbitraryExecutionEnvironment(graph).chain((env) =>
        arbitraryExecutionState(graph, env).chain((state) =>
          arbitraryReorderedState(state).map((reordered) => ({ state, reordered })),
        ),
      ),
    );

    fc.assert(
      fc.property(arb, ({ state, reordered }) => {
        // Different internal ordering, identical canonical output.
        expect(serializeState(reordered)).toBe(serializeState(state));
      }),
      { numRuns: 100 },
    );
  });
});
