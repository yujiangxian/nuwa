// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: integration-roadmap, Property 8: 中断恢复等价（model-based）
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { readyModules } from './graph';
import { canMarkDone } from './state';
import {
  ROADMAP_GRAPH,
  type DependencyGraph,
  type RoadmapState,
  type ModuleState,
} from './modules';

/**
 * Property 8 (Requirements 10.3): interrupt-resume equivalence, model-based.
 *
 * Resuming `runAll` from ANY consistent intermediate Roadmap_State must:
 *   (a) never rebuild a module that is already 'Done' in that state, and
 *   (b) reach the SAME final set of 'Done' modules as a full run from a blank
 *       (all-Pending) state.
 *
 * The orchestration `runAll` reducer is pseudo-code in design.md (not exported),
 * so it is MODELLED locally below as a deterministic, pure success-model
 * function (every build passes). A local `arbitraryDag` generator is defined
 * inline (no shared helpers — the Property 1–9 tests run concurrently and must
 * not import each other). The property is checked against random DAGs and the
 * fixed ROADMAP_GRAPH.
 */

/** Build a Pending ModuleState with all neutral defaults. */
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

/** A blank Roadmap_State for a graph: every module Pending. */
function blankState(g: DependencyGraph): RoadmapState {
  const modules: Record<string, ModuleState> = {};
  for (const node of g.nodes) {
    modules[node.id] = pendingState(node.id);
  }
  return { modules };
}

/** Deep-enough clone of a Roadmap_State (independent module/gate objects). */
function cloneState(s: RoadmapState): RoadmapState {
  const modules: Record<string, ModuleState> = {};
  for (const [id, m] of Object.entries(s.modules)) {
    modules[id] = { ...m, gates: { ...m.gates } };
  }
  return { modules };
}

/**
 * Local model of the design.md `runAll` reducer (success model: all builds
 * pass). Starting from a clone of `s0`, repeatedly take `readyModules(g, s)`;
 * if none are ready, stop; otherwise pick the FIRST ready id (phase-ordered),
 * record it in `built`, and set its status to 'Done'. Returns the final state
 * and the ordered list of modules built during this run.
 *
 * An optional `maxSteps` bounds how many modules get built, used to fabricate
 * a reachable/consistent intermediate state.
 */
function runAll(
  g: DependencyGraph,
  s0: RoadmapState,
  maxSteps = Number.POSITIVE_INFINITY,
): { final: RoadmapState; built: string[] } {
  const s = cloneState(s0);
  const built: string[] = [];

  let steps = 0;
  while (steps < maxSteps) {
    const ready = readyModules(g, s);
    if (ready.length === 0) break;

    const id = ready[0];
    // Success model: the module passes its gate and is marked Done.
    s.modules[id].status = 'Done';
    built.push(id);
    steps += 1;
  }

  return { final: s, built };
}

/** Ids of all modules currently 'Done' in a state, as a Set. */
function doneSet(s: RoadmapState): Set<string> {
  const out = new Set<string>();
  for (const m of Object.values(s.modules)) {
    if (m.status === 'Done') out.add(m.id);
  }
  return out;
}

/** Assert two string sets are equal. */
function expectSameSet(a: Set<string>, b: Set<string>): void {
  expect([...a].sort()).toEqual([...b].sort());
}

/**
 * Generate a random acyclic DependencyGraph.
 *
 * Acyclicity is guaranteed by construction: nodes are laid out in a linear
 * order (n0, n1, ...) and a node may only list strictly-earlier nodes as
 * upstreams. `phaseOrder` is computed as max(upstream phase)+1 (0 for roots),
 * giving a valid topological layering.
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

/** Core property check for one graph and one interrupt step count k. */
function assertResumeEquivalence(g: DependencyGraph, k: number): void {
  // 1. Full run from blank state.
  const { final: finalBlank } = runAll(g, blankState(g));
  const doneBlank = doneSet(finalBlank);

  // 2. Fabricate a consistent intermediate state by running k steps from blank.
  const { final: mid } = runAll(g, blankState(g), k);
  const doneMid = doneSet(mid);

  // 3. Resume from the intermediate state.
  const { final: finalResume, built: builtResume } = runAll(g, mid);

  // (a) No rebuild: resume must not build anything already Done in `mid`.
  for (const id of builtResume) {
    expect(doneMid.has(id)).toBe(false);
  }

  // (b) Final Done set equals the from-blank Done set.
  expectSameSet(doneSet(finalResume), doneBlank);

  // Sanity: the intermediate state must itself only contain valid completions
  // (every Done module was eligible per canMarkDone). This confirms `mid` is a
  // genuinely reachable/consistent state, not an arbitrary one.
  for (const id of doneMid) {
    expect(canMarkDone(g, mid, id)).toBe(true);
  }
}

describe('Property 8: 中断恢复等价（model-based）', () => {
  it('resuming runAll from any reachable intermediate state never rebuilds Done modules and reaches the same final Done set (random DAGs)', () => {
    fc.assert(
      fc.property(
        arbitraryDag().chain((g) =>
          // k: how many modules to build before "interrupting". 0..nodes count
          // covers blank, partial, and fully-complete intermediate states.
          fc
            .integer({ min: 0, max: g.nodes.length })
            .map((k) => [g, k] as const),
        ),
        ([g, k]) => {
          assertResumeEquivalence(g, k);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('resuming runAll over the fixed ROADMAP_GRAPH is interrupt-equivalent for any step count', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: ROADMAP_GRAPH.nodes.length }),
        (k) => {
          assertResumeEquivalence(ROADMAP_GRAPH, k);
        },
      ),
      { numRuns: 100 },
    );
  });
});
