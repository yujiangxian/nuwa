// Feature: workflow-execution-engine, Property 9: 跳过排他性且不执行被跳过节点
//
// For a Valid_Graph with a `condition` branch, after the condition is executed the
// node reachable ONLY through the untaken branch is marked `Skipped`, a node also
// reachable through a live (satisfied) path is NOT skipped, and the engine never
// invokes a NodeExecutor on any `Skipped` node.
// Validates: Requirements 7.4, 7.5, 7.7.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import type { WorkflowGraph } from '../types';
import type { ExecutionEnvironment } from './index';
import { T_BOOLEAN, T_JSON } from '../portType';
import { validateGraph } from '../validate';
import { initialState, run } from './index';
import { arbitraryNodeExecutorRegistry, recordingRegistry } from './arbitraries';

/**
 * entry --> cond ; cond.true --> nodeT ; cond.false --> nodeF ;
 * nodeT --> join.t_in ; nodeF --> join.f_in
 * The branch targets have required inputs (so they stay Pending until routed and
 * thus get skipped on the untaken side); the join is reachable via either branch,
 * so it must never be skipped.
 */
function buildBranchGraph(): WorkflowGraph {
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
      {
        id: 'join',
        type: 'transform',
        config: null,
        inputs: [
          { id: 't_in', direction: 'input', portType: T_JSON, required: false },
          { id: 'f_in', direction: 'input', portType: T_JSON, required: false },
        ],
        outputs: [{ id: 'out', direction: 'output', portType: T_JSON, required: false }],
      },
    ],
    edges: [
      { id: 'e0', source: { nodeId: 'entry', portId: 'out' }, target: { nodeId: 'cond', portId: 'in' } },
      { id: 'e1', source: { nodeId: 'cond', portId: 'true' }, target: { nodeId: 'nodeT', portId: 'in' } },
      { id: 'e2', source: { nodeId: 'cond', portId: 'false' }, target: { nodeId: 'nodeF', portId: 'in' } },
      { id: 'e3', source: { nodeId: 'nodeT', portId: 'out' }, target: { nodeId: 'join', portId: 't_in' } },
      { id: 'e4', source: { nodeId: 'nodeF', portId: 'out' }, target: { nodeId: 'join', portId: 'f_in' } },
    ],
  };
}

const branchGraph = buildBranchGraph();

describe('Property 9: skip exclusivity and no execution of skipped nodes', () => {
  it('the constructed branch graph is valid', () => {
    expect(validateGraph(branchGraph).valid).toBe(true);
  });

  it('only the exclusively-untaken node is skipped and skipped nodes are never invoked', () => {
    fc.assert(
      fc.property(fc.boolean(), arbitraryNodeExecutorRegistry(branchGraph), (b, registry) => {
        const rec = recordingRegistry(registry);
        const env: ExecutionEnvironment = {
          executorRegistry: rec.registry,
          conditionEvaluator: () => ({ ok: true, value: b }),
          humanInputProvider: () => undefined,
          errorPolicy: 'block_downstream',
        };

        const init = initialState(branchGraph);
        if (!init.ok) return false;
        const outcome = run(init.state, branchGraph, env);
        if (!outcome.ok) return false;
        const final = outcome.result.state;

        const skippedId = b ? 'nodeF' : 'nodeT';
        const liveId = b ? 'nodeT' : 'nodeF';

        // The exclusively-untaken node is Skipped; the live branch node Completed.
        if (final.nodeStatus.get(skippedId) !== 'Skipped') return false;
        if (final.nodeStatus.get(liveId) !== 'Completed') return false;
        // The join, reachable via the live path, is not skipped.
        if (final.nodeStatus.get('join') === 'Skipped') return false;
        // No executor invocation on the skipped node.
        if (rec.calls().some((c) => c.nodeId === skippedId)) return false;

        return true;
      }),
      { numRuns: 100 },
    );
  });
});
