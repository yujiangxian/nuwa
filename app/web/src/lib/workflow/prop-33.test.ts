// Feature: workflow-graph-model, Property 33: remove∘add 往返恒等
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { addNode, addEdge, removeNode } from './mutate';
import type { WorkflowGraph } from './types';
import { graphEquals } from './graph';
import { arbitraryValidGraph } from './arbitraries';

describe('Property 33: remove then re-add round-trips to the original', () => {
  it('removeNode(n) then re-adding n and its original incident edges yields graphEquals original', () => {
    fc.assert(
      fc.property(arbitraryValidGraph(), fc.nat(), (g, idx) => {
        const original = g.nodes[idx % g.nodes.length];
        // The edges that removeNode will cascade away (incident on either endpoint).
        const incidentEdges = g.edges.filter(
          (e) => e.source.nodeId === original.id || e.target.nodeId === original.id,
        );

        // Remove the node (and its incident edges).
        const removed = removeNode(g, original.id);
        expect(removed.ok).toBe(true);
        if (!removed.ok) return;

        // Re-add the exact same node.
        const readded = addNode(removed.graph, original);
        expect(readded.ok).toBe(true);
        if (!readded.ok) return;

        // Re-add each of its original incident edges.
        let current: WorkflowGraph = readded.graph;
        for (const edge of incidentEdges) {
          const r = addEdge(current, edge);
          expect(r.ok).toBe(true);
          if (!r.ok) return;
          current = r.graph;
        }

        // The reconstructed graph is semantically equal to the original.
        expect(graphEquals(current, g)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
