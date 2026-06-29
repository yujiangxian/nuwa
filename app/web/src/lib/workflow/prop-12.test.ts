// Feature: workflow-graph-model, Property 12: 悬空引用与自环必被检出
import { describe, it } from 'vitest';
import fc from 'fast-check';

import { validateGraph } from './validate';
import { ErrorCode } from './types';
import {
  arbitraryValidGraph,
  makeSelfLoopEdge,
  repointEdgeToMissingNode,
  repointEdgeToMissingPort,
} from './arbitraries';

describe('Property 12: dangling references and self-loops are always detected', () => {
  it('missing node -> EDGE_REFERENCES_MISSING_NODE; missing/wrong-direction port -> EDGE_REFERENCES_MISSING_PORT; self-loop -> SELF_LOOP_EDGE', () => {
    fc.assert(
      fc.property(arbitraryValidGraph({ minNodes: 2, maxNodes: 5 }), (g) => {
        const mNode = repointEdgeToMissingNode(g);
        if (mNode !== null) {
          const codes = validateGraph(mNode.graph).errors.map((e) => e.code);
          if (!codes.includes(ErrorCode.EDGE_REFERENCES_MISSING_NODE)) return false;
        }

        const mPort = repointEdgeToMissingPort(g);
        if (mPort !== null) {
          const codes = validateGraph(mPort.graph).errors.map((e) => e.code);
          if (!codes.includes(ErrorCode.EDGE_REFERENCES_MISSING_PORT)) return false;
        }

        const mSelf = makeSelfLoopEdge(g);
        if (mSelf !== null) {
          const codes = validateGraph(mSelf.graph).errors.map((e) => e.code);
          if (!codes.includes(ErrorCode.SELF_LOOP_EDGE)) return false;
        }

        return true;
      }),
      { numRuns: 100 },
    );
  });
});
