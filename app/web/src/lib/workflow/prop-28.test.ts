// Feature: workflow-graph-model, Property 28: 变更不修改输入图
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  addNode,
  removeNode,
  addEdge,
  removeEdge,
  replaceNodeConfig,
} from './mutate';
import type { NodeConfig, WorkflowEdge } from './types';
import { arbitraryValidGraph, arbitraryWorkflowNode } from './arbitraries';

describe('Property 28: mutations never modify the input graph', () => {
  it('input graph deep-equals a pre-op snapshot after any mutation op', () => {
    fc.assert(
      fc.property(
        arbitraryValidGraph(),
        arbitraryWorkflowNode(),
        fc.nat(),
        fc.jsonValue({ maxDepth: 2 }),
        (g, newNode, idx, rawConfig) => {
          // Deep snapshot of the input graph (the graph is JSON-serializable).
          const snapshot = JSON.stringify(g);

          const pickedNodeId = g.nodes.length > 0 ? g.nodes[idx % g.nodes.length].id : 'x';
          const pickedEdgeId = g.edges.length > 0 ? g.edges[idx % g.edges.length].id : 'e_none';
          const config = rawConfig as unknown as NodeConfig;
          const probeEdge: WorkflowEdge = {
            id: 'probe_edge',
            source: { nodeId: pickedNodeId, portId: 'out' },
            target: { nodeId: pickedNodeId, portId: 'in_main' },
          };

          // Exercise every mutation operation against the same input graph.
          addNode(g, newNode);
          addNode(g, { ...newNode, id: pickedNodeId }); // duplicate-id rejection path
          removeNode(g, pickedNodeId);
          addEdge(g, probeEdge);
          removeEdge(g, pickedEdgeId);
          replaceNodeConfig(g, pickedNodeId, config);

          // The input graph must be byte-for-byte identical to its snapshot.
          expect(JSON.stringify(g)).toBe(snapshot);
        },
      ),
      { numRuns: 100 },
    );
  });
});
