// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: workflow-execution-engine, Property 20: 反序列化非法输入返回错误
//
// Validates: Requirements 15.6
//
// deserializeState must reject any input that is not a well-formed Canonical_State_Json
// (arbitrary strings, invalid JSON, missing fields, wrong types, unknown enums, negative
// counts, truncated strings) by returning an error result rather than constructing a state,
// and it must NEVER throw.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { serializeState, deserializeState } from './index';
import {
  arbitraryValidGraph,
  arbitraryExecutionEnvironment,
  arbitraryExecutionState,
} from './arbitraries';

describe('Property 20: deserialize rejects malformed input without throwing', () => {
  it('arbitrary strings and structurally-broken canonical JSON yield ok:false and never throw', () => {
    // Branch A: completely arbitrary strings (mostly invalid JSON, never a valid state).
    const arbAnyString = fc.string();

    // Branch B: a genuine canonical string deliberately broken in exactly one structural way.
    const arbBroken = arbitraryValidGraph()
      .chain((graph) =>
        arbitraryExecutionEnvironment(graph).chain((env) =>
          arbitraryExecutionState(graph, env).map((state) => serializeState(state)),
        ),
      )
      .chain((j) => {
        const obj = JSON.parse(j) as Record<string, unknown>;
        const broken: string[] = [];

        // (1) Each of the six top-level fields removed -> missing-field error.
        for (const field of [
          'nodeStatus',
          'valueStore',
          'satisfiedEdges',
          'loopCounters',
          'runStatus',
          'pendingHumanInput',
        ]) {
          const o = { ...obj };
          delete o[field];
          broken.push(JSON.stringify(o));
        }

        // (2) Wrong types for the array-shaped fields.
        broken.push(JSON.stringify({ ...obj, nodeStatus: 5 }));
        broken.push(JSON.stringify({ ...obj, valueStore: 'x' }));
        broken.push(JSON.stringify({ ...obj, satisfiedEdges: {} }));
        broken.push(JSON.stringify({ ...obj, loopCounters: true }));

        // (3) Unknown enum values.
        broken.push(JSON.stringify({ ...obj, runStatus: 'Bogus' }));
        broken.push(JSON.stringify({ ...obj, nodeStatus: [['n', 'NotAStatus']] }));

        // (4) Negative / non-integer counts.
        broken.push(JSON.stringify({ ...obj, loopCounters: [['s', -1]] }));
        broken.push(
          JSON.stringify({
            ...obj,
            valueStore: [{ key: { nodeId: 'a', portId: 'b', iterationIndex: -3 }, value: 1 }],
          }),
        );

        // (5) Value_Key missing a segment / missing value.
        broken.push(
          JSON.stringify({ ...obj, valueStore: [{ key: { nodeId: 'a', portId: 'b' }, value: 1 }] }),
        );
        broken.push(
          JSON.stringify({
            ...obj,
            valueStore: [{ key: { nodeId: 'a', portId: 'b', iterationIndex: 0 } }],
          }),
        );

        // (6) pendingHumanInput wrong type.
        broken.push(JSON.stringify({ ...obj, pendingHumanInput: 5 }));

        // (7) Truncated JSON (drop the final character -> unbalanced, invalid JSON).
        broken.push(j.slice(0, j.length - 1));

        return fc.constantFrom(...broken);
      });

    const arb = fc.oneof(arbAnyString, arbBroken);

    fc.assert(
      fc.property(arb, (input) => {
        let result: ReturnType<typeof deserializeState> | undefined;
        // It must never throw on any input.
        expect(() => {
          result = deserializeState(input);
        }).not.toThrow();
        // It must report a failure rather than constructing a state.
        expect(result?.ok).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
