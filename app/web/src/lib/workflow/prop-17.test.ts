// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: workflow-graph-model, Property 17: 前向子图有环必检出且环序列合法
import { describe, it } from 'vitest';
import fc from 'fast-check';

import { validateGraph } from './validate';
import { ErrorCode } from './types';
import { forwardEdges } from './graph';
import { arbitraryValidGraph, introduceForwardCycle } from './arbitraries';

describe('Property 17: forward-subgraph cycle is detected with a legal cycle sequence', () => {
  it('a forward cycle yields CYCLE_IN_FORWARD_SUBGRAPH whose reported sequence has a forward edge between each adjacent pair (incl. wrap-around)', () => {
    fc.assert(
      fc.property(arbitraryValidGraph({ minNodes: 2, maxNodes: 5 }), (g) => {
        const mutation = introduceForwardCycle(g);
        fc.pre(mutation !== null);
        const mutated = (mutation as { graph: typeof g }).graph;

        const cycleError = validateGraph(mutated).errors.find(
          (e) => e.code === ErrorCode.CYCLE_IN_FORWARD_SUBGRAPH,
        );
        if (cycleError === undefined) return false;

        const cycle = cycleError.location.cycle ?? [];
        if (cycle.length < 2) return false;

        // Every adjacent pair, including the wrap-around (last -> first), must
        // correspond to a forward edge in the mutated graph's forward subgraph.
        const forwardPairs = new Set(
          forwardEdges(mutated).map((e) => `${e.source.nodeId}->${e.target.nodeId}`),
        );
        for (let i = 0; i < cycle.length; i++) {
          const from = cycle[i];
          const to = cycle[(i + 1) % cycle.length];
          if (!forwardPairs.has(`${from}->${to}`)) return false;
        }

        return true;
      }),
      { numRuns: 100 },
    );
  });
});
