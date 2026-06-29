// Feature: agent-definition-registry, Property 8: 列举顺序、长度与确定性
import { describe, it } from 'vitest';
import fc from 'fast-check';
import { listAgents, size } from './registry';
import { agentEquals } from './normalize';
import { arbitraryRegistry } from './arbitraries';

describe('Property 8: listing order, length and determinism', () => {
  it('lists agents in ascending Agent_Id order, with length === size and distinct ids, deterministically', () => {
    // **Validates: Requirements 9.2, 9.5, 9.6**
    fc.assert(
      fc.property(arbitraryRegistry, (r) => {
        const first = listAgents(r);
        const ids = first.map((a) => a.id);

        // Length equals size(r).
        if (first.length !== size(r)) return false;

        // Ids are in non-descending UTF-16 lexicographic order and pairwise distinct.
        for (let i = 0; i + 1 < ids.length; i++) {
          if (!(ids[i] <= ids[i + 1])) return false; // non-descending
          if (ids[i] === ids[i + 1]) return false; // pairwise distinct (strictly increasing)
        }

        // Determinism: a second call returns an element-by-element equal list.
        const second = listAgents(r);
        if (second.length !== first.length) return false;
        for (let i = 0; i < first.length; i++) {
          if (!agentEquals(first[i], second[i])) return false;
        }
        return true;
      }),
      { numRuns: 100 }
    );
  });
});
