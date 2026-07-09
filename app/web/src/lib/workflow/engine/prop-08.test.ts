// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: workflow-execution-engine, Property 8: 条件分支按布尔路由
//
// For a Valid_Graph containing a `condition` node and a Condition_Evaluator that
// constantly returns boolean `b`, executing the condition adds the taken branch's
// outgoing edge to the Satisfied_Edge_Set and never adds the untaken branch's
// edge. Validates: Requirements 7.1, 7.2, 7.3.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import type { WorkflowGraph } from '../types';
import type { ExecutionEnvironment } from './index';
import { T_BOOLEAN, T_JSON } from '../portType';
import { validateGraph } from '../validate';
import { initialState, run } from './index';
import { arbitraryNodeExecutorRegistry } from './arbitraries';

const E_TRUE = 'e_true';
const E_FALSE = 'e_false';

/**
 * A small, explicitly-constructed valid graph:
 *   entry --out--> cond.in ; cond.true --> nodeT.in ; cond.false --> nodeF.in
 * The condition's true/false output ports match the engine's routing contract.
 */
function buildConditionGraph(): WorkflowGraph {
  return {
    entryNodeId: 'entry',
    loopScopes: [],
    nodes: [
      {
        id: 'entry',
        type: 'transform',
        config: null,
        inputs: [],
        outputs: [{ id: 'out', direction: 'output', portType: T_JSON, required: false }],
      },
      {
        id: 'cond',
        type: 'condition',
        config: null,
        inputs: [{ id: 'in', direction: 'input', portType: T_JSON, required: false }],
        outputs: [
          { id: 'true', direction: 'output', portType: T_BOOLEAN, required: false },
          { id: 'false', direction: 'output', portType: T_BOOLEAN, required: false },
        ],
      },
      {
        id: 'nodeT',
        type: 'transform',
        config: null,
        inputs: [{ id: 'in', direction: 'input', portType: T_JSON, required: true }],
        outputs: [{ id: 'out', direction: 'output', portType: T_JSON, required: false }],
      },
      {
        id: 'nodeF',
        type: 'transform',
        config: null,
        inputs: [{ id: 'in', direction: 'input', portType: T_JSON, required: true }],
        outputs: [{ id: 'out', direction: 'output', portType: T_JSON, required: false }],
      },
    ],
    edges: [
      { id: 'e0', source: { nodeId: 'entry', portId: 'out' }, target: { nodeId: 'cond', portId: 'in' } },
      { id: E_TRUE, source: { nodeId: 'cond', portId: 'true' }, target: { nodeId: 'nodeT', portId: 'in' } },
      { id: E_FALSE, source: { nodeId: 'cond', portId: 'false' }, target: { nodeId: 'nodeF', portId: 'in' } },
    ],
  };
}

const conditionGraph = buildConditionGraph();

describe('Property 8: condition branches route by boolean', () => {
  it('the constructed condition graph is valid', () => {
    expect(validateGraph(conditionGraph).valid).toBe(true);
  });

  it('the taken branch edge is satisfied and the untaken branch edge is not', () => {
    fc.assert(
      fc.property(fc.boolean(), arbitraryNodeExecutorRegistry(conditionGraph), (b, registry) => {
        const env: ExecutionEnvironment = {
          executorRegistry: registry,
          conditionEvaluator: () => ({ ok: true, value: b }),
          humanInputProvider: () => undefined,
          errorPolicy: 'block_downstream',
        };

        const init = initialState(conditionGraph);
        if (!init.ok) return false;
        const outcome = run(init.state, conditionGraph, env);
        if (!outcome.ok) return false;
        const final = outcome.result.state;

        const takenSatisfied = final.satisfiedEdges.has(b ? E_TRUE : E_FALSE);
        const untakenSatisfied = final.satisfiedEdges.has(b ? E_FALSE : E_TRUE);
        return takenSatisfied && !untakenSatisfied;
      }),
      { numRuns: 100 },
    );
  });
});
