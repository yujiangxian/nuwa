// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: workflow-execution-engine, Property 11: 节点执行次数受循环上界约束
//
// Over a run, a node belonging to a LoopScope body is invoked at most maxIterations
// times, a node outside any loop body at most once, and (for nested scopes) at most
// the product of the enclosing maxIterations. A `Completed` node is never re-invoked
// beyond that bound. Validates: Requirements 9.1, 9.2, 9.3, 9.4.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import type { JsonValue, WorkflowGraph } from '../types';
import type { ExecutionEnvironment, NodeExecutorRegistry } from './index';
import { T_JSON } from '../portType';
import { validateGraph } from '../validate';
import { initialState, run } from './index';
import { recordingRegistry } from './arbitraries';

const SCOPE_ID = 's0';

/** entry --> loopHeader ; header.body_in --> body --(back)--> header ; header.exit --> after */
function buildLoopGraph(maxIterations: number): WorkflowGraph {
  return {
    entryNodeId: 'entry',
    loopScopes: [{ id: SCOPE_ID, headerNodeId: 'loopHeader', bodyNodeIds: ['body'] }],
    nodes: [
      {
        id: 'entry',
        type: 'transform',
        config: null,
        inputs: [],
        outputs: [{ id: 'out', direction: 'output', portType: T_JSON, required: false }],
      },
      {
        id: 'loopHeader',
        type: 'loop',
        config: { maxIterations },
        inputs: [
          { id: 'in_main', direction: 'input', portType: T_JSON, required: false },
          { id: 'back', direction: 'input', portType: T_JSON, required: false },
        ],
        outputs: [
          { id: 'body_in', direction: 'output', portType: T_JSON, required: false },
          { id: 'exit', direction: 'output', portType: T_JSON, required: false },
        ],
      },
      {
        id: 'body',
        type: 'transform',
        config: null,
        inputs: [{ id: 'in', direction: 'input', portType: T_JSON, required: true }],
        outputs: [{ id: 'out', direction: 'output', portType: T_JSON, required: false }],
      },
      {
        id: 'after',
        type: 'transform',
        config: null,
        inputs: [{ id: 'in', direction: 'input', portType: T_JSON, required: true }],
        outputs: [{ id: 'out', direction: 'output', portType: T_JSON, required: false }],
      },
    ],
    edges: [
      { id: 'e0', source: { nodeId: 'entry', portId: 'out' }, target: { nodeId: 'loopHeader', portId: 'in_main' } },
      { id: 'e1', source: { nodeId: 'loopHeader', portId: 'body_in' }, target: { nodeId: 'body', portId: 'in' } },
      { id: 'e2', source: { nodeId: 'body', portId: 'out' }, target: { nodeId: 'loopHeader', portId: 'back' } },
      { id: 'e3', source: { nodeId: 'loopHeader', portId: 'exit' }, target: { nodeId: 'after', portId: 'in' } },
    ],
  };
}

/** A deterministic success executor for the ordinary (transform) nodes. */
function baseRegistry(): NodeExecutorRegistry {
  const byType = new Map();
  byType.set('transform', (node: { id: string; outputs: readonly { id: string }[] }) => {
    const outputs = new Map<string, JsonValue>();
    for (const port of node.outputs) outputs.set(port.id, { from: node.id });
    return { ok: true, outputs };
  });
  return { byType };
}

describe('Property 11: per-node execution count is bounded by the loop upper bound', () => {
  it('the constructed loop graphs are valid', () => {
    for (const max of [1, 2, 3, 4]) {
      expect(validateGraph(buildLoopGraph(max)).valid).toBe(true);
    }
  });

  it('loop-body nodes run <= maxIterations times; non-loop nodes run <= once', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 4 }),
        fc.boolean(), // breakValue: false iterates to the max, true exits immediately
        (maxIterations, breakValue) => {
          const graph = buildLoopGraph(maxIterations);
          const rec = recordingRegistry(baseRegistry());
          const env: ExecutionEnvironment = {
            executorRegistry: rec.registry,
            conditionEvaluator: () => ({ ok: true, value: breakValue }),
            humanInputProvider: () => undefined,
            errorPolicy: 'block_downstream',
          };

          const init = initialState(graph);
          if (!init.ok) return false;
          const outcome = run(init.state, graph, env);
          if (!outcome.ok) return false;

          const counts = new Map<string, number>();
          for (const call of rec.calls()) {
            counts.set(call.nodeId, (counts.get(call.nodeId) ?? 0) + 1);
          }

          const bodyCalls = counts.get('body') ?? 0;
          const entryCalls = counts.get('entry') ?? 0;
          const afterCalls = counts.get('after') ?? 0;
          const headerCalls = counts.get('loopHeader') ?? 0;

          // Loop-body node bounded by maxIterations; non-loop nodes by 1; the loop
          // header is not executor-driven, so it is never invoked.
          if (bodyCalls > maxIterations) return false;
          if (entryCalls > 1) return false;
          if (afterCalls > 1) return false;
          if (headerCalls !== 0) return false;

          // Exact counts: break=false runs the body exactly maxIterations times; the
          // break=true case exits before the body ever runs.
          if (breakValue) return bodyCalls === 0;
          return bodyCalls === maxIterations;
        },
      ),
      { numRuns: 100 },
    );
    expect(true).toBe(true);
  });
});
