/**
 * Workflow execution engine — state module (`engine/state.ts`).
 *
 * Feature: workflow-execution-engine
 *
 * Pure, side-effect-free state construction, readiness computation, immutable
 * update helpers, semantic state equality and well-formedness invariants for the
 * ExecutionState. Every exported function is pure: it never mutates its inputs and
 * returns the same output for the same input. No I/O, no time/random dependency.
 *
 * Depends on the execution-layer types in `./types` and the already-implemented
 * base layer (`../types`, `../validate`, `../analyze`, `../graph`).
 */

import type { Endpoint, JsonValue, WorkflowGraph } from '../types';
import type {
  EngineError,
  ExecutionState,
  ExecutionStatus,
  RunStatus,
  ValueKey,
} from './types';
import { ExecutorErrorCode } from './types';
import { validateGraph } from '../validate';
import { incomingEdges, getNode } from '../graph';

// ---------------------------------------------------------------------------
// 2.1 Initial state construction and Value_Key encoding/decoding
// ---------------------------------------------------------------------------

/**
 * Construct the initial ExecutionState for a Valid_Graph (R2.5, self-review note a):
 *  - runStatus = 'Idle'
 *  - valueStore = empty; satisfiedEdges = empty
 *  - every LoopScope's loopCounter = 0
 *  - pendingHumanInput = null
 *  - nodeStatus: the EntryNode = 'Ready', every other node = 'Pending'
 *    (the Node_Status_Map has exactly one entry per node, R2.7)
 *
 * If `graph` does not pass `validateGraph`, returns an INVALID_GRAPH error (R1.5)
 * and never constructs a state.
 */
export function initialState(
  graph: WorkflowGraph,
):
  | { readonly ok: true; readonly state: ExecutionState }
  | { readonly ok: false; readonly error: EngineError } {
  const validation = validateGraph(graph);
  if (!validation.valid) {
    return {
      ok: false,
      error: {
        code: ExecutorErrorCode.INVALID_GRAPH,
        message: `Cannot construct initial state: the graph is invalid (${validation.errors.length} error(s)).`,
      },
    };
  }

  // Exactly one Node_Status_Map entry per node; EntryNode is 'Ready', rest 'Pending'.
  const nodeStatus = new Map<string, ExecutionStatus>();
  for (const node of graph.nodes) {
    nodeStatus.set(node.id, node.id === graph.entryNodeId ? 'Ready' : 'Pending');
  }

  // Every declared LoopScope starts with a zero loop counter.
  const loopCounters = new Map<string, number>();
  for (const scope of graph.loopScopes) {
    loopCounters.set(scope.id, 0);
  }

  const state: ExecutionState = {
    nodeStatus,
    valueStore: new Map(),
    satisfiedEdges: new Set(),
    loopCounters,
    runStatus: 'Idle',
    pendingHumanInput: null,
  };

  return { ok: true, state };
}

/** Canonical string encoding of a Value_Key: `${nodeId}\u0000${portId}\u0000${iterationIndex}`. */
export function valueKeyToString(key: ValueKey): string {
  return `${key.endpoint.nodeId}\u0000${key.endpoint.portId}\u0000${key.iterationIndex}`;
}

/**
 * Inverse of `valueKeyToString`. The separator (NUL) never occurs inside a
 * Node_Id / Port_Id, so the three segments are recovered unambiguously. Throws on
 * a structurally malformed string; serialization code performs its own validation
 * before calling this.
 */
export function valueKeyFromString(s: string): ValueKey {
  const parts = s.split('\u0000');
  if (parts.length !== 3) {
    throw new Error(`Malformed Value_Key string: expected 3 segments, got ${parts.length}.`);
  }
  const [nodeId, portId, iterationRaw] = parts;
  const iterationIndex = Number(iterationRaw);
  if (!Number.isInteger(iterationIndex) || iterationIndex < 0) {
    throw new Error(`Malformed Value_Key string: invalid iterationIndex "${iterationRaw}".`);
  }
  return { endpoint: { nodeId, portId }, iterationIndex };
}

// ---------------------------------------------------------------------------
// 2.2 Readiness computation and gating queries
// ---------------------------------------------------------------------------

/**
 * Whether, in the given `state` and iteration scope `iterationIndex`, every
 * required Input_Port of `nodeId` already holds a produced value in the ValueStore
 * (the precondition-readiness invariant, R5.1/R5.3).
 *
 * Required inputs are determined by `incomingEdges` + the port's `required` flag.
 * A required input with no incoming edge is never satisfiable (it can never receive
 * a produced value), so the node can never become ready through this path.
 */
export function requiredInputsSatisfied(
  graph: WorkflowGraph,
  state: ExecutionState,
  nodeId: string,
  iterationIndex: number,
): boolean {
  const node = getNode(graph, nodeId);
  if (node === undefined) return false;

  for (const port of node.inputs) {
    if (!port.required) continue;

    // A required input with no incoming edge can never be supplied -> never satisfiable.
    const edges = incomingEdges(graph, nodeId, port.id);
    if (edges.length === 0) return false;

    // The value is copied to the target Input_Port's Value_Key in the same iteration scope.
    const endpoint: Endpoint = { nodeId, portId: port.id };
    const keyStr = valueKeyToString({ endpoint, iterationIndex });
    if (!state.valueStore.has(keyStr)) return false;
  }

  return true;
}

/**
 * Upstream gate: returns true iff every upstream node feeding a required input of
 * `nodeId` is already 'Completed' or determinedly 'Skipped' (R5.4). The untaken
 * side of a condition branch satisfies the gate via 'Skipped'.
 */
export function upstreamGateSatisfied(
  graph: WorkflowGraph,
  state: ExecutionState,
  nodeId: string,
): boolean {
  const node = getNode(graph, nodeId);
  if (node === undefined) return false;

  for (const port of node.inputs) {
    if (!port.required) continue;
    for (const edge of incomingEdges(graph, nodeId, port.id)) {
      const sourceStatus = state.nodeStatus.get(edge.source.nodeId);
      if (sourceStatus !== 'Completed' && sourceStatus !== 'Skipped') {
        return false;
      }
    }
  }

  return true;
}

/**
 * Recompute readiness for every Pending node: promote a Pending node to 'Ready'
 * when its required inputs are satisfied (in its current iteration scope) AND its
 * upstream gate is satisfied. Returns a new state (never mutates in place); when no
 * node is promoted the original `state` reference is returned unchanged.
 */
export function recomputeReady(graph: WorkflowGraph, state: ExecutionState): ExecutionState {
  let promoted: Map<string, ExecutionStatus> | null = null;

  for (const node of graph.nodes) {
    if (state.nodeStatus.get(node.id) !== 'Pending') continue;

    const iterationIndex = currentIterationIndex(graph, state, node.id);
    if (
      requiredInputsSatisfied(graph, state, node.id, iterationIndex) &&
      upstreamGateSatisfied(graph, state, node.id)
    ) {
      if (promoted === null) promoted = new Map(state.nodeStatus);
      promoted.set(node.id, 'Ready');
    }
  }

  if (promoted === null) return state;
  return { ...state, nodeStatus: promoted };
}

/** Collect the Node_Ids of all 'Ready' nodes (an unordered set used by step's ready selection). */
export function readyNodeIds(state: ExecutionState): readonly string[] {
  const ids: string[] = [];
  for (const [nodeId, status] of state.nodeStatus) {
    if (status === 'Ready') ids.push(nodeId);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// 2.3 Immutable update helpers, semantic equality and invariants
// ---------------------------------------------------------------------------

/** Return a new state with `nodeId`'s ExecutionStatus set to `status` (never mutates). */
export function withNodeStatus(
  state: ExecutionState,
  nodeId: string,
  status: ExecutionStatus,
): ExecutionState {
  const nodeStatus = new Map(state.nodeStatus);
  nodeStatus.set(nodeId, status);
  return { ...state, nodeStatus };
}

/**
 * Return a new state with the produced value written under `key` — monotonic add
 * ONLY: an existing Value_Key is never overwritten (write-once, R6.1/R6.4). When the
 * key already exists the original `state` is returned unchanged.
 */
export function withValue(state: ExecutionState, key: ValueKey, value: JsonValue): ExecutionState {
  const keyStr = valueKeyToString(key);
  if (state.valueStore.has(keyStr)) return state; // never overwrite

  const valueStore = new Map(state.valueStore);
  valueStore.set(keyStr, { key, value });
  return { ...state, valueStore };
}

/** Return a new state with `edgeId` added to the Satisfied_Edge_Set. */
export function withSatisfiedEdge(state: ExecutionState, edgeId: string): ExecutionState {
  if (state.satisfiedEdges.has(edgeId)) return state;
  const satisfiedEdges = new Set(state.satisfiedEdges);
  satisfiedEdges.add(edgeId);
  return { ...state, satisfiedEdges };
}

/** Return a new state with the given RunStatus. */
export function withRunStatus(state: ExecutionState, runStatus: RunStatus): ExecutionState {
  if (state.runStatus === runStatus) return state;
  return { ...state, runStatus };
}

/** Return a new state with the LoopScope's loop counter incremented by one. */
export function incrementLoopCounter(state: ExecutionState, loopScopeId: string): ExecutionState {
  const loopCounters = new Map(state.loopCounters);
  loopCounters.set(loopScopeId, (loopCounters.get(loopScopeId) ?? 0) + 1);
  return { ...state, loopCounters };
}

/**
 * Semantic equality of two ExecutionStates, ignoring the enumeration order of the
 * internal containers (used by property tests and resume-equivalence assertions,
 * R13.x / R16.1). Maps and sets are compared by key membership (order-independent);
 * stored values are compared by deep JSON equality.
 */
export function stateEquals(a: ExecutionState, b: ExecutionState): boolean {
  if (a.runStatus !== b.runStatus) return false;
  if (a.pendingHumanInput !== b.pendingHumanInput) return false;

  // nodeStatus: same keys and same status per key.
  if (a.nodeStatus.size !== b.nodeStatus.size) return false;
  for (const [nodeId, status] of a.nodeStatus) {
    if (b.nodeStatus.get(nodeId) !== status) return false;
  }

  // loopCounters: same keys and same counts.
  if (a.loopCounters.size !== b.loopCounters.size) return false;
  for (const [scopeId, count] of a.loopCounters) {
    if (b.loopCounters.get(scopeId) !== count) return false;
  }

  // satisfiedEdges: same membership.
  if (a.satisfiedEdges.size !== b.satisfiedEdges.size) return false;
  for (const edgeId of a.satisfiedEdges) {
    if (!b.satisfiedEdges.has(edgeId)) return false;
  }

  // valueStore: same keys and deep-equal stored values.
  if (a.valueStore.size !== b.valueStore.size) return false;
  for (const [keyStr, stored] of a.valueStore) {
    const other = b.valueStore.get(keyStr);
    if (other === undefined) return false;
    if (!jsonValueEquals(stored.value, other.value)) return false;
  }

  return true;
}

/**
 * Well-formedness predicate over the §17 run-status-machine consistency invariants
 * (reused by the §17 consistency property). Returns true iff every invariant holds.
 *
 *  R17.1  Idle      => ValueStore empty, Satisfied_Edge_Set empty, all LoopCounter = 0,
 *                      and no node is 'Completed' (the EntryNode is 'Ready', not Completed).
 *  R17.2  Completed => no node is 'Ready' or 'Running'.
 *  R17.3  Failed    => at least one node is 'Failed'.
 *  R17.4  Paused    => pendingHumanInput is non-null and that node's NodeType is 'human_input'.
 *  R17.5  every node has exactly one ExecutionStatus drawn from the 7-value set
 *                      (status is exhaustive and mutually exclusive).
 *  R17.6  the Satisfied_Edge_Set contains only edges whose source node is 'Completed'.
 */
export function checkRunStatusInvariants(graph: WorkflowGraph, state: ExecutionState): boolean {
  const VALID_STATUSES: ReadonlySet<ExecutionStatus> = new Set<ExecutionStatus>([
    'Pending',
    'Ready',
    'Running',
    'Completed',
    'Skipped',
    'Failed',
    'Blocked',
  ]);

  // R17.5: exactly one entry per node, each a valid status (exhaustive + exclusive).
  if (state.nodeStatus.size !== graph.nodes.length) return false;
  for (const node of graph.nodes) {
    const status = state.nodeStatus.get(node.id);
    if (status === undefined || !VALID_STATUSES.has(status)) return false;
  }

  // R17.6: every satisfied edge has a Completed source node.
  for (const edgeId of state.satisfiedEdges) {
    const edge = graph.edges.find((e) => e.id === edgeId);
    if (edge === undefined) return false;
    if (state.nodeStatus.get(edge.source.nodeId) !== 'Completed') return false;
  }

  switch (state.runStatus) {
    case 'Idle': {
      // R17.1
      if (state.valueStore.size !== 0) return false;
      if (state.satisfiedEdges.size !== 0) return false;
      for (const count of state.loopCounters.values()) {
        if (count !== 0) return false;
      }
      for (const status of state.nodeStatus.values()) {
        if (status === 'Completed') return false;
      }
      break;
    }
    case 'Completed': {
      // R17.2
      for (const status of state.nodeStatus.values()) {
        if (status === 'Ready' || status === 'Running') return false;
      }
      break;
    }
    case 'Failed': {
      // R17.3
      let hasFailed = false;
      for (const status of state.nodeStatus.values()) {
        if (status === 'Failed') {
          hasFailed = true;
          break;
        }
      }
      if (!hasFailed) return false;
      break;
    }
    case 'Paused': {
      // R17.4
      if (state.pendingHumanInput === null) return false;
      const node = getNode(graph, state.pendingHumanInput);
      if (node === undefined || node.type !== 'human_input') return false;
      break;
    }
    case 'Running':
      // No additional cross-field constraint at this layer.
      break;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Compute the iteration-scope index a node currently sits in (key algorithm 4).
 * For a node outside any loop body the index is the base 0. For a node enclosed by
 * one or more LoopScopes, the index is the composite `Σ counter_i * radix_i`, where
 * the radix of a layer is the product of the `maxIterations` of all strictly inner
 * layers. Layers are ordered innermost-first (smallest body first), so distinct
 * iteration combinations map to distinct indices.
 */
function currentIterationIndex(
  graph: WorkflowGraph,
  state: ExecutionState,
  nodeId: string,
): number {
  // Enclosing loop scopes: those whose body contains this node.
  const enclosing = graph.loopScopes.filter((s) => s.bodyNodeIds.includes(nodeId));
  if (enclosing.length === 0) return 0;

  // Order innermost-first using body size as a nesting proxy (inner bodies are subsets).
  const ordered = [...enclosing].sort((a, b) => a.bodyNodeIds.length - b.bodyNodeIds.length);

  let index = 0;
  let radix = 1;
  for (const scope of ordered) {
    const counter = state.loopCounters.get(scope.id) ?? 0;
    index += counter * radix;
    radix *= maxIterationsOf(graph, scope.headerNodeId);
  }
  return index;
}

/** Read a loop header node's `maxIterations` defensively from its opaque config; default 1. */
function maxIterationsOf(graph: WorkflowGraph, headerNodeId: string): number {
  const header = getNode(graph, headerNodeId);
  const config = header?.config;
  if (config !== null && typeof config === 'object' && !Array.isArray(config)) {
    const raw = (config as { readonly maxIterations?: unknown }).maxIterations;
    if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 1) return raw;
  }
  return 1;
}

/**
 * Internal: deep equality of two JSON values. Object key order is irrelevant; array
 * element order is significant. Mirrors the base layer's `graphEquals` JSON compare.
 */
function jsonValueEquals(a: JsonValue, b: JsonValue): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;

  const ta = typeof a;
  const tb = typeof b;
  if (ta !== tb) return false;
  if (ta !== 'object') return false; // primitives already handled by === above

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
