// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: workflow-graph-model, Property 22: 拓扑序覆盖且尊重边
import { describe, it } from 'vitest';
import fc from 'fast-check';

import { topologicalOrder } from './analyze';
import { forwardEdges } from './graph';
import { arbitraryValidGraph } from './arbitraries';

describe('Property 22: topological order covers nodes and respects edges', () => {
  it('contains each forward-subgraph node exactly once and orders every forward edge u->v with index(u) < index(v)', () => {
    fc.assert(
      fc.property(arbitraryValidGraph(), (g) => {
        const order = topologicalOrder(g);

        // The forward subgraph nodes are exactly all node ids (unique in a valid graph).
        const nodeIds = g.nodes.map((n) => n.id);

        // Coverage: every node appears exactly once.
        if (order.length !== nodeIds.length) return false;
        const orderSet = new Set(order);
        if (orderSet.size !== order.length) return false; // no duplicates
        for (const id of nodeIds) {
          if (!orderSet.has(id)) return false;
        }

        // Edge respect: for each forward edge u->v, index(u) < index(v).
        const indexOf = new Map<string, number>();
        order.forEach((id, i) => indexOf.set(id, i));
        for (const e of forwardEdges(g)) {
          const iu = indexOf.get(e.source.nodeId);
          const iv = indexOf.get(e.target.nodeId);
          if (iu === undefined || iv === undefined) return false;
          if (!(iu < iv)) return false;
        }

        return true;
      }),
      { numRuns: 100 },
    );
  });
});
