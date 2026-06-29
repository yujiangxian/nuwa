/**
 * Workflow graph model — structural helpers.
 *
 * Feature: workflow-graph-model
 *
 * Pure, side-effect-free helpers for constructing the empty graph, accessing
 * nodes/edges/ports, building lookup indexes, classifying back-edges and the
 * forward subgraph, and deciding semantic graph equality.
 *
 * This module depends only on the data model types declared in `./types`.
 * Every exported function is pure: it never mutates its inputs and returns the
 * same output for the same input.
 */

import type {
  JsonValue,
  LoopScope,
  Port,
  PortType,
  WorkflowEdge,
  WorkflowGraph,
  WorkflowNode,
} from './types';

// ---------------------------------------------------------------------------
// 3.1 Empty graph construction and basic accessors (R1.6, R2.4, R2.5)
// ---------------------------------------------------------------------------

/**
 * Construct an empty WorkflowGraph: no nodes, no edges, no loop scopes, and a
 * null entry node id (R1.6).
 */
export function emptyGraph(): WorkflowGraph {
  return {
    nodes: [],
    edges: [],
    loopScopes: [],
    entryNodeId: null,
  };
}

/** Return the node with the given id, or `undefined` if absent. */
export function getNode(g: WorkflowGraph, nodeId: string): WorkflowNode | undefined {
  return g.nodes.find((n) => n.id === nodeId);
}

/** Return the edge with the given id, or `undefined` if absent. */
export function getEdge(g: WorkflowGraph, edgeId: string): WorkflowEdge | undefined {
  return g.edges.find((e) => e.id === edgeId);
}

/**
 * Return the input port of `node` with the given id, or `undefined`.
 * Input and output ports are looked up independently, so an input port and an
 * output port may share the same Port_Id (R2.5).
 */
export function getInputPort(node: WorkflowNode, portId: string): Port | undefined {
  return node.inputs.find((p) => p.id === portId);
}

/** Return the output port of `node` with the given id, or `undefined`. */
export function getOutputPort(node: WorkflowNode, portId: string): Port | undefined {
  return node.outputs.find((p) => p.id === portId);
}

// ---------------------------------------------------------------------------
// 3.2 Index builders (R7.1, R8.1)
// ---------------------------------------------------------------------------

/**
 * Build a read-only index mapping Node_Id -> WorkflowNode for O(1) lookup.
 * If duplicate ids exist (an invalid graph), the last occurrence wins; callers
 * that care about duplicates should detect them separately.
 */
export function buildNodeIndex(g: WorkflowGraph): ReadonlyMap<string, WorkflowNode> {
  const index = new Map<string, WorkflowNode>();
  for (const node of g.nodes) {
    index.set(node.id, node);
  }
  return index;
}

/**
 * Return all edges whose Target_Endpoint is on `nodeId`. When `portId` is given,
 * only edges targeting that specific input port are returned.
 */
export function incomingEdges(
  g: WorkflowGraph,
  nodeId: string,
  portId?: string,
): readonly WorkflowEdge[] {
  return g.edges.filter(
    (e) => e.target.nodeId === nodeId && (portId === undefined || e.target.portId === portId),
  );
}

/**
 * Return all edges whose Source_Endpoint is on `nodeId`. When `portId` is given,
 * only edges sourced from that specific output port are returned.
 */
export function outgoingEdges(
  g: WorkflowGraph,
  nodeId: string,
  portId?: string,
): readonly WorkflowEdge[] {
  return g.edges.filter(
    (e) => e.source.nodeId === nodeId && (portId === undefined || e.source.portId === portId),
  );
}

// ---------------------------------------------------------------------------
// 3.3 Back-edges, forward subgraph and adjacency (R10.1, R11.3)
// ---------------------------------------------------------------------------

/**
 * Return the set of well-formed back-edges (R11.3).
 *
 * An edge is a well-formed back-edge iff there exists a LoopScope `S` such that
 * `edge.target.nodeId === S.headerNodeId` AND `edge.source.nodeId` is a member
 * of `S.bodyNodeIds`. Back-edges are the only edges allowed to form cycles.
 */
export function backEdges(g: WorkflowGraph): readonly WorkflowEdge[] {
  return g.edges.filter((e) => isWellFormedBackEdge(g.loopScopes, e));
}

/**
 * Return the forward edges: all edges minus the well-formed back-edges.
 * The Forward_Subgraph is the directed graph over all nodes and these edges.
 */
export function forwardEdges(g: WorkflowGraph): readonly WorkflowEdge[] {
  return g.edges.filter((e) => !isWellFormedBackEdge(g.loopScopes, e));
}

/**
 * Build the forward adjacency list: source Node_Id -> list of target Node_Ids,
 * computed over the forward edges only. Every node appears as a key (with a
 * possibly empty target list) so consumers can iterate all nodes uniformly.
 * Target lists preserve forward-edge encounter order.
 */
export function forwardAdjacency(g: WorkflowGraph): ReadonlyMap<string, readonly string[]> {
  const adjacency = new Map<string, string[]>();
  for (const node of g.nodes) {
    adjacency.set(node.id, []);
  }
  for (const e of forwardEdges(g)) {
    const targets = adjacency.get(e.source.nodeId);
    if (targets === undefined) {
      // Source node is not in the node set (an invalid graph); still track it
      // so the adjacency reflects the edge.
      adjacency.set(e.source.nodeId, [e.target.nodeId]);
    } else {
      targets.push(e.target.nodeId);
    }
  }
  return adjacency;
}

/** Internal: whether `edge` is a well-formed back-edge against the given loop scopes. */
function isWellFormedBackEdge(loopScopes: readonly LoopScope[], edge: WorkflowEdge): boolean {
  return loopScopes.some(
    (s) => edge.target.nodeId === s.headerNodeId && s.bodyNodeIds.includes(edge.source.nodeId),
  );
}

// ---------------------------------------------------------------------------
// 3.4 Semantic graph equality (R18.3, R18.5)
// ---------------------------------------------------------------------------

/**
 * Decide semantic equivalence of two graphs, ignoring the array order of
 * nodes, edges, loop scopes and ports (R18.3, R18.5).
 *
 * Nodes/edges/loop scopes are matched by id and compared deeply. Ports are
 * compared by id + direction + portType + required. Node configs are deep
 * compared as JSON values (object key order is irrelevant; array order is
 * significant). Loop-scope body node id collections are compared as sets.
 */
export function graphEquals(a: WorkflowGraph, b: WorkflowGraph): boolean {
  if (a.entryNodeId !== b.entryNodeId) return false;

  if (!sameSizeById(a.nodes, b.nodes)) return false;
  if (!sameSizeById(a.edges, b.edges)) return false;
  if (!sameSizeById(a.loopScopes, b.loopScopes)) return false;

  const bNodes = indexById(b.nodes);
  for (const node of a.nodes) {
    const other = bNodes.get(node.id);
    if (other === undefined || !nodesEqual(node, other)) return false;
  }

  const bEdges = indexById(b.edges);
  for (const edge of a.edges) {
    const other = bEdges.get(edge.id);
    if (other === undefined || !edgesEqual(edge, other)) return false;
  }

  const bScopes = indexById(b.loopScopes);
  for (const scope of a.loopScopes) {
    const other = bScopes.get(scope.id);
    if (other === undefined || !loopScopesEqual(scope, other)) return false;
  }

  return true;
}

/** Internal: index a collection of id-bearing items by id. */
function indexById<T extends { readonly id: string }>(items: readonly T[]): Map<string, T> {
  const m = new Map<string, T>();
  for (const item of items) m.set(item.id, item);
  return m;
}

/**
 * Internal: two collections agree on the set of ids and have equal length.
 * Equal length plus a successful per-id lookup (done by the caller) guarantees
 * a bijection, so this rejects mismatched sizes early.
 */
function sameSizeById<T extends { readonly id: string }>(
  xs: readonly T[],
  ys: readonly T[],
): boolean {
  if (xs.length !== ys.length) return false;
  const xIds = new Set(xs.map((x) => x.id));
  const yIds = new Set(ys.map((y) => y.id));
  if (xIds.size !== yIds.size) return false;
  for (const id of xIds) {
    if (!yIds.has(id)) return false;
  }
  return true;
}

/** Internal: deep equality of two nodes (ports order-insensitive, config deep). */
function nodesEqual(a: WorkflowNode, b: WorkflowNode): boolean {
  if (a.id !== b.id) return false;
  if (a.type !== b.type) return false;
  if (!portsEqual(a.inputs, b.inputs)) return false;
  if (!portsEqual(a.outputs, b.outputs)) return false;
  if (!jsonValueEquals(a.config, b.config)) return false;
  return true;
}

/** Internal: order-insensitive equality of two port collections, matched by id. */
function portsEqual(a: readonly Port[], b: readonly Port[]): boolean {
  if (a.length !== b.length) return false;
  const bById = new Map<string, Port>();
  for (const p of b) bById.set(p.id, p);
  if (bById.size !== a.length) return false; // duplicate ids would break the bijection
  for (const p of a) {
    const other = bById.get(p.id);
    if (other === undefined || !portEqual(p, other)) return false;
  }
  return true;
}

/** Internal: a single port compared by id + direction + portType + required. */
function portEqual(a: Port, b: Port): boolean {
  return (
    a.id === b.id &&
    a.direction === b.direction &&
    a.required === b.required &&
    portTypeEquals(a.portType, b.portType)
  );
}

/** Internal: structural deep equality of two PortType values. */
function portTypeEquals(a: PortType, b: PortType): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'list' && b.kind === 'list') {
    return portTypeEquals(a.element, b.element);
  }
  if (a.kind === 'optional' && b.kind === 'optional') {
    return portTypeEquals(a.inner, b.inner);
  }
  // Base kinds (string/number/boolean/json/message) carry no payload.
  return true;
}

/** Internal: deep equality of two edges by id and endpoints. */
function edgesEqual(a: WorkflowEdge, b: WorkflowEdge): boolean {
  return (
    a.id === b.id &&
    a.source.nodeId === b.source.nodeId &&
    a.source.portId === b.source.portId &&
    a.target.nodeId === b.target.nodeId &&
    a.target.portId === b.target.portId
  );
}

/** Internal: deep equality of two loop scopes; body node ids compared as sets. */
function loopScopesEqual(a: LoopScope, b: LoopScope): boolean {
  if (a.id !== b.id) return false;
  if (a.headerNodeId !== b.headerNodeId) return false;
  if (a.bodyNodeIds.length !== b.bodyNodeIds.length) return false;
  const aSet = new Set(a.bodyNodeIds);
  const bSet = new Set(b.bodyNodeIds);
  if (aSet.size !== bSet.size) return false;
  for (const id of aSet) {
    if (!bSet.has(id)) return false;
  }
  return true;
}

/**
 * Internal: deep equality of two JSON values. Object key order is irrelevant;
 * array element order is significant (arrays are ordered by semantics).
 */
function jsonValueEquals(a: JsonValue, b: JsonValue): boolean {
  if (a === b) return true;

  // Distinguish null from objects before the typeof checks below.
  if (a === null || b === null) return a === b;

  const ta = typeof a;
  const tb = typeof b;
  if (ta !== tb) return false;

  if (ta !== 'object') {
    // Primitives (boolean/number/string) — already handled by === above.
    return false;
  }

  const aIsArray = Array.isArray(a);
  const bIsArray = Array.isArray(b);
  if (aIsArray !== bIsArray) return false;

  if (aIsArray && bIsArray) {
    const arrA = a as readonly JsonValue[];
    const arrB = b as readonly JsonValue[];
    if (arrA.length !== arrB.length) return false;
    for (let i = 0; i < arrA.length; i++) {
      if (!jsonValueEquals(arrA[i], arrB[i])) return false;
    }
    return true;
  }

  // Both are plain objects: compare key sets and values, key order irrelevant.
  const objA = a as { readonly [key: string]: JsonValue };
  const objB = b as { readonly [key: string]: JsonValue };
  const keysA = Object.keys(objA);
  const keysB = Object.keys(objB);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(objB, key)) return false;
    if (!jsonValueEquals(objA[key], objB[key])) return false;
  }
  return true;
}
