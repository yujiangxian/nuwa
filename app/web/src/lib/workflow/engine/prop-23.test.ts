// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: workflow-execution-engine, Property 23: 运行状态机一致性不变量
//
// Validates: Requirements 4.2, 17.2, 17.3, 17.4, 17.5, 17.6
//
// Every ExecutionState produced by step/run satisfies the §17 run-status-machine
// consistency invariants:
//  - every node has exactly one ExecutionStatus from the 7-value set (exhaustive + exclusive);
//  - the Satisfied_Edge_Set contains only edges whose source node is Completed;
//  - RunStatus=Completed => no Ready/Running node;
//  - RunStatus=Failed    => at least one Failed node;
//  - RunStatus=Paused    => Pending_Human_Input is non-null and points to a human_input node.
//
// `checkRunStatusInvariants` encodes exactly these checks; it lives in `./state`.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  arbitraryValidGraph,
  arbitraryExecutionEnvironment,
  arbitraryExecutionState,
} from './arbitraries';
import { checkRunStatusInvariants } from './state';

describe('Property 23: run-status-machine consistency invariants', () => {
  it('every reachable ExecutionState satisfies the §17 invariants', () => {
    const arb = arbitraryValidGraph().chain((graph) =>
      arbitraryExecutionEnvironment(graph).chain((env) =>
        arbitraryExecutionState(graph, env).map((state) => ({ graph, state })),
      ),
    );

    fc.assert(
      fc.property(arb, ({ graph, state }) => {
        expect(checkRunStatusInvariants(graph, state)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
