// Feature: workflow-execution-engine, Property 1: 就绪选择的确定性
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import type { WorkflowGraph } from '../types';
import type { ExecutionState } from './index';
import { step, stateEquals } from './index';
import {
  arbitraryValidGraph,
  arbitraryExecutionEnvironment,
  arbitraryExecutionState,
  arbitraryReorderedState,
} from './arbitraries';
import { topologicalOrder } from '../analyze';

// Collect the Node_Ids of all 'Ready' nodes in a state (order-independent).
function readyIds(state: ExecutionState): readonly string[] {
  const ids: string[] = [];
  for (const [id, status] of state.nodeStatus) {
    if (status === 'Ready') ids.push(id);
  }
  return ids;
}

// Independently compute the (topologicalOrder position, Node_Id) minimal Ready node,
// mirroring the engine's documented Ready_Selection_Rule (R3.2–R3.4).
function ruleMinimalReady(graph: WorkflowGraph, state: ExecutionState): string | null {
  const ready = readyIds(state);
  if (ready.length === 0) return null;

  const order = topologicalOrder(graph);
  const pos = new Map<string, number>();
  order.forEach((id, index) => pos.set(id, index));

  let best: string | null = null;
  let bestPos = Number.POSITIVE_INFINITY;
  for (const id of ready) {
    const p = pos.get(id) ?? Number.POSITIVE_INFINITY;
    if (best === null || p < bestPos || (p === bestPos && id < best)) {
      best = id;
      bestPos = p;
    }
  }
  return best;
}

// Generate a reachable state together with an order-permuted equivalent of it.
const arb = arbitraryValidGraph({ minNodes: 1, maxNodes: 5 }).chain((graph) =>
  arbitraryExecutionEnvironment(graph).chain((env) =>
    arbitraryExecutionState(graph, env).chain((state) =>
      arbitraryReorderedState(state).map((reordered) => ({ graph, env, state, reordered })),
    ),
  ),
);

describe('Property 1: ready-selection determinism', () => {
  it('selects the (topoPos, id)-minimal Ready node, independent of container order', () => {
    fc.assert(
      fc.property(arb, ({ graph, env, state, reordered }) => {
        // Only meaningful while the run is actively advancing with a Ready node.
        fc.pre(
          state.runStatus !== 'Completed' &&
            state.runStatus !== 'Failed' &&
            state.runStatus !== 'Paused',
        );
        const expected = ruleMinimalReady(graph, state);
        fc.pre(expected !== null);

        const o1 = step(state, graph, env);
        const o2 = step(reordered, graph, env);
        expect(o1.ok).toBe(true);
        expect(o2.ok).toBe(true);
        if (!o1.ok || !o2.ok) return;

        // Determinism under permutation: permuting the internal container order of the
        // state must not change which node is selected, hence the resulting states match.
        expect(stateEquals(o1.result.state, o2.result.state)).toBe(true);

        // The rule-minimal node is the one that was acted upon: every node type either
        // transitions the selected node away from 'Ready', or (human_input with no
        // response) records it as the pending node while pausing.
        const after = o1.result.state;
        const actedOnExpected =
          after.nodeStatus.get(expected) !== 'Ready' || after.pendingHumanInput === expected;
        expect(actedOnExpected).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
