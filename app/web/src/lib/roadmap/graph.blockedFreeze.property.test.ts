// Feature: integration-roadmap, Property 6: 被阻塞模块的下游冻结且不被重试选取
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { readyModules, transitiveDownstream, anyUpstreamBlocked } from './graph';
import {
  ROADMAP_GRAPH,
  type DependencyGraph,
  type RoadmapState,
  type ModuleStatus,
  type ModuleState,
} from './modules';

/**
 * Property 6 (Requirements 9.3, 9.4): blocked-module downstream freeze and
 * no-retry-after-two-same-cause-failures.
 *
 * Part (a) — R9.3 downstream freeze: when a module `b` is 'Blocked', NONE of
 * b's transitive-downstream modules appear in `readyModules(g, s)`; they stay
 * frozen (Pending, never selected). This holds because `readyModules` excludes
 * any module whose upstream closure contains a Blocked node (via
 * `anyUpstreamBlocked`).
 *
 * Part (b) — R9.4 circuit breaker: once a module has failed twice with the same
 * cause (`attempts >= 2` and a non-null `blocker` equal to `lastBlocker`), it is
 * NOT eligible for retry. This is an execution-policy predicate (not part of the
 * pure graph functions), so it is modelled here as a small LOCAL pure predicate
 * `eligibleForRetry` that embodies the design's R9.4 rule, and validated as a
 * model-based property.
 *
 * Local generators are defined inline (no shared helpers, since the Property
 * 1–9 test tasks run concurrently and must not import each other):
 *   - `arbitraryDag`          — random acyclic DependencyGraph
 *   - `arbitraryRoadmapState` — random full RoadmapState for a given graph
 *
 * Part (a) is checked against both random DAGs and the fixed ROADMAP_GRAPH.
 */

const STATUSES: ModuleStatus[] = ['Pending', 'In_Progress', 'Done', 'Blocked'];

/**
 * Generate a random acyclic DependencyGraph.
 *
 * Acyclicity is guaranteed by construction: nodes are laid out in a linear
 * order (n0, n1, ...) and a node may only list strictly-earlier nodes as
 * upstreams. `phaseOrder` is computed as max(upstream phase)+1 (0 for roots).
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

/**
 * Build a complete ModuleState carrying the given status, with all non-status
 * fields at their neutral defaults.
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

/**
 * LOCAL pure predicate embodying the design's R9.4 circuit-breaker rule.
 *
 * A module is NOT eligible for retry once it has failed twice with the same
 * cause: `attempts >= 2` AND it has a non-null `blocker` equal to its
 * `lastBlocker` (same Blocker seen on two consecutive failures). In every other
 * case it remains eligible for another attempt.
 */
function eligibleForRetry(st: ModuleState): boolean {
  return !(st.attempts >= 2 && st.blocker !== null && st.blocker === st.lastBlocker);
}

describe('Property 6: 被阻塞模块的下游冻结且不被重试选取', () => {
  // ---- Part (a): R9.3 — blocked module's transitive downstream is frozen ----

  it('over random DAGs: when a module b is Blocked, none of b transitive-downstream appears in readyModules', () => {
    fc.assert(
      fc.property(
        arbitraryDag().chain((g) =>
          // Pick an index of a node to force into Blocked, plus a base state.
          fc
            .tuple(
              fc.nat({ max: g.nodes.length - 1 }),
              arbitraryRoadmapState(g),
            )
            .map(([blockedIdx, s]) => [g, blockedIdx, s] as const),
        ),
        ([g, blockedIdx, s]) => {
          const b = g.nodes[blockedIdx].id;
          // Force b into Blocked in the state.
          s.modules[b] = { ...s.modules[b], status: 'Blocked' };

          const ready = new Set(readyModules(g, s));
          const downstream = transitiveDownstream(g, b);

          // R9.3: every transitive downstream of b stays frozen (not ready).
          for (const d of downstream) {
            expect(ready.has(d)).toBe(false);
            // Sanity: such a module indeed has a Blocked upstream in its closure.
            expect(anyUpstreamBlocked(g, s, d)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('over the fixed ROADMAP_GRAPH: blocking any module freezes its transitive downstream', () => {
    fc.assert(
      fc.property(
        fc
          .tuple(
            fc.nat({ max: ROADMAP_GRAPH.nodes.length - 1 }),
            arbitraryRoadmapState(ROADMAP_GRAPH),
          ),
        ([blockedIdx, s]) => {
          const b = ROADMAP_GRAPH.nodes[blockedIdx].id;
          s.modules[b] = { ...s.modules[b], status: 'Blocked' };

          const ready = new Set(readyModules(ROADMAP_GRAPH, s));
          const downstream = transitiveDownstream(ROADMAP_GRAPH, b);

          for (const d of downstream) {
            expect(ready.has(d)).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // ---- Part (b): R9.4 — circuit breaker after two same-cause failures ----

  it('eligibleForRetry: false iff attempts>=2 with a non-null blocker equal to lastBlocker; true otherwise', () => {
    fc.assert(
      fc.property(
        fc.record({
          attempts: fc.integer({ min: 0, max: 5 }),
          // blocker / lastBlocker may each be null or one of a small label set
          // so that "same cause" and "different cause" both occur frequently.
          blocker: fc.option(fc.constantFrom('build', 'test', 'regression'), {
            nil: null,
          }),
          lastBlocker: fc.option(fc.constantFrom('build', 'test', 'regression'), {
            nil: null,
          }),
        }),
        ({ attempts, blocker, lastBlocker }) => {
          const st: ModuleState = {
            id: 'm',
            status: 'Blocked',
            gates: { build: '-', test: '-', regression: '-', integration: '-' },
            blocker,
            attempts,
            lastBlocker,
            updatedAt: null,
          };

          const sameCauseTwice =
            attempts >= 2 && blocker !== null && blocker === lastBlocker;

          if (sameCauseTwice) {
            // R9.4: two same-cause failures => not selected for retry.
            expect(eligibleForRetry(st)).toBe(false);
          } else {
            // Any other combination remains eligible for another attempt.
            expect(eligibleForRetry(st)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
