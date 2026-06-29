// Feature: workflow-graph-model, Property 20: 校验确定且对输入顺序稳定
import { describe, it } from 'vitest';
import fc from 'fast-check';

import { validateGraph } from './validate';
import { arbitraryReorderedGraph, arbitraryWorkflowGraph } from './arbitraries';

describe('Property 20: validation is deterministic and stable under input ordering', () => {
  it('reordering nodes/edges/loopScopes yields an identical ValidationResult', () => {
    fc.assert(
      fc.property(
        arbitraryWorkflowGraph().chain((g) =>
          arbitraryReorderedGraph(g).map((reordered) => ({ g, reordered })),
        ),
        ({ g, reordered }) => {
          // Reordering arrays is only semantics-preserving when ids are unique
          // (duplicate node/edge/scope ids make array position meaningful via
          // last-wins indexing, so swapping them is a different graph).
          const uniq = (xs: readonly { id: string }[]) =>
            new Set(xs.map((x) => x.id)).size === xs.length;
          fc.pre(uniq(g.nodes) && uniq(g.edges) && uniq(g.loopScopes));
          // The full ValidationResult (valid flag + ordered error list) must be
          // byte-for-byte identical regardless of array ordering.
          return JSON.stringify(validateGraph(g)) === JSON.stringify(validateGraph(reordered));
        },
      ),
      { numRuns: 100 },
    );
  });
});
