// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: workflow-graph-model, Property 13: 类型兼容性与 isAssignable 一致
import { describe, it } from 'vitest';
import fc from 'fast-check';

import { validateGraph } from './validate';
import { ErrorCode, type WorkflowNode } from './types';
import { getInputPort, getOutputPort } from './graph';
import { formatPortType, isAssignable } from './portType';
import { arbitraryWorkflowGraph } from './arbitraries';

describe('Property 13: port-type compatibility agrees with isAssignable', () => {
  it('a reference-valid edge yields INCOMPATIBLE_PORT_TYPES iff !isAssignable(source, target)', () => {
    fc.assert(
      fc.property(arbitraryWorkflowGraph(), (g) => {
        const result = validateGraph(g);

        // Resolve nodes with the same "last occurrence wins" semantics the
        // validator uses (buildNodeIndex), so duplicate node ids do not skew us.
        const index = new Map<string, WorkflowNode>();
        for (const n of g.nodes) index.set(n.id, n);

        for (const edge of g.edges) {
          const sourceNode = index.get(edge.source.nodeId);
          const targetNode = index.get(edge.target.nodeId);
          if (sourceNode === undefined || targetNode === undefined) continue;
          const sourcePort = getOutputPort(sourceNode, edge.source.portId);
          const targetPort = getInputPort(targetNode, edge.target.portId);
          if (sourcePort === undefined || targetPort === undefined) continue;

          const expectedIncompatible = !isAssignable(sourcePort.portType, targetPort.portType);
          const fromType = formatPortType(sourcePort.portType);
          const toType = formatPortType(targetPort.portType);
          const reported = result.errors.some(
            (e) =>
              e.code === ErrorCode.INCOMPATIBLE_PORT_TYPES &&
              (e.location.edgeIds ?? []).includes(edge.id) &&
              e.location.fromType === fromType &&
              e.location.toType === toType,
          );

          if (reported !== expectedIncompatible) return false;
        }

        return true;
      }),
      { numRuns: 100 },
    );
  });
});
