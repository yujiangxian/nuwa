// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: integration-roadmap, Property 2: 相位严格单调（含同相位无边）
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { topoPhases } from './graph';
import { ROADMAP_GRAPH, type DependencyGraph } from './modules';

/**
 * Local DAG generator (kept inside this test file on purpose: other PBT tasks
 * run concurrently, so we avoid a shared helper module).
 *
 * Strategy: generate a strictly-acyclic graph by assigning each node an index
 * 0..n-1 and allowing edges only to strictly-lower-indexed nodes. Because every
 * upstream points to a smaller index, no cycle can ever form, and the graph is
 * a valid DAG for which `topoPhases` always succeeds.
 *
 * The `phaseOrder` field carried on each node is irrelevant to this property
 * (the property re-derives phases via `topoPhases`), so we just set it to 0;
 * the assertions below use the computed phases, not this field.
 */
function arbitraryDag(): fc.Arbitrary<DependencyGraph> {
  return fc
    .integer({ min: 1, max: 12 })
    .chain((n) =>
      fc
        .tuple(
          ...Array.from({ length: n }, (_unused, i) =>
            // Node i may depend only on nodes with a strictly smaller index.
            i === 0
              ? fc.constant<number[]>([])
              : fc.uniqueArray(fc.integer({ min: 0, max: i - 1 }), {
                  minLength: 0,
                  maxLength: i,
                }),
          ),
        )
        .map((upstreamIdx) => ({
          nodes: upstreamIdx.map((ups, i) => ({
            id: `n${i}`,
            upstreams: ups.map((u) => `n${u}`),
            phaseOrder: 0,
          })),
        })),
    );
}

/**
 * Shared assertion: for the given graph, compute phases and verify
 *   (a) every edge A -> B (B in A.upstreams) satisfies phase(A) > phase(B), and
 *   (b) as a corollary, no two nodes in the same phase share an edge.
 */
function assertPhaseMonotonic(g: DependencyGraph): void {
  const phases = topoPhases(g);

  for (const node of g.nodes) {
    const phaseA = phases.get(node.id);
    expect(phaseA).toBeDefined();
    for (const up of node.upstreams) {
      const phaseB = phases.get(up);
      expect(phaseB).toBeDefined();
      // (a) strict monotonicity along every dependency edge.
      expect(phaseA as number).toBeGreaterThan(phaseB as number);
      // (b) corollary: an edge can never connect two same-phase nodes.
      expect(phaseA).not.toBe(phaseB);
    }
  }
}

describe('Property 2: 相位严格单调（含同相位无边）', () => {
  it('every dependency edge goes from a strictly higher phase to a lower one (random DAGs)', () => {
    fc.assert(
      fc.property(arbitraryDag(), (g) => {
        assertPhaseMonotonic(g);
      }),
      { numRuns: 100 },
    );
  });

  it('holds for the fixed 18-node ROADMAP_GRAPH', () => {
    assertPhaseMonotonic(ROADMAP_GRAPH);
  });
});
