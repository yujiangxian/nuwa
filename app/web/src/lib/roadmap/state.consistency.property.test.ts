// Feature: integration-roadmap, Property 7: 状态一致性不变量保持
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { canMarkDone, isStateConsistent } from './state';
import { readyModules } from './graph';
import {
  ROADMAP_GRAPH,
  type DependencyGraph,
  type RoadmapState,
  type ModuleState,
} from './modules';

/**
 * Property 7 (Requirement 10.4): the R10.4 consistency invariant — every 'Done'
 * module has all of its direct upstreams 'Done' — is preserved across every
 * legal build step.
 *
 * The legal transition system is modeled directly:
 *   - We start from an all-'Pending' Roadmap_State, which is trivially
 *     consistent (no Done modules, so the invariant holds vacuously).
 *   - The only mutation allowed is to mark a module 'Done', and only a module
 *     that `readyModules(g, s)` currently reports as ready (i.e. Pending with
 *     all upstreams already Done) may be marked.
 *
 * Because a ready module has all upstreams Done by definition, `canMarkDone`
 * must agree (asserted at each step), and marking it Done cannot break the
 * invariant for itself or for anyone else. We drive the random sequence of
 * choices entirely through fast-check: an array of `nat` indices selects which
 * ready module to build at each step (modulo the current ready-set size), and
 * the array length controls how many steps to run.
 *
 * A local `arbitraryDag` generator is defined inline (no shared helpers, since
 * the Property 1–9 test tasks run concurrently and must not import each other).
 * The property is checked against both random DAGs and the fixed ROADMAP_GRAPH.
 */

/**
 * Generate a random acyclic DependencyGraph.
 *
 * Acyclicity is guaranteed by construction: nodes are laid out in a linear
 * order (n0, n1, ...) and a node may only list strictly-earlier nodes as
 * upstreams. `phaseOrder` is computed as max(upstream phase)+1 (0 for roots),
 * a valid topological layering consistent with the orchestration model.
 */
function arbitraryDag(): fc.Arbitrary<DependencyGraph> {
  return fc.integer({ min: 1, max: 8 }).chain((count) => {
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

/** Build an all-'Pending' Roadmap_State for the given graph (the consistent initial state). */
function initialPendingState(g: DependencyGraph): RoadmapState {
  const modules: Record<string, ModuleState> = {};
  for (const node of g.nodes) {
    modules[node.id] = {
      id: node.id,
      status: 'Pending',
      gates: { build: '-', test: '-', regression: '-', integration: '-' },
      blocker: null,
      attempts: 0,
      lastBlocker: null,
      updatedAt: null,
    };
  }
  return { modules };
}

/**
 * Replay a sequence of legal build steps over `g`, asserting the invariant at
 * every step. `choices` are arbitrary nat indices; at each step we look at the
 * current ready-set and, if non-empty, pick ready[choice % ready.length],
 * assert `canMarkDone` agrees, mark it Done, and assert consistency holds.
 */
function runLegalBuildSequence(g: DependencyGraph, choices: number[]): void {
  const s = initialPendingState(g);

  // The all-Pending starting state must itself be consistent.
  expect(isStateConsistent(g, s)).toBe(true);

  for (const choice of choices) {
    const ready = readyModules(g, s);
    if (ready.length === 0) {
      // No legal move available at this step; skip it.
      continue;
    }
    const picked = ready[choice % ready.length];

    // A ready module implies its upstreams are Done, so canMarkDone must agree.
    expect(canMarkDone(g, s, picked)).toBe(true);

    // The only legal mutation: mark the chosen module Done.
    s.modules[picked].status = 'Done';

    // The R10.4 invariant must still hold after every step.
    expect(isStateConsistent(g, s)).toBe(true);
  }
}

describe('Property 7: 状态一致性不变量保持', () => {
  it('isStateConsistent stays true after every legal build step over random DAGs', () => {
    fc.assert(
      fc.property(
        arbitraryDag().chain((g) =>
          fc
            .array(fc.nat({ max: 1000 }), { minLength: 0, maxLength: 30 })
            .map((choices) => [g, choices] as const),
        ),
        ([g, choices]) => {
          runLegalBuildSequence(g, choices);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('isStateConsistent stays true after every legal build step over the fixed ROADMAP_GRAPH', () => {
    fc.assert(
      fc.property(
        fc.array(fc.nat({ max: 1000 }), { minLength: 0, maxLength: 40 }),
        (choices) => {
          runLegalBuildSequence(ROADMAP_GRAPH, choices);
        },
      ),
      { numRuns: 100 },
    );
  });
});
