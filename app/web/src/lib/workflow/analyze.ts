/**
 * Workflow graph model — topological analysis.
 *
 * Feature: workflow-graph-model
 *
 * Pure, side-effect-free analyses over the Forward_Subgraph (all edges minus
 * the well-formed back-edges). The analyzer assumes a Valid_Graph for the
 * topological-order / layering / critical-path semantics to be meaningful, but
 * `detectCycles` is total and works even on cyclic forward subgraphs.
 *
 * This module depends only on the data model types in `./types` and the
 * structural helpers in `./graph`. Every exported function is pure: it never
 * mutates its inputs and returns the same output for the same input.
 *
 * See design.md "关键算法 4-6" for the precise algorithms.
 */

import type {
  AnalysisResult,
  CriticalPath,
  Cycle,
  Layering,
  TopoOrder,
  WorkflowGraph,
} from './types';
import { forwardAdjacency, forwardEdges } from './graph';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Return the set of all Node_Ids declared by the graph. */
function nodeIdSet(g: WorkflowGraph): Set<string> {
  return new Set(g.nodes.map((n) => n.id));
}

/**
 * Build the forward predecessor map: target Node_Id -> list of source Node_Ids,
 * computed over the forward edges only. Only edges whose endpoints are both in
 * the node set contribute (defensive against malformed inputs).
 */
function forwardPredecessors(
  g: WorkflowGraph,
  ids: ReadonlySet<string>,
): ReadonlyMap<string, readonly string[]> {
  const preds = new Map<string, string[]>();
  for (const id of ids) preds.set(id, []);
  for (const e of forwardEdges(g)) {
    if (ids.has(e.target.nodeId) && ids.has(e.source.nodeId)) {
      preds.get(e.target.nodeId)!.push(e.source.nodeId);
    }
  }
  return preds;
}

// ---------------------------------------------------------------------------
// 7.1 Topological order (R13.1, R13.2, R13.3, R13.6)
// ---------------------------------------------------------------------------

/**
 * Compute a deterministic topological order of the Forward_Subgraph using
 * Kahn's algorithm with a ready-queue ordered by Node_Id lexicographically
 * (R13.6). On each step the lexicographically smallest in-degree-zero node is
 * removed, appended to the result, and its successors' in-degrees decremented.
 *
 * The result contains every forward-subgraph node exactly once for a Valid_Graph
 * (which is guaranteed acyclic). If the forward subgraph contains a cycle (not a
 * Valid_Graph), the nodes that remain inside the cycle are simply omitted, so the
 * function stays total.
 */
export function topologicalOrder(g: WorkflowGraph): TopoOrder {
  const ids = nodeIdSet(g);
  const adjacency = forwardAdjacency(g);

  // In-degree over forward edges (count edges, matching adjacency multiplicity).
  const inDegree = new Map<string, number>();
  for (const id of ids) inDegree.set(id, 0);
  for (const e of forwardEdges(g)) {
    if (ids.has(e.target.nodeId)) {
      inDegree.set(e.target.nodeId, (inDegree.get(e.target.nodeId) ?? 0) + 1);
    }
  }

  // Ready queue: all in-degree-zero nodes, always consumed smallest-id first.
  const ready: string[] = [];
  for (const id of ids) {
    if ((inDegree.get(id) ?? 0) === 0) ready.push(id);
  }

  const result: string[] = [];
  while (ready.length > 0) {
    ready.sort();
    const u = ready.shift()!;
    result.push(u);
    for (const v of adjacency.get(u) ?? []) {
      if (!inDegree.has(v)) continue;
      const next = (inDegree.get(v) ?? 0) - 1;
      inDegree.set(v, next);
      if (next === 0) ready.push(v);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// 7.2 Layering (R13.4, R13.5)
// ---------------------------------------------------------------------------

/**
 * Assign a layer number to every Reachable_Node: `layer(entry) === 0` and
 * `layer(v) === max(layer(u) over forward predecessors u) + 1`. Only reachable
 * nodes receive a layer (unreachable nodes are outside the entry propagation).
 *
 * Nodes are processed in topological order so every predecessor is resolved
 * before the node itself, guaranteeing the strictly-increasing invariant along
 * each forward edge (R13.5).
 */
export function layering(g: WorkflowGraph): Layering {
  const reachable = reachableNodes(g);
  const ids = nodeIdSet(g);
  const preds = forwardPredecessors(g, ids);
  const order = topologicalOrder(g);

  const layer = new Map<string, number>();
  for (const v of order) {
    if (!reachable.has(v)) continue;
    let best = -1; // -1 means "no resolved predecessor yet"
    for (const u of preds.get(v) ?? []) {
      if (!reachable.has(u)) continue;
      const lu = layer.get(u);
      if (lu !== undefined && lu > best) best = lu;
    }
    // Entry (and any reachable node without a resolved predecessor) starts at 0.
    layer.set(v, best < 0 ? 0 : best + 1);
  }

  return layer;
}

// ---------------------------------------------------------------------------
// 7.3 Reachable nodes (R14.1, R14.5)
// ---------------------------------------------------------------------------

/**
 * Compute the set of nodes reachable from the EntryNode along forward edges
 * (BFS over the forward adjacency). The EntryNode itself is included when it
 * exists in the node set (R14.5). Returns an empty set when there is no entry
 * node or the entry node is absent from the graph.
 */
export function reachableNodes(g: WorkflowGraph): ReadonlySet<string> {
  const ids = nodeIdSet(g);
  const reachable = new Set<string>();
  if (g.entryNodeId === null || !ids.has(g.entryNodeId)) return reachable;

  const adjacency = forwardAdjacency(g);
  const queue: string[] = [g.entryNodeId];
  reachable.add(g.entryNodeId);
  while (queue.length > 0) {
    const u = queue.shift()!;
    for (const v of adjacency.get(u) ?? []) {
      if (ids.has(v) && !reachable.has(v)) {
        reachable.add(v);
        queue.push(v);
      }
    }
  }

  return reachable;
}

// ---------------------------------------------------------------------------
// 7.4 Orphan nodes (R14.2)
// ---------------------------------------------------------------------------

/**
 * Identify Orphan_Nodes: nodes that are neither the EntryNode nor the target of
 * any forward incoming edge. The result is sorted lexicographically so it is
 * deterministic regardless of input array order.
 */
export function orphanNodes(g: WorkflowGraph): readonly string[] {
  const ids = nodeIdSet(g);

  // Node_Ids that have at least one forward incoming edge.
  const hasIncoming = new Set<string>();
  for (const e of forwardEdges(g)) {
    if (ids.has(e.target.nodeId)) hasIncoming.add(e.target.nodeId);
  }

  const orphans: string[] = [];
  for (const node of g.nodes) {
    if (node.id === g.entryNodeId) continue;
    if (!hasIncoming.has(node.id)) orphans.push(node.id);
  }
  orphans.sort();
  return orphans;
}

// ---------------------------------------------------------------------------
// 7.5 Unreachable nodes (R14.3, R14.4)
// ---------------------------------------------------------------------------

/**
 * Return the nodes that are not in the Reachable_Node set. By construction the
 * reachable and unreachable sets are disjoint and their union is exactly the
 * full node set (R14.4). The result is sorted lexicographically for
 * determinism.
 */
export function unreachableNodes(g: WorkflowGraph): readonly string[] {
  const reachable = reachableNodes(g);
  const unreachable: string[] = [];
  for (const node of g.nodes) {
    if (!reachable.has(node.id)) unreachable.push(node.id);
  }
  unreachable.sort();
  return unreachable;
}

// ---------------------------------------------------------------------------
// 7.6 Cycle detection and extraction (R15)
// ---------------------------------------------------------------------------

/**
 * Detect cycles in the Forward_Subgraph via a three-color (white/gray/black)
 * DFS that visits nodes and neighbors in lexicographic order for determinism.
 *
 * When the DFS encounters an edge into a gray (on-stack) node, the slice of the
 * current path from that gray node to the current node is a cycle: adjacent
 * Node_Ids (including the wrap-around from the last back to the first) are
 * connected by a forward edge (R15.3). Returns an empty array when the forward
 * subgraph is acyclic (R15.4). Duplicate detections of the same cycle are
 * collapsed to a single entry (keyed by rotation-invariant canonical form).
 */
export function detectCycles(g: WorkflowGraph): readonly Cycle[] {
  const ids = nodeIdSet(g);

  // Forward adjacency restricted to the node set, with neighbors sorted
  // lexicographically to make the traversal deterministic.
  const adjacency = new Map<string, string[]>();
  for (const id of ids) adjacency.set(id, []);
  for (const e of forwardEdges(g)) {
    if (ids.has(e.source.nodeId) && ids.has(e.target.nodeId)) {
      adjacency.get(e.source.nodeId)!.push(e.target.nodeId);
    }
  }
  for (const targets of adjacency.values()) targets.sort();

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const id of ids) color.set(id, WHITE);

  const path: string[] = []; // current DFS stack (forward tree path)
  const cycles: Cycle[] = [];
  const seen = new Set<string>(); // canonical cycle keys, for de-duplication

  /** Rotation-invariant canonical key: rotate so the smallest id is first. */
  const cycleKey = (cycle: readonly string[]): string => {
    let minIdx = 0;
    for (let i = 1; i < cycle.length; i++) {
      if (cycle[i] < cycle[minIdx]) minIdx = i;
    }
    const rotated = [...cycle.slice(minIdx), ...cycle.slice(0, minIdx)];
    return rotated.join('\u0000');
  };

  const visit = (u: string): void => {
    color.set(u, GRAY);
    path.push(u);
    for (const v of adjacency.get(u) ?? []) {
      const c = color.get(v);
      if (c === WHITE) {
        visit(v);
      } else if (c === GRAY) {
        // Found a back-edge u -> v: extract the on-stack segment [v .. u].
        const start = path.lastIndexOf(v);
        if (start >= 0) {
          const cycle = path.slice(start);
          const key = cycleKey(cycle);
          if (!seen.has(key)) {
            seen.add(key);
            cycles.push(cycle);
          }
        }
      }
    }
    path.pop();
    color.set(u, BLACK);
  };

  // Start DFS from each node in lexicographic order for a deterministic result.
  for (const id of [...ids].sort()) {
    if (color.get(id) === WHITE) visit(id);
  }

  return cycles;
}

// ---------------------------------------------------------------------------
// 7.7 Critical path / longest path (R16)
// ---------------------------------------------------------------------------

/**
 * Compute the Critical_Path: the longest forward path (measured in node count)
 * starting from the EntryNode, via dynamic programming over the topological
 * order of the forward DAG (R16). `dist[entry] = 1` and
 * `dist[v] = max(dist[u] + 1)` over reachable forward predecessors `u`, with the
 * predecessor pointer for ties broken by the lexicographically smallest Node_Id
 * (deterministic). The path is recovered by following predecessor pointers from
 * the reachable node with the greatest distance (ties broken by smallest
 * Node_Id) and reversing.
 *
 * When only the EntryNode is reachable the result is `[entry]` (length 1,
 * R16.4). When there is no reachable entry node the result is empty.
 */
export function criticalPath(g: WorkflowGraph): CriticalPath {
  const reachable = reachableNodes(g);
  if (reachable.size === 0) return [];

  const ids = nodeIdSet(g);
  const preds = forwardPredecessors(g, ids);
  const order = topologicalOrder(g);

  const dist = new Map<string, number>();
  const pred = new Map<string, string | null>();

  for (const v of order) {
    if (!reachable.has(v)) continue;
    let bestDist = 0;
    let bestPred: string | null = null;
    for (const u of preds.get(v) ?? []) {
      if (!reachable.has(u)) continue;
      const du = dist.get(u);
      if (du === undefined) continue;
      if (du > bestDist || (du === bestDist && (bestPred === null || u < bestPred))) {
        bestDist = du;
        bestPred = u;
      }
    }
    dist.set(v, bestPred === null ? 1 : bestDist + 1);
    pred.set(v, bestPred);
  }

  // Find the reachable node with the greatest distance; ties -> smallest id.
  let endNode: string | null = null;
  let endDist = -1;
  for (const id of [...reachable].sort()) {
    const d = dist.get(id);
    if (d !== undefined && d > endDist) {
      endDist = d;
      endNode = id;
    }
  }
  if (endNode === null) return [];

  // Backtrack predecessor pointers, then reverse to start from the EntryNode.
  const reversed: string[] = [];
  let cur: string | null = endNode;
  while (cur !== null) {
    reversed.push(cur);
    cur = pred.get(cur) ?? null;
  }
  reversed.reverse();
  return reversed;
}

// ---------------------------------------------------------------------------
// 7.8 Aggregate analysis (R13.1, R14.1, R15.1, R16.1)
// ---------------------------------------------------------------------------

/**
 * Run every analysis once and bundle the results into a single AnalysisResult:
 * topological order, layering, reachable set, orphan nodes, unreachable nodes,
 * detected cycles and the critical path.
 */
export function analyzeGraph(g: WorkflowGraph): AnalysisResult {
  return {
    topoOrder: topologicalOrder(g),
    layering: layering(g),
    reachable: reachableNodes(g),
    orphans: orphanNodes(g),
    unreachable: unreachableNodes(g),
    cycles: detectCycles(g),
    criticalPath: criticalPath(g),
  };
}
