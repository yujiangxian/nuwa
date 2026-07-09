// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: workflow-graph-model, Property 21: 一次报告全部违反规则
import { describe, it } from 'vitest';
import fc from 'fast-check';

import { validateGraph } from './validate';
import { ErrorCode, type WorkflowGraph } from './types';
import {
  addSecondIncomingEdge,
  arbitraryValidGraph,
  duplicateEdgeId,
  duplicateNodeId,
  flipRequiredFlag,
  type Mutator,
} from './arbitraries';

/**
 * A curated set of NON-conflicting, purely additive single-point mutators.
 * Each injects a distinct violation without disturbing the others, so applying
 * them in sequence produces several distinct Error_Codes at once.
 */
const INDEPENDENT_MUTATORS: readonly Mutator[] = [
  duplicateNodeId, // DUPLICATE_NODE_ID
  duplicateEdgeId, // DUPLICATE_EDGE_ID
  addSecondIncomingEdge, // INPUT_PORT_ARITY_EXCEEDED
  flipRequiredFlag, // MISSING_REQUIRED_INPUT
];

describe('Property 21: all violated rules are reported in a single pass', () => {
  it('injecting multiple distinct violations surfaces every corresponding Error_Code (no short-circuit)', () => {
    fc.assert(
      fc.property(arbitraryValidGraph({ minNodes: 2, maxNodes: 5 }), (g) => {
        let current: WorkflowGraph = g;
        const expected = new Set<ErrorCode>();
        for (const mutate of INDEPENDENT_MUTATORS) {
          const m = mutate(current);
          if (m === null) continue;
          current = m.graph;
          expected.add(m.code);
        }

        // We expect several distinct injected violations on a valid base graph.
        fc.pre(expected.size >= 2);

        const reported = new Set(validateGraph(current).errors.map((e) => e.code));
        for (const code of expected) {
          if (!reported.has(code)) return false;
        }
        return true;
      }),
      { numRuns: 100 },
    );
  });
});
