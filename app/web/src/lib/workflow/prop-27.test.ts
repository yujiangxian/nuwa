// Feature: workflow-graph-model, Property 27: 关键路径连通且最大
import { describe, it } from 'vitest';
import fc from 'fast-check';

import { criticalPath, reachableNodes } from './analyze';
import { forwardEdges, forwardAdjacency } from './graph';
import { arbitraryValidGraph } from './arbitraries';
import type { WorkflowGraph } from './types';

/**
 * Compute, via memoized DFS over the (acyclic) forward subgraph restricted to
 * reachable nodes, the node count of the longest forward path starting from the
 * EntryNode. The forward subgraph of a valid graph is acyclic, so the recursion
 * terminates.
 */
function longestForwardPathNodeCount(g: WorkflowGraph): number {
  if (g.entryNodeId === null) return 0;
  const reachable = reachableNodes(g);
  if (!reachable.has(g.entryNodeId)) return 0;

  const adjacency = forwardAdjacency(g);
  const memo = new Map<string, number>();

  const longest = (u: string): number => {
    const cached = memo.get(u);
    if (cached !== undefined) return cached;
    let best = 1; // the node itself
    for (const v of adjacency.get(u) ?? []) {
      if (!reachable.has(v)) continue;
      const candidate = 1 + longest(v);
      if (candidate > best) best = candidate;
    }
    memo.set(u, best);
    return best;
  };

  return longest(g.entryNodeId);
}

describe('Property 27: critical path is connected and maximal', () => {
  it('adjacent ids share forward edges and its node count is no smaller than any forward path from the entry', () => {
    fc.assert(
      fc.property(arbitraryValidGraph(), (g) => {
        const path = criticalPath(g);

        // A valid graph always has a reachable entry, so the path is non-empty.
        if (path.length === 0) return false;
        if (path[0] !== g.entryNodeId) return false;

        // Adjacent node ids are connected by a forward edge.
        const ids = new Set(g.nodes.map((n) => n.id));
        const forwardPairs = new Set<string>();
        for (const e of forwardEdges(g)) {
          if (ids.has(e.source.nodeId) && ids.has(e.target.nodeId)) {
            forwardPairs.add(`${e.source.nodeId}\u0000${e.target.nodeId}`);
          }
        }
        for (let i = 0; i + 1 < path.length; i++) {
          if (!forwardPairs.has(`${path[i]}\u0000${path[i + 1]}`)) return false;
        }

        // Maximality: the critical path's node count is at least the longest forward
        // path from the entry (and, being itself such a path, therefore equal to it).
        const longest = longestForwardPathNodeCount(g);
        if (!(path.length >= longest)) return false;

        return true;
      }),
      { numRuns: 100 },
    );
  });
});
