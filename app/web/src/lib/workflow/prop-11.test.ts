// Feature: workflow-graph-model, Property 11: 重复 id 必被检出
import { describe, it } from 'vitest';
import fc from 'fast-check';

import { validateGraph } from './validate';
import { ErrorCode } from './types';
import { arbitraryValidGraph, duplicateEdgeId, duplicateNodeId } from './arbitraries';

describe('Property 11: duplicate ids are always detected', () => {
  it('duplicating a Node_Id yields DUPLICATE_NODE_ID; duplicating an Edge_Id yields DUPLICATE_EDGE_ID', () => {
    fc.assert(
      fc.property(arbitraryValidGraph({ minNodes: 2, maxNodes: 5 }), (g) => {
        // Duplicate node id (always applicable: at least one node exists).
        const mNode = duplicateNodeId(g);
        if (mNode !== null) {
          const codes = validateGraph(mNode.graph).errors.map((e) => e.code);
          if (!codes.includes(ErrorCode.DUPLICATE_NODE_ID)) return false;
        }

        // Duplicate edge id (a valid graph with >= 2 nodes always has >= 1 edge).
        const mEdge = duplicateEdgeId(g);
        if (mEdge !== null) {
          const codes = validateGraph(mEdge.graph).errors.map((e) => e.code);
          if (!codes.includes(ErrorCode.DUPLICATE_EDGE_ID)) return false;
        }

        return true;
      }),
      { numRuns: 100 },
    );
  });
});
