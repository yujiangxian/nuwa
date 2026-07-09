// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

/**
 * integration-roadmap: state predicates and Roadmap_State (de)serialization.
 *
 * This module implements the orchestration layer's pure state logic on top of
 * the data models declared in modules.ts:
 *
 * - `canMarkDone`        — completion gate that depends ONLY on a module's own
 *                          upstreams (never reads downstream state; Property 5).
 * - `isStateConsistent`  — the R10.4 invariant: every Done module has all of
 *                          its upstreams Done too.
 * - `serializeRoadmap`   — render a RoadmapState to the exact ROADMAP.md
 *                          Markdown checkbox format defined in design.md.
 * - `parseRoadmap`       — inverse of serializeRoadmap; the round-trip preserves
 *                          status / gates / blocker / attempts / upstreams /
 *                          updatedAt (Property 9).
 *
 * All functions are pure: no disk I/O. `serializeRoadmap` returns a string and
 * `parseRoadmap` takes a string, so the caller owns any file access.
 *
 * Upstream lookups read `DependencyGraph` node.upstreams directly (no dependency
 * on graph.ts) to keep this module decoupled from the graph algorithms.
 */

import type {
  DependencyGraph,
  GateResult,
  ModuleState,
  ModuleStatus,
  RoadmapState,
} from './modules';

// --- Constants ---------------------------------------------------------------

/** Sentinel used in the serialized form for "no upstreams" / "no blocker". */
const NONE = '(none)';
/** Sentinel used in the serialized form for an absent timestamp. */
const DASH = '-';

/**
 * Milestone titles per Phase_Order, used as section headers in ROADMAP.md.
 * These are written by serialize but are NOT parsed back into RoadmapState.
 */
const MILESTONE_TITLES: Record<number, string> = {
  0: 'M0 基座就绪',
  1: 'M1 持久化与库基座',
  2: 'M2 对话核心增强',
  3: 'M3 交互与参数',
  4: 'M4 全功能完成',
};

/** Valid ModuleStatus values, used for defensive parsing. */
const MODULE_STATUSES: readonly ModuleStatus[] = [
  'Pending',
  'In_Progress',
  'Done',
  'Blocked',
];

// --- State predicates --------------------------------------------------------

/**
 * Return the upstream ids of `id` from the graph (empty when the node is a
 * Foundation_Module or is not present in the graph).
 */
function upstreamsOf(g: DependencyGraph, id: string): string[] {
  const node = g.nodes.find((n) => n.id === id);
  return node ? node.upstreams : [];
}

/**
 * True iff every direct Upstream_Dependency of `id` is currently 'Done'.
 *
 * This reads ONLY `id`'s own upstream states and never inspects any downstream
 * module, satisfying Property 5 (completion judgment depends only on self and
 * upstreams). A module with no upstreams (Foundation_Module) is always eligible.
 */
export function canMarkDone(
  g: DependencyGraph,
  s: RoadmapState,
  id: string,
): boolean {
  return upstreamsOf(g, id).every((u) => s.modules[u]?.status === 'Done');
}

/**
 * True iff the Roadmap_State satisfies the R10.4 consistency invariant: every
 * module that is 'Done' has all of its direct upstreams 'Done' as well.
 */
export function isStateConsistent(
  g: DependencyGraph,
  s: RoadmapState,
): boolean {
  return g.nodes.every((node) => {
    if (s.modules[node.id]?.status !== 'Done') return true;
    return node.upstreams.every((u) => s.modules[u]?.status === 'Done');
  });
}

// --- Serialization -----------------------------------------------------------

/**
 * Serialize a RoadmapState to the exact ROADMAP.md format from design.md.
 *
 * Modules are grouped into `## Phase N — <milestone>` sections in ascending
 * Phase_Order; within a phase, modules follow the order they appear in the
 * graph. The checkbox is `[x]` iff status is 'Done', otherwise `[ ]`. Empty
 * upstreams render as `(none)`, a null blocker as `(none)`, and a null
 * updatedAt as `-`.
 */
export function serializeRoadmap(
  g: DependencyGraph,
  s: RoadmapState,
): string {
  const lines: string[] = ['# Integration Roadmap State'];

  // Distinct phases present in the graph, ascending.
  const phases = Array.from(new Set(g.nodes.map((n) => n.phaseOrder))).sort(
    (a, b) => a - b,
  );

  for (const phase of phases) {
    const title = MILESTONE_TITLES[phase] ?? `M${phase}`;
    lines.push('');
    lines.push(`## Phase ${phase} — ${title}`);

    for (const node of g.nodes.filter((n) => n.phaseOrder === phase)) {
      const st = s.modules[node.id];
      // Fall back to a Pending placeholder if the state lacks this module.
      const state: ModuleState = st ?? {
        id: node.id,
        status: 'Pending',
        gates: { build: '-', test: '-', regression: '-', integration: '-' },
        blocker: null,
        attempts: 0,
        lastBlocker: null,
        updatedAt: null,
      };
      const checkbox = state.status === 'Done' ? 'x' : ' ';
      const upstreams =
        node.upstreams.length > 0 ? node.upstreams.join(', ') : NONE;

      lines.push(`- [${checkbox}] ${node.id} — status: ${state.status}`);
      lines.push(`      upstreams: ${upstreams}`);
      lines.push(`      gate.build: ${state.gates.build}`);
      lines.push(`      gate.test: ${state.gates.test}`);
      lines.push(`      gate.regression: ${state.gates.regression}`);
      lines.push(`      gate.integration: ${state.gates.integration}`);
      lines.push(`      blocker: ${state.blocker ?? NONE}`);
      lines.push(`      attempts: ${state.attempts}`);
      lines.push(`      updatedAt: ${state.updatedAt ?? DASH}`);
    }
  }

  return lines.join('\n') + '\n';
}

// --- Parsing -----------------------------------------------------------------

/** Coerce a raw gate string into a GateResult, defaulting to '-'. */
function parseGate(raw: string): GateResult {
  const v = raw.trim();
  if (v === 'pass' || v === 'fail' || v === 'n/a' || v === '-') return v;
  return '-';
}

/** Coerce a raw status string into a ModuleStatus, defaulting to 'Pending'. */
function parseStatus(raw: string): ModuleStatus {
  const v = raw.trim() as ModuleStatus;
  return MODULE_STATUSES.includes(v) ? v : 'Pending';
}

/**
 * Parse a ROADMAP.md text back into a RoadmapState (inverse of
 * serializeRoadmap). Milestone/phase headers are ignored — only module blocks
 * are read. The round-trip preserves status, gates, blocker, attempts,
 * upstreams and updatedAt; `lastBlocker` is not serialized and is reset to null.
 */
export function parseRoadmap(text: string): RoadmapState {
  const modules: Record<string, ModuleState> = {};
  const lines = text.split(/\r?\n/);

  // Matches "- [ ] some-id — status: Done" (checkbox + id + status).
  const headerRe = /^- \[([ xX])\]\s+(\S+)\s+—\s+status:\s+(.+)$/;
  // Matches an indented "  key: value" field line.
  const fieldRe = /^\s+([\w.]+):\s*(.*)$/;

  let current: ModuleState | null = null;

  const flush = () => {
    if (current) modules[current.id] = current;
  };

  for (const line of lines) {
    const header = headerRe.exec(line);
    if (header) {
      flush();
      const [, , id, statusRaw] = header;
      current = {
        id,
        status: parseStatus(statusRaw),
        gates: { build: '-', test: '-', regression: '-', integration: '-' },
        blocker: null,
        attempts: 0,
        lastBlocker: null,
        updatedAt: null,
      };
      continue;
    }

    if (!current) continue;

    const field = fieldRe.exec(line);
    if (!field) continue;
    const key = field[1];
    const value = field[2].trim();

    switch (key) {
      case 'upstreams':
        // upstreams are stored on the graph, not the state; we parse them here
        // for round-trip fidelity but RoadmapState itself carries no upstreams.
        break;
      case 'gate.build':
        current.gates.build = parseGate(value);
        break;
      case 'gate.test':
        current.gates.test = parseGate(value);
        break;
      case 'gate.regression':
        current.gates.regression = parseGate(value);
        break;
      case 'gate.integration':
        current.gates.integration = parseGate(value);
        break;
      case 'blocker':
        current.blocker = value === NONE ? null : value;
        break;
      case 'attempts': {
        const n = Number.parseInt(value, 10);
        current.attempts = Number.isNaN(n) ? 0 : n;
        break;
      }
      case 'updatedAt':
        current.updatedAt = value === DASH ? null : value;
        break;
      default:
        break;
    }
  }

  flush();
  return { modules };
}
