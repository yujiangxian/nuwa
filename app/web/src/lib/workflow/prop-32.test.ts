// Feature: workflow-graph-model, Property 32: 变更操作幂等性
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { replaceNodeConfig, removeNode, removeEdge } from './mutate';
import type { NodeConfig } from './types';
import { graphEquals } from './graph';
import { arbitraryValidGraph } from './arbitraries';

describe('Property 32: mutation idempotency', () => {
  it('two consecutive replaceNodeConfig(same) equal one', () => {
    fc.assert(
      fc.property(
        arbitraryValidGraph(),
        fc.nat(),
        fc.jsonValue({ maxDepth: 2 }),
        (g, idx, rawConfig) => {
          const nodeId = g.nodes[idx % g.nodes.length].id;
          const config = rawConfig as unknown as NodeConfig;
          const r1 = replaceNodeConfig(g, nodeId, config);
          expect(r1.ok).toBe(true);
          if (!r1.ok) return;
          const r2 = replaceNodeConfig(r1.graph, nodeId, config);
          expect(r2.ok).toBe(true);
          if (!r2.ok) return;
          expect(graphEquals(r2.graph, r1.graph)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('two consecutive removeNode(same id) equal one', () => {
    fc.assert(
      fc.property(arbitraryValidGraph(), fc.nat(), (g, idx) => {
        const nodeId = g.nodes[idx % g.nodes.length].id;
        const r1 = removeNode(g, nodeId);
        expect(r1.ok).toBe(true);
        if (!r1.ok) return;
        const r2 = removeNode(r1.graph, nodeId);
        expect(r2.ok).toBe(true);
        if (!r2.ok) return;
        expect(graphEquals(r2.graph, r1.graph)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('two consecutive removeEdge(same id) equal one', () => {
    fc.assert(
      fc.property(arbitraryValidGraph(), fc.nat(), (g, idx) => {
        // Fall back to a non-existent id when the graph has no edges; removeEdge
        // is a safe no-op in that case, so idempotency still holds.
        const edgeId = g.edges.length > 0 ? g.edges[idx % g.edges.length].id : 'e_none';
        const r1 = removeEdge(g, edgeId);
        expect(r1.ok).toBe(true);
        if (!r1.ok) return;
        const r2 = removeEdge(r1.graph, edgeId);
        expect(r2.ok).toBe(true);
        if (!r2.ok) return;
        expect(graphEquals(r2.graph, r1.graph)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
