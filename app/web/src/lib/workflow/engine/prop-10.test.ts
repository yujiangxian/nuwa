// Feature: workflow-execution-engine, Property 10: 循环计数有界单调
//
// For a Valid_Graph with a LoopScope, the LoopCounter starts at 0, is monotonically
// non-decreasing, increases by at most 1 per step, and never exceeds the loop's
// maxIterations. When the break condition is true (or the counter reaches the max)
// the loop exits through its `exit` port and opens no further iteration.
// Validates: Requirements 8.1, 8.3, 8.4, 8.6.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import type { WorkflowGraph, WorkflowNode, NodeType } from '../types';
import type { ExecutionEnvironment, NodeExecutor } from './index';
import { T_JSON } from '../portType';
import { validateGraph } from '../validate';
import { initialState, step } from './index';

const SCOPE_ID = 's0';
const E_EXIT = 'e_exit';

/**
 * entry --> loopHeader.in_main ; loopHeader.body_in --> body ;
 * body --(back-edge)--> loopHeader.back ; loopHeader.exit --> after
 * The header carries { maxIterations } in its opaque config.
 */
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
      { id: E_EXIT, source: { nodeId: 'loopHeader', portId: 'exit' }, target: { nodeId: 'after', portId: 'in' } },
    ],
  };
}

describe('Property 10: loop counter is bounded and monotone', () => {
  it('the constructed loop graphs are valid', () => {
    for (const max of [1, 2, 3, 4]) {
      expect(validateGraph(buildLoopGraph(max)).valid).toBe(true);
    }
  });

  it('the loop counter is 0-based, non-decreasing, +1 per round, and <= maxIterations', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 4 }),
        fc.boolean(), // breakValue: true -> exit immediately; false -> iterate to the max
        (maxIterations, breakValue) => {
          const graph = buildLoopGraph(maxIterations);
          // A deterministic success executor for the ordinary (transform) nodes.
          const transformExecutor: NodeExecutor = (node: WorkflowNode) => {
            const outputs = new Map();
            for (const port of node.outputs) outputs.set(port.id, { from: node.id });
            return { ok: true, outputs };
          };
          const env: ExecutionEnvironment = {
            // body/after resolve via the transform executor registered below.
            executorRegistry: {
              byType: new Map<NodeType, NodeExecutor>([['transform', transformExecutor]]),
            },
            conditionEvaluator: () => ({ ok: true, value: breakValue }),
            humanInputProvider: () => undefined,
            errorPolicy: 'block_downstream',
          };

          const init = initialState(graph);
          if (!init.ok) return false;

          const counters: number[] = [init.state.loopCounters.get(SCOPE_ID) ?? 0];
          let state = init.state;
          // Generous bound; the run converges far sooner.
          for (let i = 0; i < 200; i++) {
            if (
              state.runStatus === 'Completed' ||
              state.runStatus === 'Failed' ||
              state.runStatus === 'Paused'
            ) {
              break;
            }
            const out = step(state, graph, env);
            if (!out.ok) return false;
            state = out.result.state;
            counters.push(state.loopCounters.get(SCOPE_ID) ?? 0);
            if (!out.result.progress) break;
          }

          // Bounded & monotone counter trajectory.
          if (counters[0] !== 0) return false;
          for (let i = 1; i < counters.length; i++) {
            const delta = counters[i] - counters[i - 1];
            if (delta < 0 || delta > 1) return false;
            if (counters[i] > maxIterations) return false;
          }

          const final = state;
          // The run settled by exiting the loop through the `exit` port.
          if (final.runStatus !== 'Completed') return false;
          if (final.nodeStatus.get('loopHeader') !== 'Completed') return false;
          if (!final.satisfiedEdges.has(E_EXIT)) return false;

          const finalCounter = final.loopCounters.get(SCOPE_ID) ?? 0;
          // break=true exits at 0; break=false iterates until the max.
          return breakValue ? finalCounter === 0 : finalCounter === maxIterations;
        },
      ),
      { numRuns: 100 },
    );
    expect(true).toBe(true);
  });
});
