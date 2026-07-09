// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: integration-roadmap, Property 9: Roadmap_State 序列化往返
//
// Property 9 verifies that serializeRoadmap / parseRoadmap form a round-trip
// over the round-trippable fields of a RoadmapState: for any legal state `s`
// built over the fixed ROADMAP_GRAPH,
//
//     parseRoadmap(serializeRoadmap(ROADMAP_GRAPH, s))
//
// reproduces, for every module id, the same status, gates, blocker, attempts
// and updatedAt.
//
// Notes on what is intentionally NOT compared:
// - `upstreams` live on the DependencyGraph, not on RoadmapState, so the state
//   carries no upstreams to compare.
// - `lastBlocker` is deliberately not serialized; parseRoadmap always resets it
//   to null. We therefore exclude it from the equivalence check.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { serializeRoadmap, parseRoadmap } from './state';
import {
  ROADMAP_GRAPH,
  type RoadmapState,
  type ModuleState,
  type ModuleStatus,
  type GateResult,
} from './modules';

// --- Generators --------------------------------------------------------------

const STATUSES: readonly ModuleStatus[] = [
  'Pending',
  'In_Progress',
  'Done',
  'Blocked',
];

const GATES: readonly GateResult[] = ['pass', 'fail', 'n/a', '-'];

const arbitraryStatus = fc.constantFrom(...STATUSES);
const arbitraryGate = fc.constantFrom(...GATES);

/**
 * A blocker is either null OR a "safe token": a non-empty string that survives
 * the line-based serializer. The serializer writes `blocker: <value>` on a
 * single line and parseRoadmap trims the captured value, so the token must:
 * - contain no newlines (would break the single-line block structure),
 * - have no leading/trailing whitespace (the parser trims it away),
 * - not equal the `(none)` sentinel (that is reserved to mean null).
 * We restrict to a friendly alphanumeric+symbol alphabet to stay unambiguous.
 */
const SAFE_TOKEN_CHARS =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.#@/!';
const arbitrarySafeToken = fc
  .stringOf(fc.constantFrom(...SAFE_TOKEN_CHARS.split('')), {
    minLength: 1,
    maxLength: 40,
  })
  .filter((t) => t.trim() === t && t.length > 0 && t !== '(none)');

const arbitraryBlocker: fc.Arbitrary<string | null> = fc.oneof(
  fc.constant(null),
  arbitrarySafeToken,
);

/**
 * updatedAt is either null or a fixed-format ISO timestamp. Any non-'-' string
 * round-trips, but we use realistic ISO strings to mirror production data.
 */
const arbitraryUpdatedAt: fc.Arbitrary<string | null> = fc.oneof(
  fc.constant(null),
  fc
    .date({
      min: new Date('2020-01-01T00:00:00.000Z'),
      max: new Date('2030-12-31T23:59:59.999Z'),
    })
    .map((d) => d.toISOString()),
);

/** Generate the ModuleState for a single, fixed module id. */
function arbitraryModuleState(id: string): fc.Arbitrary<ModuleState> {
  return fc.record({
    id: fc.constant(id),
    status: arbitraryStatus,
    gates: fc.record({
      build: arbitraryGate,
      test: arbitraryGate,
      regression: arbitraryGate,
      integration: arbitraryGate,
    }),
    blocker: arbitraryBlocker,
    attempts: fc.nat({ max: 5 }),
    // lastBlocker can be anything; it is not serialized and won't survive the
    // round-trip, so we let it vary freely to prove it is irrelevant.
    lastBlocker: fc.oneof(fc.constant(null), arbitrarySafeToken),
    updatedAt: arbitraryUpdatedAt,
  });
}

/**
 * Generate a complete RoadmapState covering every module in ROADMAP_GRAPH.
 * Building the state from the fixed graph guarantees serialize/parse operate
 * over the same id set.
 */
const arbitraryRoadmapState: fc.Arbitrary<RoadmapState> = fc
  .tuple(
    ...ROADMAP_GRAPH.nodes.map((node) => arbitraryModuleState(node.id)),
  )
  .map((states) => {
    const modules: Record<string, ModuleState> = {};
    for (const st of states) modules[st.id] = st;
    return { modules };
  });

// --- Property ----------------------------------------------------------------

describe('Property 9: Roadmap_State serialization round-trip', () => {
  it('parseRoadmap(serializeRoadmap(g, s)) preserves the round-trippable fields', () => {
    fc.assert(
      fc.property(arbitraryRoadmapState, (s) => {
        const text = serializeRoadmap(ROADMAP_GRAPH, s);
        const s2 = parseRoadmap(text);

        for (const node of ROADMAP_GRAPH.nodes) {
          const id = node.id;
          const original = s.modules[id];
          const restored = s2.modules[id];

          // Every original module must reappear after the round-trip.
          expect(restored).toBeDefined();

          // status preserved exactly.
          expect(restored.status).toBe(original.status);

          // all four gates preserved (deep equal).
          expect(restored.gates).toEqual(original.gates);

          // blocker preserved (null stays null, safe token stays itself).
          expect(restored.blocker).toBe(original.blocker);

          // attempts preserved exactly.
          expect(restored.attempts).toBe(original.attempts);

          // updatedAt preserved (null stays null, ISO string stays itself).
          expect(restored.updatedAt).toBe(original.updatedAt);
        }
      }),
      { numRuns: 100 },
    );
  });
});
