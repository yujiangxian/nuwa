// Feature: integration-roadmap, Property 3: 门控就绪只选上游全完成者
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { readyModules } from './graph';
import {
  ROADMAP_GRAPH,
  type DependencyGraph,
  type RoadmapState,
  type ModuleStatus,
  type ModuleState,
} from './modules';

/**
 * Property 3 (Requirements 7.1, 7.2): the gate selection `readyModules(g, s)`
 * only ever returns Pending modules whose every direct upstream is 'Done', and
 * any Pending module with at least one non-Done upstream is never returned.
 *
 * Two local generators are defined inline here (no shared helpers, since the
 * Property 1–9 test tasks run concurrently and must not import each other):
 *   - `arbitraryDag`           — random acyclic DependencyGraph
 *   - `arbitraryRoadmapState`  — random full RoadmapState for a given graph
 *
 * The property is checked against both random DAGs and the fixed ROADMAP_GRAPH.
 */

const STATUSES: ModuleStatus[] = ['Pending', 'In_Progress', 'Done', 'Blocked'];

/**
 * Generate a random acyclic DependencyGraph.
 *
 * Acyclicity is guaranteed by construction: nodes are laid out in a linear
 * order (n0, n1, ...) and a node may only list strictly-earlier nodes as
 * upstreams. `phaseOrder` is computed as max(upstream phase)+1 (0 for roots),
 * which is a valid topological layering — but the property under test does not
 * rely on those values, only on the upstream edges.
 */
function arbitraryDag(): fc.Arbitrary<DependencyGraph> {
  return fc.integer({ min: 1, max: 8 }).chain((count) => {
    // For each node i (0-based), choose a subset of {0..i-1} as upstream indices.
    const upstreamArbs: Array<fc.Arbitrary<number[]>> = [];
    for (let i = 0; i < count; i++) {
      if (i === 0) {
        upstreamArbs.push(fc.constant<number[]>([]));
      } else {
        upstreamArbs.push(
          fc.subarray(
            Array.from({ length: i }, (_, j) => j),
            { minLength: 0, maxLength: i },
          ),
        );
      }
    }

    return fc.tuple(...upstreamArbs).map((upstreamIndexLists) => {
      const phases: number[] = [];
      const nodes = upstreamIndexLists.map((idxList, i) => {
        const upstreams = idxList.map((j) => `n${j}`);
        const phase =
          upstreams.length === 0
            ? 0
            : Math.max(...idxList.map((j) => phases[j])) + 1;
        phases[i] = phase;
        return { id: `n${i}`, upstreams, phaseOrder: phase };
      });
      return { nodes } as DependencyGraph;
    });
  });
}

/**
 * Build a complete ModuleState carrying the given status, with all non-status
 * fields at their neutral defaults (gates '-', blocker null, attempts 0,
 * lastBlocker null, updatedAt null).
 */
function makeState(id: string, status: ModuleStatus): ModuleState {
  return {
    id,
    status,
    gates: { build: '-', test: '-', regression: '-', integration: '-' },
    blocker: null,
    attempts: 0,
    lastBlocker: null,
    updatedAt: null,
  };
}

/**
 * Generate a random full RoadmapState for the given graph: every node gets a
 * uniformly-random ModuleStatus and a fully-populated ModuleState.
 */
function arbitraryRoadmapState(g: DependencyGraph): fc.Arbitrary<RoadmapState> {
  return fc
    .tuple(...g.nodes.map(() => fc.constantFrom(...STATUSES)))
    .map((statuses) => {
      const modules: Record<string, ModuleState> = {};
      g.nodes.forEach((node, i) => {
        modules[node.id] = makeState(node.id, statuses[i]);
      });
      return { modules };
    });
}

/** The shared invariant check applied to one (graph, state) pair. */
function assertReadyGate(g: DependencyGraph, s: RoadmapState): void {
  const ready = readyModules(g, s);
  const readySet = new Set(ready);
  const byId = new Map(g.nodes.map((n) => [n.id, n]));

  // Forward direction: every returned module is Pending with all upstreams Done.
  for (const id of ready) {
    expect(s.modules[id].status).toBe('Pending');
    const node = byId.get(id);
    expect(node).toBeDefined();
    for (const up of node!.upstreams) {
      expect(s.modules[up].status).toBe('Done');
    }
  }

  // Converse: any Pending node with some non-Done upstream must NOT be ready.
  for (const node of g.nodes) {
    if (s.modules[node.id].status !== 'Pending') {
      continue;
    }
    const hasNonDoneUpstream = node.upstreams.some(
      (up) => s.modules[up].status !== 'Done',
    );
    if (hasNonDoneUpstream) {
      expect(readySet.has(node.id)).toBe(false);
    }
  }
}

describe('Property 3: 门控就绪只选上游全完成者', () => {
  it('readyModules over random DAGs only selects Pending modules whose upstreams are all Done', () => {
    fc.assert(
      fc.property(
        arbitraryDag().chain((g) =>
          arbitraryRoadmapState(g).map((s) => [g, s] as const),
        ),
        ([g, s]) => {
          assertReadyGate(g, s);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('readyModules over the fixed ROADMAP_GRAPH respects the gate in both directions', () => {
    fc.assert(
      fc.property(arbitraryRoadmapState(ROADMAP_GRAPH), (s) => {
        assertReadyGate(ROADMAP_GRAPH, s);
      }),
      { numRuns: 100 },
    );
  });
});
