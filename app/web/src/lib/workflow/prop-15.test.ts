// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: workflow-graph-model, Property 15: 必需输入悬空检出且非必需豁免
import { describe, it } from 'vitest';
import fc from 'fast-check';

import { validateGraph } from './validate';
import { ErrorCode } from './types';
import { incomingEdges } from './graph';
import { arbitraryWorkflowGraph } from './arbitraries';

describe('Property 15: required dangling inputs detected, non-required exempt', () => {
  it('an Input_Port is flagged MISSING_REQUIRED_INPUT iff it is required and has no incoming edge', () => {
    fc.assert(
      fc.property(arbitraryWorkflowGraph(), (g) => {
        const errors = validateGraph(g).errors;

        for (const node of g.nodes) {
          for (const port of node.inputs) {
            // The validator reports per (Node_Id, Port_Id), which cannot
            // distinguish two nodes that share an id. So the error is present
            // for a pair iff SOME node with that id has a required input port of
            // that id and the pair has no incoming edge (existence semantics).
            const expected =
              incomingEdges(g, node.id, port.id).length === 0 &&
              g.nodes.some(
                (n) => n.id === node.id && n.inputs.some((p) => p.id === port.id && p.required),
              );
            const reported = errors.some(
              (e) =>
                e.code === ErrorCode.MISSING_REQUIRED_INPUT &&
                (e.location.nodeIds ?? []).includes(node.id) &&
                (e.location.portIds ?? []).includes(port.id),
            );
            if (reported !== expected) return false;
          }
        }

        return true;
      }),
      { numRuns: 100 },
    );
  });
});
