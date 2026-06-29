// Feature: workflow-execution-engine, Property 3: initialState 形状与 Idle 不变量
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { initialState, stateEquals } from './index';
import { arbitraryValidGraph } from './arbitraries';

const arb = arbitraryValidGraph({ minNodes: 1, maxNodes: 5 });

describe('Property 3: initialState shape and Idle invariants', () => {
  it('builds a well-formed Idle state with entry Ready / others Pending, deterministically', () => {
    fc.assert(
      fc.property(arb, (graph) => {
        const init = initialState(graph);
        expect(init.ok).toBe(true);
        if (!init.ok) return;
        const s = init.state;

        // Idle run-status and empty value/edge sets.
        expect(s.runStatus).toBe('Idle');
        expect(s.valueStore.size).toBe(0);
        expect(s.satisfiedEdges.size).toBe(0);
        expect(s.pendingHumanInput).toBe(null);

        // Exactly one LoopCounter per declared LoopScope, all zero.
        expect(s.loopCounters.size).toBe(graph.loopScopes.length);
        for (const scope of graph.loopScopes) {
          expect(s.loopCounters.get(scope.id)).toBe(0);
        }

        // Node_Status_Map: exactly one entry per node; entry Ready, the rest Pending.
        expect(s.nodeStatus.size).toBe(graph.nodes.length);
        for (const node of graph.nodes) {
          const status = s.nodeStatus.get(node.id);
          if (node.id === graph.entryNodeId) {
            expect(status).toBe('Ready');
          } else {
            expect(status).toBe('Pending');
          }
        }

        // No node is Completed in the initial state.
        for (const status of s.nodeStatus.values()) {
          expect(status).not.toBe('Completed');
        }

        // Determinism: repeated construction is field-equal.
        const again = initialState(graph);
        expect(again.ok).toBe(true);
        if (!again.ok) return;
        expect(stateEquals(s, again.state)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
