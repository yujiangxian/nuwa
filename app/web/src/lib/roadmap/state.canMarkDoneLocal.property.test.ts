// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: integration-roadmap, Property 5: 完成判定仅依赖自身与上游
//
// Property 5 states that `canMarkDone(g, s, m)` depends ONLY on module m's own
// upstream states and never reads any downstream module. We verify this by
// computing the verdict, then arbitrarily mutating the status of one or more
// modules in m's transitive-downstream closure (leaving m and its upstreams
// untouched) and asserting the verdict is unchanged.
//
// Validates: Requirements 5.5

import { describe, it } from 'vitest';
import fc from 'fast-check';

import { canMarkDone } from './state';
import { transitiveDownstream } from './graph';
import {
  ROADMAP_GRAPH,
  type DependencyGraph,
  type ModuleState,
  type ModuleStatus,
  type RoadmapState,
} from './modules';

// All four Module_Status values, used to generate / mutate states.
const statusArb = fc.constantFrom<ModuleStatus>(
  'Pending',
  'In_Progress',
  'Done',
  'Blocked',
);

/** Build a full ModuleState with the given id/status and default gate fields. */
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
 * Local generator for random DAGs (no shared helpers; this file is authored
 * independently of sibling property-test tasks).
 *
 * Acyclicity is guaranteed by construction: node `i` may only list nodes with a
 * strictly smaller index as upstreams. `phaseOrder` is derived the same way the
 * roadmap does it: max(upstream phase) + 1, with sources at 0.
 */
function arbitraryDag(): fc.Arbitrary<DependencyGraph> {
  return fc.integer({ min: 1, max: 8 }).chain((n) => {
    // For each node i, pick a subset of the lower-indexed nodes as upstreams.
    const upstreamArbs = [];
    for (let i = 0; i < n; i++) {
      const candidates = Array.from({ length: i }, (_, j) => j);
      upstreamArbs.push(fc.subarray(candidates));
    }
    return fc.tuple(...upstreamArbs).map((upstreamSets) => {
      const phases: number[] = [];
      const nodes = upstreamSets.map((ups, i) => {
        const phase =
          ups.length === 0 ? 0 : Math.max(...ups.map((j) => phases[j])) + 1;
        phases[i] = phase;
        return {
          id: `m${i}`,
          upstreams: ups.map((j) => `m${j}`),
          phaseOrder: phase,
        };
      });
      return { nodes };
    });
  });
}

/** Local generator for a RoadmapState assigning each node a random status. */
function arbitraryRoadmapState(
  g: DependencyGraph,
): fc.Arbitrary<RoadmapState> {
  const n = g.nodes.length;
  return fc
    .array(statusArb, { minLength: n, maxLength: n })
    .map((statuses) => {
      const modules: Record<string, ModuleState> = {};
      g.nodes.forEach((node, i) => {
        modules[node.id] = makeState(node.id, statuses[i]);
      });
      return { modules };
    });
}

describe('Property 5: 完成判定仅依赖自身与上游', () => {
  it('canMarkDone is invariant under arbitrary downstream status mutations', () => {
    const scenarioArb = fc
      // Use the fixed 18-node ROADMAP_GRAPH plus randomly generated DAGs.
      .oneof(fc.constant(ROADMAP_GRAPH), arbitraryDag())
      .chain((g) =>
        fc.record({
          g: fc.constant(g),
          state: arbitraryRoadmapState(g),
          targetIdx: fc.nat({ max: g.nodes.length - 1 }),
          // One random status per node, cycled across downstream modules so
          // "one or more" downstream modules get mutated to arbitrary values.
          mutations: fc.array(statusArb, {
            minLength: g.nodes.length,
            maxLength: g.nodes.length,
          }),
        }),
      );

    fc.assert(
      fc.property(scenarioArb, ({ g, state, targetIdx, mutations }) => {
        const m = g.nodes[targetIdx].id;
        const before = canMarkDone(g, state, m);

        // Clone the state, then mutate every transitive-downstream module of m.
        // Downstream modules can never be m itself or one of m's upstreams
        // (the graph is acyclic), so m and its upstreams stay untouched.
        const newModules: Record<string, ModuleState> = {};
        for (const id of Object.keys(state.modules)) {
          newModules[id] = { ...state.modules[id] };
        }

        const downstream = transitiveDownstream(g, m);
        let i = 0;
        for (const dId of downstream) {
          newModules[dId] = {
            ...newModules[dId],
            status: mutations[i % mutations.length],
          };
          i += 1;
        }
        const mutated: RoadmapState = { modules: newModules };

        const after = canMarkDone(g, mutated, m);
        return after === before;
      }),
      { numRuns: 100 },
    );
  });
});
