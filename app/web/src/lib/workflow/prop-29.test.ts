// Feature: workflow-graph-model, Property 29: addNode 语义
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { addNode } from './mutate';
import { ErrorCode } from './types';
import { arbitraryValidGraph, arbitraryWorkflowNode } from './arbitraries';

describe('Property 29: addNode semantics', () => {
  it('a fresh id succeeds and the result contains the node', () => {
    fc.assert(
      fc.property(arbitraryValidGraph(), arbitraryWorkflowNode(), (g, newNode) => {
        // Valid-graph ids look like `n_<hex>`; arbitraryWorkflowNode ids are 'a'..'d',
        // so `newNode.id` is guaranteed to be fresh relative to `g`.
        const result = addNode(g, newNode);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.graph.nodes.some((n) => n.id === newNode.id)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('an existing id is rejected with code DUPLICATE_NODE_ID', () => {
    fc.assert(
      fc.property(arbitraryValidGraph(), fc.nat(), (g, idx) => {
        // arbitraryValidGraph always yields at least one node.
        const existing = g.nodes[idx % g.nodes.length];
        const result = addNode(g, { ...existing });
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe(ErrorCode.DUPLICATE_NODE_ID);
        }
      }),
      { numRuns: 100 },
    );
  });
});
