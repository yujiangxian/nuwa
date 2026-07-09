// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: workflow-node-types, Property 6: 校验结果 valid 当且仅当无错误
import { describe, it } from 'vitest';
import fc from 'fast-check';

import type { WorkflowNode } from '../types';
import { NODE_TYPES } from '../types';
import { validateNodeConfig } from './index';
import { arbitraryNodeOfType, arbitraryConfigMutation } from './arbitraries';

// A valid node from arbitraryNodeOfType, optionally perturbed by a single-point
// mutation, covers both valid and invalid cases.
const arbAnyNode: fc.Arbitrary<WorkflowNode> = fc
  .constantFrom(...NODE_TYPES)
  .chain((t) => arbitraryNodeOfType(t))
  .chain((node) =>
    fc
      .option(arbitraryConfigMutation(node), { nil: undefined })
      .map((m) => (m === undefined ? node : m.node)),
  );

// For any node, validateNodeConfig(n).valid is true iff its error set is empty.
describe('Property 6: valid iff no errors', () => {
  it('result.valid <=> result.errors.length === 0', () => {
    fc.assert(
      fc.property(arbAnyNode, (node) => {
        const result = validateNodeConfig(node);
        return result.valid === (result.errors.length === 0);
      }),
      { numRuns: 100 },
    );
  });
});
