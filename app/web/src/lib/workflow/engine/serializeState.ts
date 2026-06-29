/**
 * Workflow execution engine — state serialization module (`engine/serializeState.ts`).
 *
 * Feature: workflow-execution-engine
 *
 * Pure, side-effect-free canonical JSON serialization and round-trip-safe
 * deserialization of an ExecutionState (key algorithm 7, R15.x).
 *
 *  - `serializeState` renders an ExecutionState into a Canonical_State_Json string
 *    with a fixed top-level field order and fully order-normalized contents, so that
 *    two semantically-equal states produce byte-identical strings (R15.1, R15.5).
 *  - `deserializeState` parses and structurally validates a Canonical_State_Json
 *    string. On any malformed input it returns an error result rather than throwing,
 *    and never partially constructs a state (R15.2, R15.6). On success it preserves
 *    all six components, including each Value_Key's iterationIndex (R15.7).
 *
 * Round-trip guarantees:
 *  - `deserializeState(serializeState(s)).state` is semantically equal to `s` (R15.3).
 *  - `serializeState(deserializeState(j).state)` is byte-identical to `j` (R15.4).
 */

import type { JsonValue } from '../types';
import type {
  ExecutionState,
  ExecutionStatus,
  RunStatus,
  StateDeserializeResult,
  StoredValue,
  ValueKey,
} from './types';
import { valueKeyToString } from './state';

// ---------------------------------------------------------------------------
// Valid enum sets (the single source of truth for structural validation)
// ---------------------------------------------------------------------------

const VALID_EXECUTION_STATUSES: ReadonlySet<string> = new Set<ExecutionStatus>([
  'Pending',
  'Ready',
  'Running',
  'Completed',
  'Skipped',
  'Failed',
  'Blocked',
]);

const VALID_RUN_STATUSES: ReadonlySet<string> = new Set<RunStatus>([
  'Idle',
  'Running',
  'Paused',
  'Completed',
  'Failed',
]);

// ---------------------------------------------------------------------------
// 5.1 serializeState
// ---------------------------------------------------------------------------

/**
 * Render an ExecutionState into a Canonical_State_Json string (R15.1, R15.5).
 *
 * The state is first mapped into a plain object whose top-level fields appear in a
 * fixed order — nodeStatus, valueStore, satisfiedEdges, loopCounters, runStatus,
 * pendingHumanInput — and whose internal collections are sorted deterministically:
 *  - nodeStatus: `[nodeId, status]` pairs sorted by nodeId;
 *  - valueStore: `{ key: { nodeId, portId, iterationIndex }, value }` entries sorted
 *    by `valueKeyToString`, each value recursively canonicalized (object keys sorted,
 *    array element order preserved);
 *  - satisfiedEdges: Edge_Id array sorted lexicographically;
 *  - loopCounters: `[scopeId, count]` pairs sorted by scopeId.
 *
 * `JSON.stringify` over this canonical object yields the Canonical_State_Json. Because
 * every container is order-normalized, two semantically-equal states (which may differ
 * only in internal Map/Set enumeration order) produce byte-identical strings (R15.5).
 */
export function serializeState(state: ExecutionState): string {
  // nodeStatus -> [nodeId, status] pairs sorted by nodeId.
  const nodeStatus: Array<[string, ExecutionStatus]> = [...state.nodeStatus.entries()]
    .map(([nodeId, status]): [string, ExecutionStatus] => [nodeId, status])
    .sort((a, b) => compareStrings(a[0], b[0]));

  // valueStore -> entries sorted by canonical Value_Key string, values canonicalized.
  const valueStore = [...state.valueStore.entries()]
    .map(([keyStr, stored]): { readonly keyStr: string; readonly entry: CanonicalStoredValue } => ({
      keyStr,
      entry: {
        // Fixed field order inside the key object: nodeId, portId, iterationIndex.
        key: {
          nodeId: stored.key.endpoint.nodeId,
          portId: stored.key.endpoint.portId,
          iterationIndex: stored.key.iterationIndex,
        },
        value: canonicalizeJson(stored.value),
      },
    }))
    .sort((a, b) => compareStrings(a.keyStr, b.keyStr))
    .map((e) => e.entry);

  // satisfiedEdges -> Edge_Id array sorted lexicographically.
  const satisfiedEdges = [...state.satisfiedEdges].sort(compareStrings);

  // loopCounters -> [scopeId, count] pairs sorted by scopeId.
  const loopCounters: Array<[string, number]> = [...state.loopCounters.entries()]
    .map(([scopeId, count]): [string, number] => [scopeId, count])
    .sort((a, b) => compareStrings(a[0], b[0]));

  // Build the canonical object with a deterministic, fixed top-level field order.
  const canonical = {
    nodeStatus,
    valueStore,
    satisfiedEdges,
    loopCounters,
    runStatus: state.runStatus,
    pendingHumanInput: state.pendingHumanInput,
  };

  return JSON.stringify(canonical);
}

// ---------------------------------------------------------------------------
// 5.2 deserializeState
// ---------------------------------------------------------------------------

/**
 * Restore a Canonical_State_Json string into an ExecutionState (R15.2, R15.7).
 *
 * Performs `JSON.parse` followed by strict per-field structural validation:
 *  - the root is a non-array object carrying all six fields;
 *  - every nodeStatus status is a member of the valid ExecutionStatus set;
 *  - runStatus is a member of the valid RunStatus set;
 *  - every loop counter and every Value_Key iterationIndex is a non-negative integer;
 *  - every Value_Key carries all three segments (nodeId, portId, iterationIndex) and a
 *    present `value`;
 *  - satisfiedEdges is an array of strings and pendingHumanInput is a string or null.
 *
 * Any malformed input (invalid JSON, missing field, wrong type, unknown enum, negative
 * count, truncated string) yields `{ ok: false, error }` (with a position when the JSON
 * parser supplies one); the function never throws and never partially constructs a state
 * (R15.6). On success it rebuilds the ValueStore Map keyed by `valueKeyToString`,
 * preserving all six components including each Value_Key's iterationIndex (R15.7).
 */
export function deserializeState(json: string): StateDeserializeResult {
  // --- Parse -------------------------------------------------------------
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    return fail('Invalid JSON: failed to parse.', extractParsePosition(err));
  }

  // --- Root shape --------------------------------------------------------
  if (!isPlainObject(parsed)) {
    return fail('Invalid state: root must be a JSON object.');
  }
  const root = parsed as Record<string, unknown>;

  // --- nodeStatus --------------------------------------------------------
  const rawNodeStatus = root['nodeStatus'];
  if (!Array.isArray(rawNodeStatus)) {
    return fail('Invalid state: "nodeStatus" must be an array.');
  }
  const nodeStatus = new Map<string, ExecutionStatus>();
  for (const entry of rawNodeStatus) {
    if (!Array.isArray(entry) || entry.length !== 2) {
      return fail('Invalid state: each "nodeStatus" entry must be a [nodeId, status] pair.');
    }
    const [nodeId, status] = entry as [unknown, unknown];
    if (typeof nodeId !== 'string') {
      return fail('Invalid state: "nodeStatus" nodeId must be a string.');
    }
    if (typeof status !== 'string' || !VALID_EXECUTION_STATUSES.has(status)) {
      return fail(`Invalid state: unknown ExecutionStatus "${String(status)}".`);
    }
    nodeStatus.set(nodeId, status as ExecutionStatus);
  }

  // --- valueStore --------------------------------------------------------
  const rawValueStore = root['valueStore'];
  if (!Array.isArray(rawValueStore)) {
    return fail('Invalid state: "valueStore" must be an array.');
  }
  const valueStore = new Map<string, StoredValue>();
  for (const entry of rawValueStore) {
    if (!isPlainObject(entry)) {
      return fail('Invalid state: each "valueStore" entry must be an object.');
    }
    const e = entry as Record<string, unknown>;
    const rawKey = e['key'];
    if (!isPlainObject(rawKey)) {
      return fail('Invalid state: "valueStore" entry is missing a key object.');
    }
    // The value property must be present (null is a legitimate JsonValue).
    if (!Object.prototype.hasOwnProperty.call(e, 'value')) {
      return fail('Invalid state: "valueStore" entry is missing a value.');
    }
    const k = rawKey as Record<string, unknown>;
    const nodeId = k['nodeId'];
    const portId = k['portId'];
    const iterationIndex = k['iterationIndex'];
    if (typeof nodeId !== 'string' || typeof portId !== 'string') {
      return fail('Invalid state: Value_Key must carry string nodeId and portId.');
    }
    if (!isNonNegativeInteger(iterationIndex)) {
      return fail('Invalid state: Value_Key iterationIndex must be a non-negative integer.');
    }
    const key: ValueKey = {
      endpoint: { nodeId, portId },
      iterationIndex,
    };
    valueStore.set(valueKeyToString(key), { key, value: e['value'] as JsonValue });
  }

  // --- satisfiedEdges ----------------------------------------------------
  const rawSatisfiedEdges = root['satisfiedEdges'];
  if (!Array.isArray(rawSatisfiedEdges)) {
    return fail('Invalid state: "satisfiedEdges" must be an array.');
  }
  const satisfiedEdges = new Set<string>();
  for (const edgeId of rawSatisfiedEdges) {
    if (typeof edgeId !== 'string') {
      return fail('Invalid state: each "satisfiedEdges" entry must be a string.');
    }
    satisfiedEdges.add(edgeId);
  }

  // --- loopCounters ------------------------------------------------------
  const rawLoopCounters = root['loopCounters'];
  if (!Array.isArray(rawLoopCounters)) {
    return fail('Invalid state: "loopCounters" must be an array.');
  }
  const loopCounters = new Map<string, number>();
  for (const entry of rawLoopCounters) {
    if (!Array.isArray(entry) || entry.length !== 2) {
      return fail('Invalid state: each "loopCounters" entry must be a [scopeId, count] pair.');
    }
    const [scopeId, count] = entry as [unknown, unknown];
    if (typeof scopeId !== 'string') {
      return fail('Invalid state: "loopCounters" scopeId must be a string.');
    }
    if (!isNonNegativeInteger(count)) {
      return fail('Invalid state: "loopCounters" count must be a non-negative integer.');
    }
    loopCounters.set(scopeId, count);
  }

  // --- runStatus ---------------------------------------------------------
  const rawRunStatus = root['runStatus'];
  if (typeof rawRunStatus !== 'string' || !VALID_RUN_STATUSES.has(rawRunStatus)) {
    return fail(`Invalid state: unknown RunStatus "${String(rawRunStatus)}".`);
  }

  // --- pendingHumanInput -------------------------------------------------
  // The property must be present and be either a string or null.
  if (!Object.prototype.hasOwnProperty.call(root, 'pendingHumanInput')) {
    return fail('Invalid state: "pendingHumanInput" is missing.');
  }
  const rawPending = root['pendingHumanInput'];
  if (rawPending !== null && typeof rawPending !== 'string') {
    return fail('Invalid state: "pendingHumanInput" must be a string or null.');
  }

  // --- Assemble (only after every field validated) -----------------------
  const state: ExecutionState = {
    nodeStatus,
    valueStore,
    satisfiedEdges,
    loopCounters,
    runStatus: rawRunStatus as RunStatus,
    pendingHumanInput: rawPending,
  };

  return { ok: true, state };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** The canonical shape of a serialized ValueStore entry (fixed field order). */
interface CanonicalStoredValue {
  readonly key: {
    readonly nodeId: string;
    readonly portId: string;
    readonly iterationIndex: number;
  };
  readonly value: JsonValue;
}

/** Build a failure result with an optional parse position (R15.6). */
function fail(message: string, position?: number): StateDeserializeResult {
  return position === undefined
    ? { ok: false, error: { message } }
    : { ok: false, error: { message, position } };
}

/** Deterministic string comparison by UTF-16 code unit (the default lexicographic order). */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A non-array, non-null object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether `value` is a finite, non-negative integer. */
function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * Recursively canonicalize a JsonValue: object keys are emitted in sorted order so the
 * subsequent `JSON.stringify` produces a deterministic string; array element order is
 * preserved (arrays are ordered data). Primitives are returned unchanged.
 */
function canonicalizeJson(value: JsonValue): JsonValue {
  if (value === null || typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeJson(item));
  }

  const obj = value as { readonly [key: string]: JsonValue };
  const sortedKeys = Object.keys(obj).sort(compareStrings);
  const result: { [key: string]: JsonValue } = {};
  for (const key of sortedKeys) {
    result[key] = canonicalizeJson(obj[key]);
  }
  return result;
}

/** Best-effort extraction of a JSON parse error position (e.g. "...at position 12"). */
function extractParsePosition(err: unknown): number | undefined {
  if (err instanceof Error) {
    const match = /position (\d+)/.exec(err.message);
    if (match !== null) {
      const pos = Number(match[1]);
      if (Number.isInteger(pos) && pos >= 0) return pos;
    }
  }
  return undefined;
}
