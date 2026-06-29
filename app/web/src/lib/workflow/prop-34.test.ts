// Feature: workflow-graph-model, Property 34: 序列化往返语义恒等
import { describe, it } from 'vitest';
import fc from 'fast-check';

import { serialize, deserialize } from './serialize';
import { graphEquals } from './graph';
import { arbitraryValidGraph } from './arbitraries';

describe('Property 34: serialization round-trip preserves semantics', () => {
  it('deserialize(serialize(g)) succeeds and is semantically equal to g', () => {
    fc.assert(
      fc.property(arbitraryValidGraph({ minNodes: 0, maxNodes: 5 }), (g) => {
        // Round-trip through the canonical string form.
        const result = deserialize(serialize(g));
        if (!result.ok) {
          return false;
        }
        // Semantic equality ignores array/port/config-key order while still
        // preserving every node, edge, loop scope, the entry marker, and each
        // port's PortType and `required` flag (R18.3, R18.7).
        return graphEquals(result.graph, g);
      }),
      { numRuns: 100 },
    );
  });
});
