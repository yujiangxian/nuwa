// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: workflow-graph-model, Property 24: 拓扑序确定唯一
import { describe, it } from 'vitest';
import fc from 'fast-check';

import { topologicalOrder } from './analyze';
import { arbitraryValidGraph, arbitraryReorderedGraph } from './arbitraries';

describe('Property 24: topological order is deterministic', () => {
  it('reordering the node/edge arrays yields an identical topological order', () => {
    fc.assert(
      fc.property(
        arbitraryValidGraph().chain((g) =>
          arbitraryReorderedGraph(g).map((reordered) => ({ g, reordered })),
        ),
        ({ g, reordered }) => {
          const a = topologicalOrder(g);
          const b = topologicalOrder(reordered);
          if (a.length !== b.length) return false;
          for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) return false;
          }
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });
});
