// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: workflow-graph-model, Property 36: 规范化输出唯一
import { describe, it } from 'vitest';
import fc from 'fast-check';

import { serialize } from './serialize';
import { arbitraryValidGraph, arbitraryReorderedGraph } from './arbitraries';

describe('Property 36: canonical serialization is unique for equivalent graphs', () => {
  it('a reordered (semantically equal) graph serializes byte-for-byte identically', () => {
    fc.assert(
      fc.property(
        // A valid graph has unique node/edge/scope ids, so reordering its arrays
        // and shuffling its config keys yields a SEMANTICALLY EQUAL graph.
        arbitraryValidGraph({ minNodes: 0, maxNodes: 5 }).chain((g) =>
          arbitraryReorderedGraph(g).map((reordered) => ({ g, reordered })),
        ),
        ({ g, reordered }) => {
          // Canonicalization collapses the permutations, so both must produce
          // the exact same canonical string (R18.5).
          return serialize(reordered) === serialize(g);
        },
      ),
      { numRuns: 100 },
    );
  });
});
