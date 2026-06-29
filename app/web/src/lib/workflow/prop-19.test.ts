// Feature: workflow-graph-model, Property 19: valid 与错误集互斥一致
import { describe, it } from 'vitest';
import fc from 'fast-check';

import { validateGraph } from './validate';
import { arbitraryWorkflowGraph } from './arbitraries';

describe('Property 19: valid is consistent with the error set', () => {
  it('validateGraph(g).valid === (errors.length === 0)', () => {
    fc.assert(
      fc.property(arbitraryWorkflowGraph(), (g) => {
        const result = validateGraph(g);
        return result.valid === (result.errors.length === 0);
      }),
      { numRuns: 100 },
    );
  });
});
