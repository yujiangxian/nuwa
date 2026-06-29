// Feature: workflow-graph-model, Property 35: 规范字符串往返恒等
import { describe, it } from 'vitest';
import fc from 'fast-check';

import { serialize, deserialize } from './serialize';
import { arbitraryWorkflowGraph } from './arbitraries';

describe('Property 35: canonical-string round-trip is byte-identical', () => {
  it('serialize(deserialize(serialize(g)).graph) equals serialize(g) byte-for-byte', () => {
    fc.assert(
      fc.property(arbitraryWorkflowGraph(), (g) => {
        const j = serialize(g);
        const result = deserialize(j);
        if (!result.ok) {
          return false;
        }
        // Re-serializing the deserialized graph must reproduce the exact same
        // canonical string (R18.4).
        return serialize(result.graph) === j;
      }),
      { numRuns: 100 },
    );
  });
});
