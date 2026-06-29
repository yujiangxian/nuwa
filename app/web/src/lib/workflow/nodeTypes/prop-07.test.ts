// Feature: workflow-node-types, Property 7: 校验确定性
import { describe, it } from 'vitest';
import fc from 'fast-check';

import type { WorkflowNode } from '../types';
import { NODE_TYPES } from '../types';
import { validateNodeConfig } from './index';
import { arbitraryNodeOfType, arbitraryConfigMutation } from './arbitraries';

const arbAnyNode: fc.Arbitrary<WorkflowNode> = fc
  .constantFrom(...NODE_TYPES)
  .chain((t) => arbitraryNodeOfType(t))
  .chain((node) =>
    fc
      .option(arbitraryConfigMutation(node), { nil: undefined })
      .map((m) => (m === undefined ? node : m.node)),
  );

// For any node, two calls to validateNodeConfig(n) return equal results
// (errors equal entry-by-entry, in the same order).
describe('Property 7: validation determinism', () => {
  it('validateNodeConfig(n) is stable across two calls', () => {
    fc.assert(
      fc.property(arbAnyNode, (node) => {
        const a = validateNodeConfig(node);
        const b = validateNodeConfig(node);
        return JSON.stringify(a) === JSON.stringify(b);
      }),
      { numRuns: 100 },
    );
  });
});
