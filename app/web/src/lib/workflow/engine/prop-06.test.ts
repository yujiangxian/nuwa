// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: workflow-execution-engine, Property 6: Completed 节点输入完备
//
// For any ExecutionState produced by run() over a Valid_Graph, every `Completed`
// node must have, for each of its required Input_Ports, a produced value present
// in the ValueStore at that node's current iteration scope (base index 0 for a
// node outside any loop body). Validates: Requirements 5.2.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import type { WorkflowGraph } from '../types';
import type { ExecutionState } from './index';
import { getNode } from '../graph';
import { initialState, run, valueKeyToString } from './index';
import { arbitraryValidGraph, arbitraryExecutionEnvironment } from './arbitraries';

// --- Local replicas of the engine's iteration-scope helpers (key algorithm 4) ---
// These mirror the engine's internal logic so the test can assert the exact
// iteration scope a Completed node's inputs were stored under.

/** Read a loop header node's `maxIterations` from its opaque config; default 1. */
function maxIterationsOf(graph: WorkflowGraph, headerNodeId: string): number {
  const header = getNode(graph, headerNodeId);
  const config = header?.config;
  if (config !== null && typeof config === 'object' && !Array.isArray(config)) {
    const raw = (config as { readonly maxIterations?: unknown }).maxIterations;
    if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 1) return raw;
  }
  return 1;
}

/** Composite iteration-scope index of a node (innermost-first radix composition). */
function currentIterationIndex(
  graph: WorkflowGraph,
  state: ExecutionState,
  nodeId: string,
): number {
  const enclosing = graph.loopScopes.filter((s) => s.bodyNodeIds.includes(nodeId));
  if (enclosing.length === 0) return 0;
  const ordered = [...enclosing].sort((a, b) => a.bodyNodeIds.length - b.bodyNodeIds.length);
  let index = 0;
  let radix = 1;
  for (const scope of ordered) {
    const counter = state.loopCounters.get(scope.id) ?? 0;
    index += counter * radix;
    radix *= maxIterationsOf(graph, scope.headerNodeId);
  }
  return index;
}

describe('Property 6: Completed nodes have complete inputs', () => {
  it('every Completed node has all required inputs present in the ValueStore', () => {
    fc.assert(
      fc.property(
        arbitraryValidGraph({ minNodes: 1, maxNodes: 5 }).chain((graph) =>
          // Answer every human_input node so the run reaches a terminal status
          // rather than pausing.
          arbitraryExecutionEnvironment(graph, {
            answeredNodeIds: new Set(
              graph.nodes.filter((n) => n.type === 'human_input').map((n) => n.id),
            ),
          }).map((env) => ({ graph, env })),
        ),
        ({ graph, env }) => {
          const init = initialState(graph);
          if (!init.ok) return false; // arbitraryValidGraph is always valid

          const outcome = run(init.state, graph, env);
          if (!outcome.ok) return false;
          const final = outcome.result.state;

          for (const node of graph.nodes) {
            if (final.nodeStatus.get(node.id) !== 'Completed') continue;
            const idx = currentIterationIndex(graph, final, node.id);
            for (const port of node.inputs) {
              if (!port.required) continue;
              const keyStr = valueKeyToString({
                endpoint: { nodeId: node.id, portId: port.id },
                iterationIndex: idx,
              });
              if (!final.valueStore.has(keyStr)) return false;
            }
          }
          return true;
        },
      ),
      { numRuns: 100 },
    );
    expect(true).toBe(true);
  });
});
