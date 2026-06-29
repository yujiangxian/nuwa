// Feature: workflow-graph-model, Property 26: 环提取序列相邻有边
import { describe, it } from 'vitest';
import fc from 'fast-check';

import { detectCycles } from './analyze';
import { forwardEdges } from './graph';
import { arbitraryWorkflowGraph } from './arbitraries';
import type { WorkflowGraph } from './types';

/** Independent acyclicity check over the forward subgraph (three-color DFS). */
function forwardSubgraphIsAcyclic(g: WorkflowGraph): boolean {
  const ids = new Set(g.nodes.map((n) => n.id));
  const adjacency = new Map<string, string[]>();
  for (const id of ids) adjacency.set(id, []);
  for (const e of forwardEdges(g)) {
    if (ids.has(e.source.nodeId) && ids.has(e.target.nodeId)) {
      adjacency.get(e.source.nodeId)!.push(e.target.nodeId);
    }
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const id of ids) color.set(id, WHITE);

  let acyclic = true;
  const visit = (u: string): void => {
    color.set(u, GRAY);
    for (const v of adjacency.get(u) ?? []) {
      const c = color.get(v);
      if (c === GRAY) {
        acyclic = false;
      } else if (c === WHITE) {
        visit(v);
      }
    }
    color.set(u, BLACK);
  };
  for (const id of ids) {
    if (color.get(id) === WHITE) visit(id);
  }
  return acyclic;
}

describe('Property 26: extracted cycles have adjacent forward edges', () => {
  it('each cycle (incl. wrap-around) is connected by forward edges; empty when the forward subgraph is acyclic', () => {
    fc.assert(
      fc.property(arbitraryWorkflowGraph(), (g) => {
        const cycles = detectCycles(g);

        // Forward-edge node-pair set for adjacency checks.
        const ids = new Set(g.nodes.map((n) => n.id));
        const forwardPairs = new Set<string>();
        for (const e of forwardEdges(g)) {
          if (ids.has(e.source.nodeId) && ids.has(e.target.nodeId)) {
            forwardPairs.add(`${e.source.nodeId}\u0000${e.target.nodeId}`);
          }
        }

        // Every adjacent pair in each cycle (including the wrap-around) has a forward edge.
        for (const cycle of cycles) {
          if (cycle.length === 0) return false;
          for (let i = 0; i < cycle.length; i++) {
            const u = cycle[i];
            const v = cycle[(i + 1) % cycle.length];
            if (!forwardPairs.has(`${u}\u0000${v}`)) return false;
          }
        }

        // No cycles when the forward subgraph is acyclic.
        if (forwardSubgraphIsAcyclic(g) && cycles.length !== 0) return false;

        return true;
      }),
      { numRuns: 100 },
    );
  });
});
