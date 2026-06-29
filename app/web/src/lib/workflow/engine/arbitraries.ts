/**
 * Workflow execution engine — custom fast-check arbitraries (test-time only).
 *
 * Feature: workflow-execution-engine
 *
 * This module is imported exclusively by the execution-engine property-based and
 * example tests. Building on the base layer's `arbitraryValidGraph` (which is
 * re-exported here for convenience), it provides deterministic, pure generators
 * for the injected execution environment (node executors, condition evaluator,
 * human-input provider, error policy), reachable intermediate execution states,
 * order-permuted equivalent states, and a recording executor wrapper used to
 * observe the engine's call history.
 *
 * Everything here is pure and deterministic given a fast-check seed: the injected
 * functions return the same output for the same input, so the engine stays a pure,
 * reproducible reducer under test.
 */

import fc from 'fast-check';

import type { JsonValue, NodeType, WorkflowGraph, WorkflowNode } from '../types';
import { NODE_TYPES } from '../types';
import { expectedPorts, refineConfig } from '../nodeTypes';
import type {
  ConditionEvaluator,
  ErrorPolicy,
  ExecutionEnvironment,
  ExecutionState,
  HumanInputProvider,
  NodeExecutor,
  NodeExecutorRegistry,
} from './types';
import { ExecutorErrorCode } from './types';
import { initialState } from './state';
import { step } from './step';

// Re-exported so tests can obtain valid graphs from a single entry point; the
// execution-layer generators below all operate on a `graph` supplied by the caller.
export { arbitraryValidGraph } from '../arbitraries';

// ---------------------------------------------------------------------------
// Deterministic derivation helpers (pure, seed-independent)
// ---------------------------------------------------------------------------

/** A stable 32-bit FNV-1a hash of a string (deterministic, dependency-free). */
function stableHash(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Canonical, order-stable string encoding of an input port-value map (for hashing). */
function serializeInputs(inputs: ReadonlyMap<string, JsonValue>): string {
  const entries = [...inputs.entries()].sort((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
  );
  return JSON.stringify(entries);
}

/**
 * Derive a deterministic, type-plausible JsonValue for an output port from
 * `(nodeId, portId, inputs)`. The same triple always yields the same value, which
 * keeps the executor pure. The simple `{ n, p, h }` object shape is accepted by the
 * engine's output-port-set validation (which checks the Port_Id set, not the value
 * type) and is distinct per (node, port, inputs).
 */
function deriveOutputValue(
  nodeId: string,
  portId: string,
  inputs: ReadonlyMap<string, JsonValue>,
): JsonValue {
  const h = stableHash(`${nodeId}\u0000${portId}\u0000${serializeInputs(inputs)}`);
  return { n: nodeId, p: portId, h };
}

/**
 * The expected output Port_Id set for a node, derived via `refineConfig` +
 * `expectedPorts` (the same contract the engine validates against), falling back to
 * the node's declared output ports when the config cannot be refined — mirroring
 * `step.ts` so generated outputs always pass `validateExecutorOutputs`.
 */
function expectedOutputPortIds(node: WorkflowNode): readonly string[] {
  const refined = refineConfig(node);
  if (refined.ok) {
    try {
      return expectedPorts(node.type, refined.config).outputs.map((p) => p.id);
    } catch {
      // The refined config passed only the discriminator check; fall through.
    }
  }
  return node.outputs.map((p) => p.id);
}

/** A full-length shuffle (permutation) of an array; identity for length <= 1. */
function shuffledFull<T>(arr: readonly T[]): fc.Arbitrary<readonly T[]> {
  if (arr.length <= 1) return fc.constant(arr);
  return fc.shuffledSubarray([...arr], { minLength: arr.length, maxLength: arr.length });
}

// ---------------------------------------------------------------------------
// 8.1 Environment and executor generators
// ---------------------------------------------------------------------------

/**
 * Deterministic mock NodeExecutor_Registry generator. The success executor, for any
 * node, returns `ok` with an outputs map whose Port_Id set EXACTLY equals the node's
 * expected output ports (derived via `refineConfig` + `expectedPorts`, falling back to
 * the node's declared outputs). Each output value is deterministically derived from
 * `(node.id, portId, inputs)`, so the executor is pure.
 *
 * For every node whose id is in `opts.failingNodeIds`, a `byNodeId` override returns a
 * fixed `EXECUTOR_FAILED` failure, driving the failure / block-propagation properties.
 */
export function arbitraryNodeExecutorRegistry(
  graph: WorkflowGraph,
  opts?: { readonly failingNodeIds?: ReadonlySet<string> },
): fc.Arbitrary<NodeExecutorRegistry> {
  const failing = opts?.failingNodeIds ?? new Set<string>();

  // Pure success executor shared by every NodeType; it specialises per node via the
  // node's expected output ports computed at call time.
  const successExecutor: NodeExecutor = (node, inputs) => {
    const outputs = new Map<string, JsonValue>();
    for (const portId of expectedOutputPortIds(node)) {
      outputs.set(portId, deriveOutputValue(node.id, portId, inputs));
    }
    return { ok: true, outputs };
  };

  // Pure failing executor for nodes selected to always fail.
  const failingExecutor: NodeExecutor = (node) => ({
    ok: false,
    code: ExecutorErrorCode.EXECUTOR_FAILED,
    message: `Injected deterministic failure for node "${node.id}".`,
  });

  const byType = new Map<NodeType, NodeExecutor>();
  for (const type of NODE_TYPES) byType.set(type, successExecutor);

  const byNodeId = new Map<string, NodeExecutor>();
  for (const node of graph.nodes) {
    if (failing.has(node.id)) byNodeId.set(node.id, failingExecutor);
  }

  const registry: NodeExecutorRegistry =
    byNodeId.size > 0 ? { byType, byNodeId } : { byType };
  return fc.constant(registry);
}

/**
 * Deterministic Condition_Evaluator generator. The evaluator either returns a fixed
 * boolean (constant-true / constant-false, useful for driving condition routing and
 * loop break behaviour) or derives a boolean from the node id + inputs via hash parity.
 * It is always successful (`{ ok: true, value }`).
 */
export function arbitraryConditionEvaluator(): fc.Arbitrary<ConditionEvaluator> {
  return fc
    .constantFrom<'true' | 'false' | 'derived'>('true', 'false', 'derived')
    .map((mode) => {
      const evaluator: ConditionEvaluator = (node, inputs) => {
        if (mode === 'true') return { ok: true, value: true };
        if (mode === 'false') return { ok: true, value: false };
        const h = stableHash(`${node.id}\u0000${serializeInputs(inputs)}`);
        return { ok: true, value: h % 2 === 0 };
      };
      return evaluator;
    });
}

/**
 * Human_Input_Provider generator. A `human_input` node whose id is NOT in
 * `opts.answeredNodeIds` (or is unknown to the graph) yields `undefined`, causing the
 * engine to pause; an answered node yields a deterministic JsonValue response, driving
 * the resume path.
 */
export function arbitraryHumanInputProvider(
  graph: WorkflowGraph,
  opts?: { readonly answeredNodeIds?: ReadonlySet<string> },
): fc.Arbitrary<HumanInputProvider> {
  const answered = opts?.answeredNodeIds ?? new Set<string>();
  const known = new Set<string>(graph.nodes.map((n) => n.id));

  const provider: HumanInputProvider = (node) => {
    if (!known.has(node.id) || !answered.has(node.id)) return undefined;
    // Deterministic response keyed by the node id (type-plausible JsonValue).
    return { humanInput: node.id, h: stableHash(node.id) };
  };
  return fc.constant(provider);
}

/**
 * Combine the executor registry, condition evaluator and human-input provider into a
 * full Execution_Environment, picking an Error_Policy (fixed via `opts.errorPolicy`,
 * else chosen from the two policies).
 */
export function arbitraryExecutionEnvironment(
  graph: WorkflowGraph,
  opts?: {
    readonly errorPolicy?: ErrorPolicy;
    readonly failingNodeIds?: ReadonlySet<string>;
    readonly answeredNodeIds?: ReadonlySet<string>;
  },
): fc.Arbitrary<ExecutionEnvironment> {
  const errorPolicyArb: fc.Arbitrary<ErrorPolicy> =
    opts?.errorPolicy !== undefined
      ? fc.constant(opts.errorPolicy)
      : fc.constantFrom<ErrorPolicy>('block_downstream', 'fail_fast');

  return fc.record<ExecutionEnvironment>({
    executorRegistry: arbitraryNodeExecutorRegistry(graph, {
      failingNodeIds: opts?.failingNodeIds,
    }),
    conditionEvaluator: arbitraryConditionEvaluator(),
    humanInputProvider: arbitraryHumanInputProvider(graph, {
      answeredNodeIds: opts?.answeredNodeIds,
    }),
    errorPolicy: errorPolicyArb,
  });
}

// ---------------------------------------------------------------------------
// 8.2 State generators and the recording executor
// ---------------------------------------------------------------------------

/**
 * Generate a reachable, valid intermediate ExecutionState: start from
 * `initialState(graph)` and apply 0..N deterministic `step` calls under `env`, stopping
 * early once the run reaches a terminal status, pauses, or makes no progress. The
 * resulting state is genuinely reachable by the engine, so it is well-formed for the
 * serialization / invariant properties.
 */
export function arbitraryExecutionState(
  graph: WorkflowGraph,
  env: ExecutionEnvironment,
): fc.Arbitrary<ExecutionState> {
  const init = initialState(graph);
  if (!init.ok) {
    // An invalid graph has no constructible state; callers pass valid graphs. Return a
    // deterministic minimal Idle state so the generator stays total.
    const fallback: ExecutionState = {
      nodeStatus: new Map(),
      valueStore: new Map(),
      satisfiedEdges: new Set(),
      loopCounters: new Map(),
      runStatus: 'Idle',
      pendingHumanInput: null,
    };
    return fc.constant(fallback);
  }

  const start = init.state;
  // A generous bound on reachable depth so deep states are sampled without unbounded loops.
  const maxSteps = graph.nodes.length * 4 + graph.edges.length + 4;

  return fc.nat({ max: maxSteps }).map((n) => {
    let state = start;
    for (let i = 0; i < n; i++) {
      if (
        state.runStatus === 'Completed' ||
        state.runStatus === 'Failed' ||
        state.runStatus === 'Paused'
      ) {
        break; // terminal or paused: no further reachable intermediate state
      }
      const outcome = step(state, graph, env);
      if (!outcome.ok) break; // defensive: invalid graph mid-run
      if (!outcome.result.progress) break; // converged with no progress
      state = outcome.result.state;
    }
    return state;
  });
}

/**
 * Produce a semantically-equal ExecutionState whose internal Map / Set construction
 * order is permuted: `nodeStatus`, `valueStore` and `loopCounters` Maps and the
 * `satisfiedEdges` Set are rebuilt from shuffled entry arrays. The result is
 * `stateEquals`-equivalent to the input and drives the canonical-serialization
 * uniqueness property.
 */
export function arbitraryReorderedState(state: ExecutionState): fc.Arbitrary<ExecutionState> {
  const nodeStatusEntries = [...state.nodeStatus.entries()];
  const valueStoreEntries = [...state.valueStore.entries()];
  const loopCounterEntries = [...state.loopCounters.entries()];
  const satisfiedEdgeItems = [...state.satisfiedEdges];

  return fc
    .record({
      nodeStatusOrder: shuffledFull(nodeStatusEntries),
      valueStoreOrder: shuffledFull(valueStoreEntries),
      loopCounterOrder: shuffledFull(loopCounterEntries),
      satisfiedEdgeOrder: shuffledFull(satisfiedEdgeItems),
    })
    .map(({ nodeStatusOrder, valueStoreOrder, loopCounterOrder, satisfiedEdgeOrder }) => ({
      nodeStatus: new Map(nodeStatusOrder),
      valueStore: new Map(valueStoreOrder),
      loopCounters: new Map(loopCounterOrder),
      satisfiedEdges: new Set(satisfiedEdgeOrder),
      runStatus: state.runStatus,
      pendingHumanInput: state.pendingHumanInput,
    }));
}

/**
 * Wrap a base NodeExecutor_Registry so every executor invocation is recorded. Each
 * recorded entry captures the invoked node's id and a copy of its inputs (the
 * NodeExecutor signature is `(node, inputs, env)`, so an iteration index is not
 * available from the arguments and is recorded as 0). `calls()` returns a snapshot of
 * the recorded invocations, used by properties that observe the engine's call history.
 */
export function recordingRegistry(base: NodeExecutorRegistry): {
  readonly registry: NodeExecutorRegistry;
  readonly calls: () => ReadonlyArray<{
    nodeId: string;
    iterationIndex: number;
    inputs: ReadonlyMap<string, unknown>;
  }>;
} {
  const recorded: Array<{
    nodeId: string;
    iterationIndex: number;
    inputs: ReadonlyMap<string, unknown>;
  }> = [];

  const wrap =
    (executor: NodeExecutor): NodeExecutor =>
    (node, inputs, env) => {
      // iterationIndex is not derivable from the executor arguments; record what we have.
      recorded.push({ nodeId: node.id, iterationIndex: 0, inputs: new Map(inputs) });
      return executor(node, inputs, env);
    };

  const byType = new Map<NodeType, NodeExecutor>();
  for (const [type, executor] of base.byType) byType.set(type, wrap(executor));

  let byNodeId: Map<string, NodeExecutor> | undefined;
  if (base.byNodeId !== undefined) {
    byNodeId = new Map<string, NodeExecutor>();
    for (const [id, executor] of base.byNodeId) byNodeId.set(id, wrap(executor));
  }

  const registry: NodeExecutorRegistry =
    byNodeId !== undefined ? { byType, byNodeId } : { byType };

  return {
    registry,
    calls: () => recorded.slice(),
  };
}
