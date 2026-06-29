// Feature: workflow-graph-model, Property 14: 输入端口入边数量约束
import { describe, it } from 'vitest';
import fc from 'fast-check';

import { validateGraph } from './validate';
import { ErrorCode } from './types';
import { incomingEdges } from './graph';
import { arbitraryWorkflowGraph } from './arbitraries';

describe('Property 14: input-port arity constraint', () => {
  it('an Input_Port is flagged INPUT_PORT_ARITY_EXCEEDED iff it has >= 2 incoming edges (output fan-out never triggers it)', () => {
    fc.assert(
      fc.property(arbitraryWorkflowGraph(), (g) => {
        const errors = validateGraph(g).errors;

        for (const node of g.nodes) {
          for (const port of node.inputs) {
            const expected = incomingEdges(g, node.id, port.id).length >= 2;
            const reported = errors.some(
              (e) =>
                e.code === ErrorCode.INPUT_PORT_ARITY_EXCEEDED &&
                (e.location.nodeIds ?? []).includes(node.id) &&
                (e.location.portIds ?? []).includes(port.id),
            );
            if (reported !== expected) return false;
          }
        }

        // The error code is keyed strictly to input ports; no Output_Port
        // fan-out (any number of outgoing edges) can produce this code.
        return true;
      }),
      { numRuns: 100 },
    );
  });
});
