// Feature: integration-roadmap, Property 1: 依赖图无环
//
// Property 1 states: for any valid dependency graph (including randomly
// generated DAGs and the fixed 18-node ROADMAP_GRAPH), `isAcyclic` returns
// true; for any graph with an injected back-edge that forms a cycle it returns
// false. Equivalently, the fixed 18-node graph can be successfully layered by
// `topoPhases`.
//
// Validates: Requirements 2.3

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { isAcyclic, topoPhases } from './graph';
import { ROADMAP_GRAPH, type DependencyGraph, type ModuleNode } from './modules';

/**
 * Build a DependencyGraph from per-node upstream index lists.
 *
 * Node `i` has id `String(i)`; its upstreams reference other node ids. The
 * `phaseOrder` field is irrelevant to `isAcyclic` / `topoPhases` (which derive
 * structure purely from edges), so we fix it to 0 here.
 */
function makeGraph(upstreamLists: number[][]): DependencyGraph {
  const nodes: ModuleNode[] = upstreamLists.map((ups, i) => ({
    id: String(i),
    upstreams: ups.map((u) => String(u)),
    phaseOrder: 0,
  }));
  return { nodes };
}

/**
 * `arbitraryDag` — generate a guaranteed-acyclic dependency graph.
 *
 * Strategy: create N nodes with ids '0'..'N-1' and only allow a node to depend
 * on STRICTLY-LOWER-indexed nodes (upstreams[i] ⊂ {0..i-1}). Because every edge
 * points from a higher index to a lower index, no cycle can ever form — this is
 * a constructive guarantee of acyclicity.
 *
 * Defined locally inside this test file on purpose (other concurrent PBT tasks
 * must not share a helper file).
 */
const arbitraryDag: fc.Arbitrary<DependencyGraph> = fc
  .integer({ min: 1, max: 8 })
  .chain((n) =>
    fc.tuple(
      ...Array.from({ length: n }, (_, i) =>
        i === 0
          ? fc.constant<number[]>([])
          : // a random subset of the strictly-lower indices {0..i-1}
            fc.subarray(Array.from({ length: i }, (_, k) => k)),
      ),
    ),
  )
  .map((upstreamLists) => makeGraph(upstreamLists as number[][]));

/**
 * `arbitraryGraphWithBackEdge` — take a valid DAG (N >= 2) and inject a
 * back-edge that is guaranteed to form a cycle.
 *
 * We pick two distinct indices lo < hi, then:
 *   - ensure the forward edge hi -> lo exists (lo ∈ upstreams[hi]), and
 *   - inject the back-edge lo -> hi (hi ∈ upstreams[lo]).
 * Together these create the 2-cycle lo -> hi -> lo, so `isAcyclic` MUST return
 * false. The base DAG only has lower-index upstreams, so injecting `hi` (a
 * higher index) into `upstreams[lo]` is the sole cycle-creating edge.
 */
const arbitraryGraphWithBackEdge: fc.Arbitrary<DependencyGraph> = fc
  .integer({ min: 2, max: 8 })
  .chain((n) =>
    fc
      .tuple(
        fc.tuple(
          ...Array.from({ length: n }, (_, i) =>
            i === 0
              ? fc.constant<number[]>([])
              : fc.subarray(Array.from({ length: i }, (_, k) => k)),
          ),
        ),
        fc.integer({ min: 0, max: n - 2 }), // lo
      )
      .chain(([upstreamLists, lo]) =>
        fc
          .integer({ min: lo + 1, max: n - 1 }) // hi strictly greater than lo
          .map((hi) => {
            const lists = (upstreamLists as number[][]).map((u) => [...u]);
            // Ensure forward edge hi -> lo (lo is a valid lower index of hi).
            if (!lists[hi].includes(lo)) {
              lists[hi].push(lo);
            }
            // Inject back-edge lo -> hi to close the cycle lo -> hi -> lo.
            if (!lists[lo].includes(hi)) {
              lists[lo].push(hi);
            }
            return makeGraph(lists);
          }),
      ),
  );

describe('Property 1: 依赖图无环 (isAcyclic / topoPhases)', () => {
  it('returns true for any randomly generated valid DAG', () => {
    fc.assert(
      fc.property(arbitraryDag, (g) => {
        expect(isAcyclic(g)).toBe(true);
        // A valid DAG must always be layerable without throwing.
        expect(() => topoPhases(g)).not.toThrow();
      }),
      { numRuns: 100 },
    );
  });

  it('returns false when a back-edge creates a cycle', () => {
    fc.assert(
      fc.property(arbitraryGraphWithBackEdge, (g) => {
        expect(isAcyclic(g)).toBe(false);
        // A cyclic graph cannot be layered: topoPhases must throw.
        expect(() => topoPhases(g)).toThrow();
      }),
      { numRuns: 100 },
    );
  });

  it('successfully layers the fixed 18-node ROADMAP_GRAPH', () => {
    expect(isAcyclic(ROADMAP_GRAPH)).toBe(true);

    const phases = topoPhases(ROADMAP_GRAPH);
    // All 18 nodes receive a phase.
    expect(phases.size).toBe(ROADMAP_GRAPH.nodes.length);
    expect(ROADMAP_GRAPH.nodes.length).toBe(18);

    // Every edge A -> B (A depends on B) must satisfy phase(A) > phase(B):
    // the existence of such a layering is itself a proof of acyclicity.
    for (const node of ROADMAP_GRAPH.nodes) {
      const phaseA = phases.get(node.id);
      expect(phaseA).toBeDefined();
      for (const up of node.upstreams) {
        const phaseB = phases.get(up);
        expect(phaseB).toBeDefined();
        expect((phaseA as number) > (phaseB as number)).toBe(true);
      }
    }
  });
});
