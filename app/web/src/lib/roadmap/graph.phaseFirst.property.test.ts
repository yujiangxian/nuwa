// Feature: integration-roadmap, Property 4: 相位升序优先
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { readyModules, topoPhases } from './graph';
import {
  ROADMAP_GRAPH,
  type DependencyGraph,
  type ModuleNode,
  type ModuleStatus,
  type RoadmapState,
  type ModuleState,
} from './modules';

/**
 * Property 4 — 相位升序优先 (Requirements 7.4).
 *
 * The first module chosen from `readyModules(g, s)` (result[0]) must have a
 * phaseOrder <= the phaseOrder of every other ready module: lower phases are
 * preferred. Equivalently, since `readyModules` returns ids already sorted
 * ascending by phaseOrder, the phaseOrders of the whole returned array are
 * non-decreasing.
 *
 * Generators are defined locally in this file (no shared helpers) because
 * sibling property-test tasks run concurrently.
 */

const STATUSES: ModuleStatus[] = ['Pending', 'In_Progress', 'Done', 'Blocked'];

/**
 * Build a default (Pending) ModuleState for a given id.
 */
function pendingState(id: string): ModuleState {
  return {
    id,
    status: 'Pending',
    gates: { build: '-', test: '-', regression: '-', integration: '-' },
    blocker: null,
    attempts: 0,
    lastBlocker: null,
    updatedAt: null,
  };
}

/**
 * Look up a node's phaseOrder within a graph (assumes the id exists).
 */
function phaseOrderOf(g: DependencyGraph, id: string): number {
  const node = g.nodes.find((n) => n.id === id);
  if (!node) {
    throw new Error(`phaseOrderOf: unknown module id "${id}"`);
  }
  return node.phaseOrder;
}

/**
 * Arbitrary acyclic DependencyGraph.
 *
 * Nodes are named m0..m{n-1}. Each node may only list strictly-earlier nodes as
 * upstreams (upstream index < own index), which guarantees acyclicity by
 * construction. phaseOrder is then computed via `topoPhases` so that every
 * node.phaseOrder stays consistent with the design rule
 * phase = max(upstream phase) + 1 (Foundation = 0).
 */
const arbitraryDag: fc.Arbitrary<DependencyGraph> = fc
  .integer({ min: 1, max: 8 })
  .chain((n) => {
    // For each node i, choose a subset of {0..i-1} as upstreams.
    const upstreamArbs = Array.from({ length: n }, (_, i) =>
      i === 0
        ? fc.constant<number[]>([])
        : fc.subarray(Array.from({ length: i }, (_, j) => j)),
    );
    return fc.tuple(...upstreamArbs).map((upstreamLists) => {
      // Build nodes with a placeholder phaseOrder first.
      const draftNodes: ModuleNode[] = upstreamLists.map((ups, i) => ({
        id: `m${i}`,
        upstreams: ups.map((j) => `m${j}`),
        phaseOrder: 0,
      }));
      const draftGraph: DependencyGraph = { nodes: draftNodes };
      // Compute consistent phaseOrder values from the structure.
      const phases = topoPhases(draftGraph);
      const nodes: ModuleNode[] = draftNodes.map((node) => ({
        ...node,
        phaseOrder: phases.get(node.id) ?? 0,
      }));
      return { nodes };
    });
  });

/**
 * Arbitrary RoadmapState for a given graph: assign each node a random status.
 */
function arbitraryRoadmapState(g: DependencyGraph): fc.Arbitrary<RoadmapState> {
  const ids = g.nodes.map((n) => n.id);
  return fc
    .tuple(...ids.map(() => fc.constantFrom(...STATUSES)))
    .map((statuses) => {
      const modules: Record<string, ModuleState> = {};
      ids.forEach((id, i) => {
        modules[id] = { ...pendingState(id), status: statuses[i] };
      });
      return { modules };
    });
}

/**
 * Assert the core property for a single (graph, state) pair: the phaseOrders of
 * the returned ready ids are non-decreasing, hence result[0] is minimal.
 */
function assertPhaseFirst(g: DependencyGraph, s: RoadmapState): void {
  const r = readyModules(g, s);
  if (r.length === 0) {
    return;
  }
  const first = phaseOrderOf(g, r[0]);
  for (let k = 0; k < r.length; k += 1) {
    const pk = phaseOrderOf(g, r[k]);
    // result[0] must not exceed any other ready module's phaseOrder.
    expect(first).toBeLessThanOrEqual(pk);
    // The whole sequence is non-decreasing as well.
    if (k > 0) {
      expect(phaseOrderOf(g, r[k - 1])).toBeLessThanOrEqual(pk);
    }
  }
}

describe('Property 4: 相位升序优先 (readyModules lowest phaseOrder first)', () => {
  it('result[0] has phaseOrder <= every other ready module (random DAGs)', () => {
    fc.assert(
      fc.property(
        arbitraryDag.chain((g) =>
          arbitraryRoadmapState(g).map((s) => [g, s] as const),
        ),
        ([g, s]) => {
          assertPhaseFirst(g, s);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('holds for the fixed 18-node ROADMAP_GRAPH under random states', () => {
    fc.assert(
      fc.property(arbitraryRoadmapState(ROADMAP_GRAPH), (s) => {
        assertPhaseFirst(ROADMAP_GRAPH, s);
      }),
      { numRuns: 100 },
    );
  });
});
