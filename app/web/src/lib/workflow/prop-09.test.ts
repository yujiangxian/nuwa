// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: workflow-graph-model, Property 9: 输出端口 Required 不影响校验
import { describe, it } from 'vitest';
import fc from 'fast-check';

import { validateGraph } from './validate';
import type { WorkflowGraph } from './types';
import { arbitraryWorkflowGraph } from './arbitraries';

/** Flip the `required` flag of every Output_Port across the graph. */
function flipAllOutputRequired(g: WorkflowGraph): WorkflowGraph {
  return {
    ...g,
    nodes: g.nodes.map((n) => ({
      ...n,
      outputs: n.outputs.map((p) => ({ ...p, required: !p.required })),
    })),
  };
}

describe('Property 9: output-port Required does not affect validation', () => {
  it('flipping every Output_Port required flag leaves the error set unchanged', () => {
    fc.assert(
      fc.property(arbitraryWorkflowGraph(), (g) => {
        const before = validateGraph(g);
        const after = validateGraph(flipAllOutputRequired(g));
        // Validation never reads Output_Port.required (R2.3), so the full
        // ValidationResult must be identical.
        return JSON.stringify(before) === JSON.stringify(after);
      }),
      { numRuns: 100 },
    );
  });
});
