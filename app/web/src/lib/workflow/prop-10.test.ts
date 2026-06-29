// Feature: workflow-graph-model, Property 10: 跨方向同名端口被允许
import { describe, it } from 'vitest';
import fc from 'fast-check';

import { validateGraph } from './validate';
import type { Port, WorkflowGraph, WorkflowNode } from './types';
import { T_JSON } from './portType';
import { arbitraryValidGraph } from './arbitraries';

/**
 * Given a valid graph, pick the first node that has an Output_Port whose id is
 * NOT already used by one of that node's Input_Ports, and add an Input_Port
 * (json, non-required, unconnected) reusing that same Port_Id. Returns null if
 * no such opportunity exists.
 */
function addCrossDirectionSameNameInput(g: WorkflowGraph): WorkflowGraph | null {
  for (const node of g.nodes) {
    const inputIds = new Set(node.inputs.map((p) => p.id));
    const sharedOutput = node.outputs.find((o) => !inputIds.has(o.id));
    if (sharedOutput === undefined) continue;
    const newInput: Port = {
      id: sharedOutput.id, // same Port_Id as an existing Output_Port (R2.5)
      direction: 'input',
      portType: T_JSON,
      required: false,
    };
    const newNode: WorkflowNode = { ...node, inputs: [...node.inputs, newInput] };
    return { ...g, nodes: g.nodes.map((n) => (n === node ? newNode : n)) };
  }
  return null;
}

describe('Property 10: cross-direction same-name ports are allowed', () => {
  it('an Input_Port sharing an Output_Port id produces no validation error', () => {
    fc.assert(
      fc.property(arbitraryValidGraph({ minNodes: 1, maxNodes: 5 }), (g) => {
        const mutated = addCrossDirectionSameNameInput(g);
        fc.pre(mutated !== null);
        // The added unconnected, non-required input introduces no error, and the
        // shared name across directions is explicitly permitted (R2.5).
        return validateGraph(mutated as WorkflowGraph).valid === true;
      }),
      { numRuns: 100 },
    );
  });
});
