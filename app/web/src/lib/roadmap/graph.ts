// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

/**
 * integration-roadmap: pure dependency-graph functions.
 *
 * This module implements the orchestration layer's graph algorithms from the
 * design document's "Data Models" and "依赖门控执行算法" sections. Everything
 * here is a pure function over the in-memory `DependencyGraph` / `RoadmapState`
 * structures declared in `./modules`: no I/O, no side effects, deterministic.
 *
 * Edge convention (per design.md): an edge "A depends on B" is encoded as B
 * appearing in node A's `upstreams`. So an upstream is a prerequisite that must
 * finish first, and a downstream is a module that (directly or transitively)
 * depends on a given module.
 */

import type { DependencyGraph, ModuleNode, RoadmapState } from './modules';

/**
 * Build a quick id -> ModuleNode lookup for a graph.
 * Internal helper; keeps the public functions O(V+E) instead of O(V*E).
 */
function indexNodes(g: DependencyGraph): Map<string, ModuleNode> {
  const byId = new Map<string, ModuleNode>();
  for (const node of g.nodes) {
    byId.set(node.id, node);
  }
  return byId;
}

/**
 * Return true iff the dependency graph has no cycle.
 *
 * Uses an iterative DFS with three-color marking (white/gray/black) over the
 * "depends-on" edges (A -> each id in A.upstreams). A back-edge to a node that
 * is currently on the DFS stack (gray) means a cycle exists. This deliberately
 * does NOT rely on `phaseOrder`, so it can validate arbitrary graphs (including
 * randomly generated ones in property tests).
 *
 * Edges pointing to ids that are not present as nodes are ignored (they cannot
 * participate in a cycle within the known node set).
 */
export function isAcyclic(g: DependencyGraph): boolean {
  const byId = indexNodes(g);

  // 0 = unvisited (white), 1 = on current stack (gray), 2 = done (black).
  const color = new Map<string, number>();
  for (const node of g.nodes) {
    color.set(node.id, 0);
  }

  for (const start of g.nodes) {
    if (color.get(start.id) !== 0) {
      continue;
    }
    // Iterative DFS. Each frame tracks the node and the index of the next
    // upstream edge to explore, so we can detect when a node's subtree is done.
    const stack: Array<{ id: string; next: number }> = [{ id: start.id, next: 0 }];
    color.set(start.id, 1);

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const node = byId.get(frame.id);
      const upstreams = node ? node.upstreams : [];

      if (frame.next < upstreams.length) {
        const nextId = upstreams[frame.next];
        frame.next += 1;

        // Skip edges to unknown nodes.
        if (!byId.has(nextId)) {
          continue;
        }
        const c = color.get(nextId);
        if (c === 1) {
          // Back-edge to a node on the current stack => cycle.
          return false;
        }
        if (c === 0) {
          color.set(nextId, 1);
          stack.push({ id: nextId, next: 0 });
        }
        // c === 2 (already fully explored) => safe cross/forward edge, skip.
      } else {
        // All upstreams explored; mark black and pop.
        color.set(frame.id, 2);
        stack.pop();
      }
    }
  }

  return true;
}

/**
 * Compute each node's Build_Phase as `phase = max(phase of upstreams) + 1`,
 * with Foundation_Module (no upstreams) at phase 0.
 *
 * Returns a Map from module id to its computed phase order. Computation is done
 * via memoized recursion over the upstream edges, independent of any
 * pre-declared `phaseOrder` field.
 *
 * @throws {Error} if the graph contains a cycle (no valid layering exists).
 */
export function topoPhases(g: DependencyGraph): Map<string, number> {
  if (!isAcyclic(g)) {
    throw new Error('topoPhases: dependency graph contains a cycle; cannot layer it.');
  }

  const byId = indexNodes(g);
  const phases = new Map<string, number>();

  // Memoized depth = longest path to a foundation node along upstream edges.
  const computing = new Set<string>(); // guards against cycles defensively
  function phaseOf(id: string): number {
    const cached = phases.get(id);
    if (cached !== undefined) {
      return cached;
    }
    const node = byId.get(id);
    if (!node || node.upstreams.length === 0) {
      phases.set(id, 0);
      return 0;
    }
    if (computing.has(id)) {
      // Should be unreachable because isAcyclic passed; defensive guard.
      throw new Error(`topoPhases: cycle detected while computing phase of "${id}".`);
    }
    computing.add(id);
    let maxUpstream = -1;
    for (const up of node.upstreams) {
      if (byId.has(up)) {
        maxUpstream = Math.max(maxUpstream, phaseOf(up));
      }
    }
    computing.delete(id);

    const phase = maxUpstream + 1;
    phases.set(id, phase);
    return phase;
  }

  for (const node of g.nodes) {
    phaseOf(node.id);
  }

  return phases;
}

/**
 * Return true if any direct OR transitive upstream of `id` is 'Blocked'.
 *
 * Walks the upstream closure breadth-first. A module whose state is missing
 * from `s` is treated as not Blocked (it defaults to Pending semantics).
 */
export function anyUpstreamBlocked(g: DependencyGraph, s: RoadmapState, id: string): boolean {
  const byId = indexNodes(g);
  const visited = new Set<string>();
  const queue: string[] = [];

  const root = byId.get(id);
  if (root) {
    queue.push(...root.upstreams);
  }

  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);

    if (s.modules[current]?.status === 'Blocked') {
      return true;
    }
    const node = byId.get(current);
    if (node) {
      queue.push(...node.upstreams);
    }
  }

  return false;
}

/**
 * Return the set of all modules that depend on `id`, directly or transitively
 * (i.e. the transitive-downstream / reverse reachability closure).
 *
 * The returned set does NOT include `id` itself.
 */
export function transitiveDownstream(g: DependencyGraph, id: string): Set<string> {
  // Build the reverse adjacency: for each node, who lists it as an upstream.
  const dependents = new Map<string, string[]>();
  for (const node of g.nodes) {
    for (const up of node.upstreams) {
      const list = dependents.get(up);
      if (list) {
        list.push(node.id);
      } else {
        dependents.set(up, [node.id]);
      }
    }
  }

  const result = new Set<string>();
  const queue: string[] = [...(dependents.get(id) ?? [])];

  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (result.has(current)) {
      continue;
    }
    result.add(current);
    queue.push(...(dependents.get(current) ?? []));
  }

  return result;
}

/**
 * Gate selection (Requirements 7.1, 7.2, 7.4, 9.3).
 *
 * Return the ids of modules that are ready to be built next: a module is ready
 * iff
 *   - its own status is 'Pending', AND
 *   - all of its direct upstreams are 'Done', AND
 *   - none of its upstreams is 'Blocked' (directly or transitively).
 *
 * The result is sorted ascending by `phaseOrder` so that lower phases are
 * preferred (lower phases must complete before higher ones advance). Ties keep
 * the graph's declaration order, which is stable.
 *
 * Modules missing from the state are treated as Pending; an upstream missing
 * from the state is treated as not-Done (so the dependent is not ready).
 */
export function readyModules(g: DependencyGraph, s: RoadmapState): string[] {
  const ready: ModuleNode[] = [];

  for (const node of g.nodes) {
    const self = s.modules[node.id];
    const status = self?.status ?? 'Pending';
    if (status !== 'Pending') {
      continue;
    }

    // All direct upstreams must be Done.
    const allUpstreamsDone = node.upstreams.every(
      (up) => s.modules[up]?.status === 'Done',
    );
    if (!allUpstreamsDone) {
      continue;
    }

    // Defensive: exclude if any upstream is Blocked (direct or transitive).
    // When all direct upstreams are Done this is naturally satisfied, but the
    // explicit check keeps the gate correct for partially-populated states.
    if (anyUpstreamBlocked(g, s, node.id)) {
      continue;
    }

    ready.push(node);
  }

  ready.sort((a, b) => a.phaseOrder - b.phaseOrder);
  return ready.map((n) => n.id);
}
