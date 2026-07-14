// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

/**
 * Workflow graph model — custom fast-check arbitraries (test-time only).
 *
 * Feature: workflow-graph-model
 *
 * This module is imported exclusively by the property-based tests. It provides:
 *   - Base generators (PortType, Port, WorkflowNode, possibly-invalid WorkflowGraph).
 *   - `arbitraryValidGraph`: graphs GUARANTEED to pass `validateGraph`.
 *   - Controlled single-point mutators ("mutate-then-detect"): each turns a valid
 *     graph into one that must trigger exactly one specific ErrorCode.
 *   - Reorder helpers: produce semantically-equivalent graphs with permuted
 *     arrays and shuffled config keys, for determinism/uniqueness properties.
 *
 * Everything here is pure and deterministic given a fast-check seed.
 */

import fc from 'fast-check';

import {
  ErrorCode,
  NODE_TYPES,
  type Endpoint,
  type JsonValue,
  type LoopScope,
  type NodeType,
  type Port,
  type PortDirection,
  type PortType,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowNode,
} from './types';
import {
  T_BOOLEAN,
  T_JSON,
  T_MESSAGE,
  T_NUMBER,
  T_STRING,
  isAssignable,
  listOf,
  optionalOf,
} from './portType';
import { forwardEdges, getNode, incomingEdges } from './graph';

// ===========================================================================
// 4.1 Base generators
// ===========================================================================

/**
 * Recursive, depth-limited PortType generator.
 *
 * Base kinds (string/number/boolean/json/message) are the leaves. `list<T>` and
 * `optional<T>` are inner nodes whose inner type is generated with a strictly
 * smaller `maxDepth`, which guarantees termination (no infinite recursion).
 */
export function arbitraryPortType(maxDepth = 3): fc.Arbitrary<PortType> {
  const base: fc.Arbitrary<PortType> = fc.constantFrom(
    T_STRING,
    T_NUMBER,
    T_BOOLEAN,
    T_JSON,
    T_MESSAGE,
  );
  if (maxDepth <= 0) {
    return base;
  }
  const inner = arbitraryPortType(maxDepth - 1);
  return fc.oneof(
    base,
    inner.map((t) => listOf(t)),
    inner.map((t) => optionalOf(t)),
  );
}

/** Node type generator over the closed `NODE_TYPES` set. */
function arbitraryNodeType(): fc.Arbitrary<NodeType> {
  return fc.constantFrom(...NODE_TYPES);
}

/** Opaque Node_Config generator: any JSON value (cast to our JsonValue shape). */
function arbitraryConfig(): fc.Arbitrary<JsonValue> {
  return fc.jsonValue({ maxDepth: 2 }).map((v) => v as unknown as JsonValue);
}

/** Small node-id pool used for the possibly-invalid graph generator (encourages id collisions). */
function arbitrarySmallNodeId(): fc.Arbitrary<string> {
  return fc.constantFrom('a', 'b', 'c', 'd');
}

/** Small port-id pool; `pX` is unlikely to be a real port, exercising missing-port detection. */
function arbitraryPortIdValue(): fc.Arbitrary<string> {
  return fc.constantFrom('p0', 'p1', 'p2', 'p3', 'pX');
}

/**
 * Single Port generator with a random PortType and `required` flag.
 *
 * The port id is drawn from a small pool; per-direction id uniqueness is the
 * caller's responsibility (see `arbitraryWorkflowNode`, which deduplicates).
 */
export function arbitraryPort(direction: PortDirection): fc.Arbitrary<Port> {
  return fc
    .record({
      id: arbitraryPortIdValue(),
      portType: arbitraryPortType(2),
      required: fc.boolean(),
    })
    .map((r) => ({ id: r.id, direction, portType: r.portType, required: r.required }));
}

/** Generate a per-direction port set with unique Port_Ids (R2.4 precondition). */
function arbitraryPortSet(direction: PortDirection): fc.Arbitrary<readonly Port[]> {
  return fc
    .uniqueArray(
      fc.record({
        id: arbitraryPortIdValue(),
        portType: arbitraryPortType(2),
        required: fc.boolean(),
      }),
      { selector: (r) => r.id, minLength: 0, maxLength: 3 },
    )
    .map((records) =>
      records.map((r) => ({ id: r.id, direction, portType: r.portType, required: r.required })),
    );
}

/**
 * WorkflowNode generator: random NodeType, random config, and random input /
 * output port sets whose ids are unique within their own direction.
 */
export function arbitraryWorkflowNode(): fc.Arbitrary<WorkflowNode> {
  return fc.record({
    id: arbitrarySmallNodeId(),
    type: arbitraryNodeType(),
    config: arbitraryConfig(),
    inputs: arbitraryPortSet('input'),
    outputs: arbitraryPortSet('output'),
  });
}

/** Endpoint among the given nodes; sometimes references a non-existent port. */
function arbitraryEndpointAmong(
  nodes: readonly WorkflowNode[],
  direction: PortDirection,
): fc.Arbitrary<Endpoint> {
  return fc.constantFrom(...nodes).chain((node) => {
    const ports = direction === 'input' ? node.inputs : node.outputs;
    const portId =
      ports.length > 0
        ? fc.oneof(fc.constantFrom(...ports.map((p) => p.id)), arbitraryPortIdValue())
        : arbitraryPortIdValue();
    return portId.map((pid) => ({ nodeId: node.id, portId: pid }));
  });
}

/** Edge among the given nodes; edge-id pool is small so duplicates can occur. */
function arbitraryEdgeAmong(nodes: readonly WorkflowNode[]): fc.Arbitrary<WorkflowEdge> {
  return fc.record({
    id: fc.constantFrom('e0', 'e1', 'e2', 'e3', 'e4'),
    source: arbitraryEndpointAmong(nodes, 'output'),
    target: arbitraryEndpointAmong(nodes, 'input'),
  });
}

/** LoopScope among the given node ids (header / body may be ill-formed). */
function arbitraryLoopScopeAmong(nodeIds: readonly string[]): fc.Arbitrary<LoopScope> {
  return fc.record({
    id: fc.constantFrom('s0', 's1', 's2'),
    headerNodeId: fc.constantFrom(...nodeIds),
    bodyNodeIds: fc.subarray([...nodeIds]),
  });
}

/**
 * Possibly-INVALID random graph generator (no uniqueness or well-formedness
 * guarantees). Drives the validation "detection" properties (Property 11–18,
 * 20, 21): random node ids may collide, edges may dangle, the entry id may be
 * missing, and loop scopes may be malformed.
 */
export function arbitraryWorkflowGraph(): fc.Arbitrary<WorkflowGraph> {
  return fc.array(arbitraryWorkflowNode(), { minLength: 0, maxLength: 5 }).chain((nodes) => {
    if (nodes.length === 0) {
      return fc.constant<WorkflowGraph>({
        nodes: [],
        edges: [],
        loopScopes: [],
        entryNodeId: null,
      });
    }
    const nodeIds = nodes.map((n) => n.id);
    const knownEntry = fc.constantFrom(...nodeIds);
    return fc.record({
      nodes: fc.constant(nodes),
      edges: fc.array(arbitraryEdgeAmong(nodes), { minLength: 0, maxLength: 6 }),
      loopScopes: fc.array(arbitraryLoopScopeAmong(nodeIds), { minLength: 0, maxLength: 2 }),
      // Entry may be a real node, null, or a (likely) missing id.
      entryNodeId: fc.oneof(knownEntry, fc.constant<string | null>(null), arbitrarySmallNodeId()),
    });
  });
}

// ===========================================================================
// 4.2 Valid graph generator (guaranteed to pass validateGraph)
// ===========================================================================

/** Options for `arbitraryValidGraph`. */
export interface ValidGraphOptions {
  readonly minNodes?: number;
  readonly maxNodes?: number;
}

/** Random primitives consumed by the deterministic assembler below. */
interface ValidGraphPrimitives {
  readonly nodeTypes: readonly NodeType[];
  readonly requiredMain: readonly boolean[];
  readonly extraInputs: readonly number[];
  readonly configs: readonly JsonValue[];
  readonly parentPicks: readonly number[];
  readonly portTypes: readonly PortType[];
  readonly widenings: readonly number[];
  readonly loopUse: boolean;
  readonly headerPick: number;
  readonly sourcePick: number;
}

/** Unique-id-friendly node id generator for valid graphs (large value space). */
function arbitraryUniqueNodeId(): fc.Arbitrary<string> {
  return fc.hexaString({ minLength: 1, maxLength: 8 }).map((s) => `n_${s}`);
}

/**
 * Construct graphs GUARANTEED to satisfy every validation rule.
 *
 * Strategy (see design "自定义 Arbitraries"):
 *   - Unique Node_Ids; nodes are conceptually indexed 0..k-1, index 0 is the EntryNode.
 *   - A forward tree: each non-entry node j receives exactly one forward edge from a
 *     lower-index parent into its `in_main` input port. This guarantees reachability,
 *     forward-acyclicity (lower → higher index only), input arity ≤ 1, and satisfies
 *     every required input (the only required-capable input is always connected).
 *   - Each forward edge is type-compatible by construction: the parent exposes a
 *     dedicated output port whose type `S` is assignable to the child's input type `T`
 *     (`T` is `S`, or `json`, or `optional<S>` — all guaranteed by isAssignable).
 *   - The EntryNode receives no forward edge (its `in_main` stays unconnected and
 *     non-required).
 *   - Optionally one loop: a non-entry node is forced to NodeType `loop` and declared
 *     as a LoopScope header; a single well-formed back-edge (body member → header's
 *     `loop_in`) is added. Back-edges are excluded from the forward subgraph, so they
 *     never break forward-acyclicity, reachability or the entry constraint.
 */
export function arbitraryValidGraph(options: ValidGraphOptions = {}): fc.Arbitrary<WorkflowGraph> {
  const minNodes = options.minNodes ?? 1;
  const maxNodes = options.maxNodes ?? 5;
  return fc
    .uniqueArray(arbitraryUniqueNodeId(), { minLength: minNodes, maxLength: maxNodes })
    .chain((ids) => {
      const k = ids.length;
      const lenK = { minLength: k, maxLength: k } as const;
      return fc
        .record<ValidGraphPrimitives>({
          nodeTypes: fc.array(arbitraryNodeType(), lenK),
          requiredMain: fc.array(fc.boolean(), lenK),
          extraInputs: fc.array(fc.nat({ max: 2 }), lenK),
          configs: fc.array(arbitraryConfig(), lenK),
          parentPicks: fc.array(fc.nat(), lenK),
          portTypes: fc.array(arbitraryPortType(2), lenK),
          widenings: fc.array(fc.nat({ max: 2 }), lenK),
          loopUse: fc.boolean(),
          headerPick: fc.nat(),
          sourcePick: fc.nat(),
        })
        .map((p) => assembleValidGraph(ids, p));
    });
}

/** Deterministically assemble a valid graph from unique ids + random primitives. */
function assembleValidGraph(ids: readonly string[], p: ValidGraphPrimitives): WorkflowGraph {
  const k = ids.length;
  // A well-formed loop needs an entry (0), a header with a non-body forward
  // parent, and at least one descendant body member that back-edges to the
  // header. The smallest such shape needs k >= 3, with the header placed in
  // [1, k-2] so the last node (k-1) can be forced to be its forward child.
  const useLoop = p.loopUse && k >= 3;
  const headerIndex = useLoop ? 1 + (p.headerPick % (k - 2)) : -1;
  const bodyIndex = useLoop ? k - 1 : -1; // single body member / back-edge source

  // Per non-entry node: parent index, source (parent output) type, target (input) type.
  const parentOf: number[] = new Array<number>(k).fill(-1);
  const sourceType: PortType[] = new Array<PortType>(k);
  const targetType: PortType[] = new Array<PortType>(k);
  for (let j = 1; j < k; j++) {
    parentOf[j] = p.parentPicks[j] % j; // in [0, j-1] -> strictly-increasing edges
    const st = p.portTypes[j];
    sourceType[j] = st;
    const widen = p.widenings[j] % 3;
    // All three widenings keep isAssignable(st, targetType) true (R3.3 / R3.5 / R3.6).
    targetType[j] = widen === 0 ? st : widen === 1 ? T_JSON : optionalOf(st);
  }
  // Force the body member to be a forward child of the header. This guarantees
  // (a) the header keeps its own forward parent edge (from parentOf[headerIndex]
  // < headerIndex, a non-body node) so it stays reachable, and (b) the body
  // member is a genuine descendant of the header, so the back-edge closes a real
  // loop. Because the header's incoming forward edge comes from a NON-body node,
  // it is never misclassified as a back-edge (back-edges are node-based, R11.3).
  if (useLoop) {
    parentOf[bodyIndex] = headerIndex;
  }

  // Children of each node, so a parent can expose one dedicated output port per child.
  const childrenOf: number[][] = Array.from({ length: k }, () => [] as number[]);
  for (let j = 1; j < k; j++) {
    childrenOf[parentOf[j]].push(j);
  }

  const nodes: WorkflowNode[] = ids.map((id, i) => {
    const isEntry = i === 0;
    const type: NodeType = useLoop && i === headerIndex ? 'loop' : p.nodeTypes[i];

    const inputs: Port[] = [];
    // `in_main`: entry's stays unconnected & non-required; each non-entry's is connected.
    inputs.push({
      id: 'in_main',
      direction: 'input',
      portType: isEntry ? T_JSON : targetType[i],
      required: isEntry ? false : p.requiredMain[i],
    });
    if (useLoop && i === headerIndex) {
      inputs.push({ id: 'loop_in', direction: 'input', portType: T_JSON, required: false });
    }
    for (let e = 0; e < p.extraInputs[i]; e++) {
      // Extra inputs are never required and never connected -> no missing-required error.
      inputs.push({ id: `in_extra_${e}`, direction: 'input', portType: T_JSON, required: false });
    }

    // Base `out` (json) is a general source (e.g. for back-edges); plus a typed port per child.
    const outputs: Port[] = [{ id: 'out', direction: 'output', portType: T_JSON, required: false }];
    for (const child of childrenOf[i]) {
      outputs.push({
        id: `out_${child}`,
        direction: 'output',
        portType: sourceType[child],
        required: false,
      });
    }

    return { id, type, config: p.configs[i], inputs, outputs };
  });

  const edges: WorkflowEdge[] = [];
  let counter = 0;
  for (let j = 1; j < k; j++) {
    const u = parentOf[j];
    // Guaranteed true by construction; the explicit check documents the type invariant.
    if (isAssignable(sourceType[j], targetType[j])) {
      edges.push({
        id: `e${counter++}`,
        source: { nodeId: ids[u], portId: `out_${j}` },
        target: { nodeId: ids[j], portId: 'in_main' },
      });
    }
  }

  const loopScopes: LoopScope[] = [];
  if (useLoop) {
    // The body member is the header's forced forward child (`bodyIndex`), a true
    // descendant of the header, so the back-edge below closes a genuine loop.
    const src = bodyIndex;
    loopScopes.push({
      id: 'loop_scope_0',
      headerNodeId: ids[headerIndex],
      bodyNodeIds: [ids[src]],
    });
    // Well-formed back-edge: body member -> header's dedicated `loop_in` port.
    edges.push({
      id: `e${counter++}`,
      source: { nodeId: ids[src], portId: 'out' },
      target: { nodeId: ids[headerIndex], portId: 'loop_in' },
    });
  }

  // An empty valid graph (zero nodes) has no entry node; its marker is null
  // (not `undefined`, which would be dropped by JSON serialization).
  return { nodes, edges, loopScopes, entryNodeId: k === 0 ? null : ids[0] };
}

// ===========================================================================
// 4.3 Controlled single-point mutators ("mutate-then-detect")
// ===========================================================================

/**
 * Result of a controlled mutation: the mutated graph plus the ErrorCode that
 * the mutation is guaranteed to make `validateGraph` report. The code is
 * *included* in the resulting error set (a single point mutation may, as a side
 * effect, also surface a related code; properties assert inclusion, not exclusivity).
 *
 * A mutator returns `null` when its precondition is not met for the given graph
 * (e.g. an edge-based mutator applied to an edgeless graph), so callers can skip.
 */
export interface Mutation {
  readonly graph: WorkflowGraph;
  readonly code: ErrorCode;
}

/** A controlled single-point mutator. */
export type Mutator = (graph: WorkflowGraph) => Mutation | null;

/** Produce an id not present in `existing`, derived from `base`. */
function freshId(existing: ReadonlySet<string>, base: string): string {
  if (!existing.has(base)) {
    return base;
  }
  let i = 0;
  let candidate = `${base}_0`;
  while (existing.has(candidate)) {
    candidate = `${base}_${++i}`;
  }
  return candidate;
}

/** Duplicate an existing Node_Id (append a clone of the first node). Triggers DUPLICATE_NODE_ID. */
export const duplicateNodeId: Mutator = (g) => {
  if (g.nodes.length === 0) {
    return null;
  }
  const clone: WorkflowNode = { ...g.nodes[0] };
  return { graph: { ...g, nodes: [...g.nodes, clone] }, code: ErrorCode.DUPLICATE_NODE_ID };
};

/** Duplicate an existing Edge_Id (append a clone of the first edge). Triggers DUPLICATE_EDGE_ID. */
export const duplicateEdgeId: Mutator = (g) => {
  if (g.edges.length === 0) {
    return null;
  }
  const clone: WorkflowEdge = { ...g.edges[0] };
  return { graph: { ...g, edges: [...g.edges, clone] }, code: ErrorCode.DUPLICATE_EDGE_ID };
};

/** Repoint the first edge's target to a non-existent node. Triggers EDGE_REFERENCES_MISSING_NODE. */
export const repointEdgeToMissingNode: Mutator = (g) => {
  if (g.edges.length === 0) {
    return null;
  }
  const missing = freshId(new Set(g.nodes.map((n) => n.id)), 'missing_node');
  const first = g.edges[0];
  const mutated: WorkflowEdge = { ...first, target: { nodeId: missing, portId: first.target.portId } };
  return {
    graph: { ...g, edges: [mutated, ...g.edges.slice(1)] },
    code: ErrorCode.EDGE_REFERENCES_MISSING_NODE,
  };
};

/** Repoint the first edge's target to a non-existent port. Triggers EDGE_REFERENCES_MISSING_PORT. */
export const repointEdgeToMissingPort: Mutator = (g) => {
  if (g.edges.length === 0) {
    return null;
  }
  const first = g.edges[0];
  const targetNode = getNode(g, first.target.nodeId);
  if (targetNode === undefined) {
    return null;
  }
  const missing = freshId(new Set(targetNode.inputs.map((p) => p.id)), 'missing_port');
  const mutated: WorkflowEdge = {
    ...first,
    target: { nodeId: first.target.nodeId, portId: missing },
  };
  return {
    graph: { ...g, edges: [mutated, ...g.edges.slice(1)] },
    code: ErrorCode.EDGE_REFERENCES_MISSING_PORT,
  };
};

/** Turn the first edge into a self-loop. Triggers SELF_LOOP_EDGE. */
export const makeSelfLoopEdge: Mutator = (g) => {
  if (g.edges.length === 0) {
    return null;
  }
  const first = g.edges[0];
  const sourceNode = getNode(g, first.source.nodeId);
  if (sourceNode === undefined || sourceNode.inputs.length === 0) {
    return null;
  }
  const mutated: WorkflowEdge = {
    ...first,
    target: { nodeId: first.source.nodeId, portId: sourceNode.inputs[0].id },
  };
  return {
    graph: { ...g, edges: [mutated, ...g.edges.slice(1)] },
    code: ErrorCode.SELF_LOOP_EDGE,
  };
};

/**
 * Add a second incoming edge to an input port that already has one (cloning the
 * first edge's endpoints, so types stay compatible). Triggers INPUT_PORT_ARITY_EXCEEDED.
 */
export const addSecondIncomingEdge: Mutator = (g) => {
  if (g.edges.length === 0) {
    return null;
  }
  const first = g.edges[0];
  const newId = freshId(new Set(g.edges.map((e) => e.id)), 'arity_edge');
  const newEdge: WorkflowEdge = {
    id: newId,
    source: { ...first.source },
    target: { ...first.target },
  };
  return {
    graph: { ...g, edges: [...g.edges, newEdge] },
    code: ErrorCode.INPUT_PORT_ARITY_EXCEEDED,
  };
};

/**
 * Flip a `required: false` input port (with no incoming edge) to `required: true`.
 * Triggers MISSING_REQUIRED_INPUT.
 */
export const flipRequiredFlag: Mutator = (g) => {
  for (const node of g.nodes) {
    for (const port of node.inputs) {
      if (!port.required && incomingEdges(g, node.id, port.id).length === 0) {
        const newPort: Port = { ...port, required: true };
        const newInputs = node.inputs.map((p) => (p === port ? newPort : p));
        const newNode: WorkflowNode = { ...node, inputs: newInputs };
        const newNodes = g.nodes.map((n) => (n === node ? newNode : n));
        return { graph: { ...g, nodes: newNodes }, code: ErrorCode.MISSING_REQUIRED_INPUT };
      }
    }
  }
  return null;
};

/** Add a forward edge whose target is the EntryNode. Triggers ENTRY_NODE_HAS_INCOMING_EDGE. */
export const addEntryIncomingEdge: Mutator = (g) => {
  if (g.entryNodeId === null) {
    return null;
  }
  const entry = getNode(g, g.entryNodeId);
  if (entry === undefined || entry.inputs.length === 0) {
    return null;
  }
  const sourceNode = g.nodes.find((n) => n.id !== g.entryNodeId && n.outputs.length > 0);
  if (sourceNode === undefined) {
    return null;
  }
  const newId = freshId(new Set(g.edges.map((e) => e.id)), 'entry_in_edge');
  const newEdge: WorkflowEdge = {
    id: newId,
    source: { nodeId: sourceNode.id, portId: sourceNode.outputs[0].id },
    target: { nodeId: entry.id, portId: entry.inputs[0].id },
  };
  return {
    graph: { ...g, edges: [...g.edges, newEdge] },
    code: ErrorCode.ENTRY_NODE_HAS_INCOMING_EDGE,
  };
};

/**
 * Add an edge that reverses the first forward edge, introducing a cycle in the
 * forward subgraph WITHOUT declaring it as a well-formed back-edge.
 * Triggers CYCLE_IN_FORWARD_SUBGRAPH.
 */
export const introduceForwardCycle: Mutator = (g) => {
  const fwd = forwardEdges(g);
  if (fwd.length === 0) {
    return null;
  }
  const e = fwd[0];
  const futureTarget = getNode(g, e.source.nodeId); // the source becomes the new target
  const futureSource = getNode(g, e.target.nodeId); // the target becomes the new source
  if (
    futureTarget === undefined ||
    futureSource === undefined ||
    futureTarget.inputs.length === 0 ||
    futureSource.outputs.length === 0
  ) {
    return null;
  }
  const newId = freshId(new Set(g.edges.map((x) => x.id)), 'cycle_edge');
  const newEdge: WorkflowEdge = {
    id: newId,
    source: { nodeId: futureSource.id, portId: futureSource.outputs[0].id },
    target: { nodeId: futureTarget.id, portId: futureTarget.inputs[0].id },
  };
  return {
    graph: { ...g, edges: [...g.edges, newEdge] },
    code: ErrorCode.CYCLE_IN_FORWARD_SUBGRAPH,
  };
};

/** Force the first LoopScope's header node to a non-`loop` type. Triggers INVALID_LOOP_HEADER. */
export const invalidateLoopHeader: Mutator = (g) => {
  if (g.loopScopes.length === 0) {
    return null;
  }
  const headerId = g.loopScopes[0].headerNodeId;
  const node = getNode(g, headerId);
  if (node === undefined || node.type !== 'loop') {
    return null;
  }
  const newNode: WorkflowNode = { ...node, type: 'tool' };
  const newNodes = g.nodes.map((n) => (n.id === headerId ? newNode : n));
  return { graph: { ...g, nodes: newNodes }, code: ErrorCode.INVALID_LOOP_HEADER };
};

/** Duplicate the first LoopScope's id. Triggers DUPLICATE_LOOP_SCOPE_ID. */
export const duplicateLoopScopeId: Mutator = (g) => {
  if (g.loopScopes.length === 0) {
    return null;
  }
  const clone: LoopScope = { ...g.loopScopes[0] };
  return {
    graph: { ...g, loopScopes: [...g.loopScopes, clone] },
    code: ErrorCode.DUPLICATE_LOOP_SCOPE_ID,
  };
};

/** All controlled single-point mutators, for generic "mutate-then-detect" properties. */
export const SINGLE_POINT_MUTATORS: ReadonlyArray<Mutator> = [
  duplicateNodeId,
  duplicateEdgeId,
  repointEdgeToMissingNode,
  repointEdgeToMissingPort,
  makeSelfLoopEdge,
  addSecondIncomingEdge,
  flipRequiredFlag,
  addEntryIncomingEdge,
  introduceForwardCycle,
  invalidateLoopHeader,
  duplicateLoopScopeId,
];

// ===========================================================================
// 4.3 Reorder helpers (semantics-preserving permutations)
// ===========================================================================

/** A full-length shuffle (permutation) of an array; identity for length <= 1. */
function shuffledFull<T>(arr: readonly T[]): fc.Arbitrary<readonly T[]> {
  if (arr.length <= 1) {
    return fc.constant(arr);
  }
  return fc.shuffledSubarray([...arr], { minLength: arr.length, maxLength: arr.length });
}

/**
 * Yield a semantically-equal JSON value with object keys randomly reordered.
 * Array element order is preserved (it is semantically significant); only object
 * key order — which `graphEquals`/`serialize` ignore/canonicalize — is shuffled.
 */
function arbitraryShuffledJson(value: JsonValue): fc.Arbitrary<JsonValue> {
  if (value === null || typeof value !== 'object') {
    return fc.constant(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return fc.constant(value);
    }
    return fc.tuple(...value.map((el) => arbitraryShuffledJson(el))).map((els) => els as JsonValue);
  }
  const obj = value as { readonly [key: string]: JsonValue };
  const keys = Object.keys(obj);
  if (keys.length === 0) {
    return fc.constant(value);
  }
  return fc
    .record({
      order: shuffledFull(keys),
      values: fc.tuple(...keys.map((key) => arbitraryShuffledJson(obj[key]))),
    })
    .map(({ order, values }) => {
      const byKey = new Map<string, JsonValue>();
      keys.forEach((key, i) => byKey.set(key, values[i] as JsonValue));
      const out: { [key: string]: JsonValue } = {};
      for (const key of order) {
        // Use defineProperty rather than `out[key] = …` so that an own property is
        // created even for the special key "__proto__" — a plain assignment would
        // invoke Object.prototype's __proto__ setter instead of storing a data
        // property, silently dropping the key (see serialize.ts's canonicalizeJson,
        // which guards against the same trap).
        Object.defineProperty(out, key, {
          value: byKey.get(key) as JsonValue,
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return out;
    });
}

/** Reorder a single node's input/output port arrays and shuffle its config keys. */
function arbitraryReorderedNode(node: WorkflowNode): fc.Arbitrary<WorkflowNode> {
  return fc
    .record({
      inputs: shuffledFull(node.inputs),
      outputs: shuffledFull(node.outputs),
      config: arbitraryShuffledJson(node.config),
    })
    .map(({ inputs, outputs, config }) => ({ ...node, inputs, outputs, config }));
}

/** Reorder all nodes and each node's internal arrays. */
function arbitraryReorderedNodes(
  nodes: readonly WorkflowNode[],
): fc.Arbitrary<readonly WorkflowNode[]> {
  if (nodes.length === 0) {
    return fc.constant(nodes);
  }
  return fc.tuple(...nodes.map((n) => arbitraryReorderedNode(n))).chain((rebuilt) =>
    shuffledFull(rebuilt),
  );
}

/** Reorder the scope array and each scope's body-node-id collection (a set). */
function arbitraryReorderedScopes(
  scopes: readonly LoopScope[],
): fc.Arbitrary<readonly LoopScope[]> {
  if (scopes.length === 0) {
    return fc.constant(scopes);
  }
  return fc
    .tuple(
      ...scopes.map((s) =>
        shuffledFull(s.bodyNodeIds).map((bodyNodeIds) => ({ ...s, bodyNodeIds })),
      ),
    )
    .chain((rebuilt) => shuffledFull(rebuilt));
}

/**
 * Produce a semantically-equivalent graph (`graphEquals` true) with its
 * `nodes`/`edges`/`loopScopes` arrays, every port array, every loop body, and
 * every config object's key order randomly permuted. Drives the determinism /
 * uniqueness properties (Property 20, 24, 36).
 */
export function arbitraryReorderedGraph(g: WorkflowGraph): fc.Arbitrary<WorkflowGraph> {
  return fc
    .record({
      nodes: arbitraryReorderedNodes(g.nodes),
      edges: shuffledFull(g.edges),
      loopScopes: arbitraryReorderedScopes(g.loopScopes),
    })
    .map(({ nodes, edges, loopScopes }) => ({
      nodes,
      edges,
      loopScopes,
      entryNodeId: g.entryNodeId,
    }));
}
