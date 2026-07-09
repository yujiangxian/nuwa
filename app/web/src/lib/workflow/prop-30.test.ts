// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: workflow-graph-model, Property 30: removeNode 级联删除边
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { removeNode } from './mutate';
import { arbitraryValidGraph } from './arbitraries';

describe('Property 30: removeNode cascades edge removal', () => {
  it('result lacks the node and every edge incident to it', () => {
    fc.assert(
      fc.property(arbitraryValidGraph(), fc.nat(), (g, idx) => {
        const removedId = g.nodes[idx % g.nodes.length].id;
        const result = removeNode(g, removedId);
        expect(result.ok).toBe(true);
        if (result.ok) {
          const out = result.graph;
          // The node itself is gone.
          expect(out.nodes.some((n) => n.id === removedId)).toBe(false);
          // No remaining edge touches the removed node on either endpoint.
          expect(
            out.edges.some(
              (e) => e.source.nodeId === removedId || e.target.nodeId === removedId,
            ),
          ).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });
});
