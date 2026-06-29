/**
 * Workflow graph model — serializer (Graph_Serializer, R18).
 *
 * Feature: workflow-graph-model
 *
 * This module implements canonical JSON serialization with round-trip fidelity:
 *   - `canonicalize(g)`  : produce a structurally sorted (canonical) graph.
 *   - `serialize(g)`     : canonicalize, then emit a fixed-field-order JSON string.
 *   - `deserialize(s)`   : parse + structurally validate, restoring PortTypes.
 *
 * Design references: design.md "关键算法 7" (canonical JSON & round-trip).
 *
 * Guarantees (verified by property tests):
 *   - `deserialize(serialize(g))` is semantically equal to `g` (R18.3, R18.7).
 *   - `serialize(deserialize(serialize(g)).graph)` is byte-identical to
 *     `serialize(g)` (R18.4).
 *   - Semantically equivalent graphs produce byte-identical strings (R18.5).
 *   - `deserialize` NEVER throws and NEVER partially constructs a graph; on any
 *     failure it returns `{ ok: false, error }` (R18.6).
 *
 * Every export is a pure function. No I/O, no mutable global state.
 */

import type {
  DeserializeResult,
  Endpoint,
  JsonValue,
  LoopScope,
  NodeType,
  Port,
  PortDirection,
  PortType,
  WorkflowEdge,
  WorkflowGraph,
  WorkflowNode,
} from './types';
import { NODE_TYPES } from './types';
import { formatPortType, parsePortType } from './portType';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Deterministic lexicographic comparator over UTF-16 code units. */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Sort a readonly array of items by a string key, returning a new array. */
function sortBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  return [...items].sort((x, y) => cmp(key(x), key(y)));
}

/**
 * Recursively canonicalize a JsonValue:
 *   - object: keys sorted lexicographically (recursively canonicalized values);
 *   - array : order preserved (arrays are semantically ordered);
 *   - scalar: returned as-is.
 */
function canonicalizeJson(value: JsonValue): JsonValue {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeJson(item));
  }
  const obj = value as { readonly [key: string]: JsonValue };
  const result: { [key: string]: JsonValue } = {};
  for (const key of Object.keys(obj).sort(cmp)) {
    // Use defineProperty rather than `result[key] = …` so that an own property
    // is created even for the special key "__proto__". A plain assignment
    // `result["__proto__"] = …` would invoke Object.prototype's __proto__ setter
    // (mutating the prototype / dropping the key) instead of storing an own data
    // property, which would silently lose "__proto__" entries during round-trip.
    Object.defineProperty(result, key, {
      value: canonicalizeJson(obj[key]),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return result;
}

/** Canonicalize a single node: sort its input/output ports and its config. */
function canonicalizeNode(node: WorkflowNode): WorkflowNode {
  return {
    id: node.id,
    type: node.type,
    config: canonicalizeJson(node.config),
    inputs: sortBy(node.inputs, (p) => p.id),
    outputs: sortBy(node.outputs, (p) => p.id),
  };
}

/** Canonicalize a loop scope: sort its body node ids lexicographically. */
function canonicalizeLoopScope(scope: LoopScope): LoopScope {
  return {
    id: scope.id,
    headerNodeId: scope.headerNodeId,
    bodyNodeIds: [...scope.bodyNodeIds].sort(cmp),
  };
}

// ---------------------------------------------------------------------------
// 9.1 canonicalize (R18.5)
// ---------------------------------------------------------------------------

/**
 * Produce a canonical (structurally sorted) copy of the graph:
 *   - nodes sorted by id; each node's inputs/outputs sorted by port id;
 *   - edges sorted by id;
 *   - loopScopes sorted by id, with bodyNodeIds sorted lexicographically;
 *   - each node's config recursively canonicalized (object keys sorted, arrays
 *     keep their order).
 *
 * The input graph is not modified.
 */
export function canonicalize(g: WorkflowGraph): WorkflowGraph {
  return {
    nodes: sortBy(g.nodes, (n) => n.id).map(canonicalizeNode),
    edges: sortBy(g.edges, (e) => e.id),
    loopScopes: sortBy(g.loopScopes, (s) => s.id).map(canonicalizeLoopScope),
    entryNodeId: g.entryNodeId,
  };
}

// ---------------------------------------------------------------------------
// 9.2 serialize (R18.1, R18.5)
// ---------------------------------------------------------------------------

/**
 * Plain (JSON-friendly) shapes with a FIXED field order. The field order here is
 * the source of byte-level determinism: building objects with these keys in this
 * exact order and then JSON.stringify-ing them yields a canonical string.
 */
interface PlainPort {
  readonly id: string;
  readonly direction: PortDirection;
  readonly portType: string; // canonical string via formatPortType
  readonly required: boolean;
}

interface PlainNode {
  readonly id: string;
  readonly type: NodeType;
  readonly config: JsonValue;
  readonly inputs: readonly PlainPort[];
  readonly outputs: readonly PlainPort[];
}

interface PlainEndpoint {
  readonly nodeId: string;
  readonly portId: string;
}

interface PlainEdge {
  readonly id: string;
  readonly source: PlainEndpoint;
  readonly target: PlainEndpoint;
}

interface PlainLoopScope {
  readonly id: string;
  readonly headerNodeId: string;
  readonly bodyNodeIds: readonly string[];
}

interface PlainGraph {
  readonly nodes: readonly PlainNode[];
  readonly edges: readonly PlainEdge[];
  readonly loopScopes: readonly PlainLoopScope[];
  readonly entryNodeId: string | null;
}

/** Build the plain, fixed-field-order representation of a port. */
function portToPlain(port: Port): PlainPort {
  return {
    id: port.id,
    direction: port.direction,
    portType: formatPortType(port.portType),
    required: port.required,
  };
}

/** Build the plain, fixed-field-order representation of an endpoint. */
function endpointToPlain(endpoint: Endpoint): PlainEndpoint {
  return { nodeId: endpoint.nodeId, portId: endpoint.portId };
}

/**
 * Serialize a WorkflowGraph to its Canonical_Json string. First canonicalizes
 * the graph, then constructs a plain object with a fixed field order and
 * JSON.stringify-s it. Each PortType is written as its `formatPortType` string.
 *
 * Semantically equivalent graphs produce byte-identical strings (R18.5).
 */
export function serialize(g: WorkflowGraph): string {
  const canon = canonicalize(g);
  const plain: PlainGraph = {
    nodes: canon.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      config: n.config,
      inputs: n.inputs.map(portToPlain),
      outputs: n.outputs.map(portToPlain),
    })),
    edges: canon.edges.map((e) => ({
      id: e.id,
      source: endpointToPlain(e.source),
      target: endpointToPlain(e.target),
    })),
    loopScopes: canon.loopScopes.map((s) => ({
      id: s.id,
      headerNodeId: s.headerNodeId,
      bodyNodeIds: s.bodyNodeIds,
    })),
    entryNodeId: canon.entryNodeId,
  };
  return JSON.stringify(plain);
}

// ---------------------------------------------------------------------------
// 9.3 deserialize (R18.2, R18.6, R18.7)
// ---------------------------------------------------------------------------

/**
 * Internal sentinel used to abort structural validation. It is always caught
 * within `deserialize`, so it never escapes to the caller (R18.6).
 */
class StructError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StructError';
  }
}

/** Assert a condition during validation; throw a (internally caught) StructError otherwise. */
function ensure(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new StructError(message);
  }
}

/** Type guard: a non-null, non-array plain object. */
function isPlainObject(value: unknown): value is { readonly [key: string]: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Read a required string field from an object, validating its presence and type. */
function readString(obj: { readonly [key: string]: unknown }, field: string, context: string): string {
  const value = obj[field];
  ensure(typeof value === 'string', `${context}: field "${field}" must be a string`);
  return value as string;
}

/** Validate and restore an Endpoint. */
function readEndpoint(value: unknown, context: string): Endpoint {
  ensure(isPlainObject(value), `${context}: endpoint must be an object`);
  return {
    nodeId: readString(value, 'nodeId', context),
    portId: readString(value, 'portId', context),
  };
}

/** Validate and restore a Port for the given direction-checking context. */
function readPort(value: unknown, context: string): Port {
  ensure(isPlainObject(value), `${context}: port must be an object`);
  const id = readString(value, 'id', context);

  const direction = value.direction;
  ensure(direction === 'input' || direction === 'output', `${context}: port "${id}" has invalid direction`);

  const portTypeStr = readString(value, 'portType', context);
  const portType = parsePortType(portTypeStr);
  ensure(portType !== null, `${context}: port "${id}" has invalid portType string "${portTypeStr}"`);

  ensure(typeof value.required === 'boolean', `${context}: port "${id}" field "required" must be a boolean`);

  return {
    id,
    direction: direction as PortDirection,
    portType: portType as PortType,
    required: value.required as boolean,
  };
}

/** Validate that an array of ports all carry the expected direction. */
function readPorts(value: unknown, expected: PortDirection, context: string): Port[] {
  ensure(Array.isArray(value), `${context}: "${expected}s" must be an array`);
  return (value as readonly unknown[]).map((item, i) => {
    const port = readPort(item, `${context}[${i}]`);
    ensure(
      port.direction === expected,
      `${context}[${i}]: port "${port.id}" direction "${port.direction}" does not match "${expected}"`,
    );
    return port;
  });
}

/** Validate and restore a WorkflowNode. */
function readNode(value: unknown, context: string): WorkflowNode {
  ensure(isPlainObject(value), `${context}: node must be an object`);
  const id = readString(value, 'id', context);

  const type = value.type;
  ensure(
    typeof type === 'string' && (NODE_TYPES as readonly string[]).includes(type),
    `${context}: node "${id}" has invalid type`,
  );

  // config may be any JsonValue (including null); only require its presence.
  ensure('config' in value, `${context}: node "${id}" is missing "config"`);

  return {
    id,
    type: type as NodeType,
    config: value.config as JsonValue,
    inputs: readPorts(value.inputs, 'input', `${context} node "${id}" inputs`),
    outputs: readPorts(value.outputs, 'output', `${context} node "${id}" outputs`),
  };
}

/** Validate and restore a WorkflowEdge. */
function readEdge(value: unknown, context: string): WorkflowEdge {
  ensure(isPlainObject(value), `${context}: edge must be an object`);
  const id = readString(value, 'id', context);
  return {
    id,
    source: readEndpoint(value.source, `${context} edge "${id}" source`),
    target: readEndpoint(value.target, `${context} edge "${id}" target`),
  };
}

/** Validate and restore a LoopScope. */
function readLoopScope(value: unknown, context: string): LoopScope {
  ensure(isPlainObject(value), `${context}: loopScope must be an object`);
  const id = readString(value, 'id', context);
  const headerNodeId = readString(value, 'headerNodeId', context);

  const body = value.bodyNodeIds;
  ensure(Array.isArray(body), `${context}: loopScope "${id}" field "bodyNodeIds" must be an array`);
  const bodyNodeIds = (body as readonly unknown[]).map((item, i) => {
    ensure(typeof item === 'string', `${context}: loopScope "${id}" bodyNodeIds[${i}] must be a string`);
    return item as string;
  });

  return { id, headerNodeId, bodyNodeIds };
}

/**
 * Attempt to extract a character position from a JSON.parse SyntaxError message.
 * Returns undefined when no position is available.
 */
function extractPosition(message: string): number | undefined {
  const match = /position (\d+)/.exec(message);
  if (match) {
    return Number(match[1]);
  }
  return undefined;
}

/**
 * Deserialize a Canonical_Json string into a WorkflowGraph.
 *
 * On success returns `{ ok: true, graph }`, preserving ALL nodes, edges,
 * loopScopes, the entryNodeId marker, and each port's PortType and required
 * flag (R18.7).
 *
 * On any failure (malformed JSON, missing/ill-typed fields, invalid PortType
 * string) returns `{ ok: false, error: { message, position? } }`. This function
 * NEVER throws and NEVER partially constructs a graph (R18.6).
 */
export function deserialize(s: string): DeserializeResult {
  // Step 1: parse JSON. Failures here yield a position when the engine provides one.
  let parsed: unknown;
  try {
    parsed = JSON.parse(s);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const position = extractPosition(message);
    return position === undefined
      ? { ok: false, error: { message } }
      : { ok: false, error: { message, position } };
  }

  // Step 2: structural validation and restoration. Any StructError is caught here.
  try {
    ensure(isPlainObject(parsed), 'root: graph must be an object');

    const nodesRaw = parsed.nodes;
    ensure(Array.isArray(nodesRaw), 'root: "nodes" must be an array');
    const nodes = (nodesRaw as readonly unknown[]).map((n, i) => readNode(n, `nodes[${i}]`));

    const edgesRaw = parsed.edges;
    ensure(Array.isArray(edgesRaw), 'root: "edges" must be an array');
    const edges = (edgesRaw as readonly unknown[]).map((e, i) => readEdge(e, `edges[${i}]`));

    const scopesRaw = parsed.loopScopes;
    ensure(Array.isArray(scopesRaw), 'root: "loopScopes" must be an array');
    const loopScopes = (scopesRaw as readonly unknown[]).map((sc, i) => readLoopScope(sc, `loopScopes[${i}]`));

    const entryRaw = parsed.entryNodeId;
    ensure(
      entryRaw === null || typeof entryRaw === 'string',
      'root: "entryNodeId" must be a string or null',
    );
    const entryNodeId = entryRaw as string | null;

    const graph: WorkflowGraph = { nodes, edges, loopScopes, entryNodeId };
    return { ok: true, graph };
  } catch (e) {
    // Only StructError is expected here; any other error is still reported, never thrown.
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: { message } };
  }
}
