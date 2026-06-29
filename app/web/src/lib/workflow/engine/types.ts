// Execution-layer data models and enums for the workflow execution engine.
//
// All declarations follow the prior sub-specs' style: every field is `readonly`,
// collections use `ReadonlyMap`/`ReadonlySet`, and no classes are used. The engine
// reuses the base layer's `Endpoint`, `JsonValue`, `NodeType`, `WorkflowGraph` and
// `WorkflowNode` types; those are NOT redefined here.
//
// This is a pure types module: `ExecutorErrorCode` (an enum) is the only runtime value.

import type { Endpoint, JsonValue, NodeType, WorkflowGraph, WorkflowNode } from '../types';

// ---------------------------------------------------------------------------
// Status enums
// ---------------------------------------------------------------------------

/** Execution status of a single node (R2.2). */
export type ExecutionStatus =
  | 'Pending'    // Not yet executable (a required input is unproduced or the upstream gate is unmet)
  | 'Ready'      // All required inputs produced and upstream gate satisfied; selectable
  | 'Running'    // Selected; NodeExecutor is being invoked within this micro-step (transient marker)
  | 'Completed'  // NodeExecutor returned success and outputs were written to the ValueStore
  | 'Skipped'    // On an untaken branch with no other satisfied path reaching it
  | 'Failed'     // NodeExecutor returned a failure
  | 'Blocked';   // Cannot execute due to an upstream Failed node (per Error_Policy)

/** Status of an entire run (R2.3). */
export type RunStatus =
  | 'Idle'       // Initial, not-yet-started state
  | 'Running'    // Actively advancing
  | 'Paused'     // Paused at a human_input node, awaiting an injected response
  | 'Completed'  // All reachable, non-Skipped nodes completed
  | 'Failed';    // A Failed node exists and there is no remaining non-blocked progress

/** Terminal RunStatus. */
export type TerminalStatus = Extract<RunStatus, 'Completed' | 'Failed'>;

// ---------------------------------------------------------------------------
// Value_Key and ValueStore
// ---------------------------------------------------------------------------

/**
 * The ValueStore key: jointly determined by an Endpoint (nodeId, portId) and a
 * Loop_Iteration_Index (R2.4, R6.3). Within a non-loop scope `iterationIndex` is
 * always the base index 0. For nested loops, `iterationIndex` is a composite of
 * each enclosing LoopScope's current counter (see key algorithm 4).
 */
export interface ValueKey {
  readonly endpoint: Endpoint;       // (nodeId, portId)
  readonly iterationIndex: number;   // iteration round; 0 for a non-loop scope
}

/** ValueStore: an immutable map of produced port values, indexed by canonical string keys (see valueKeyToString). */
export type ValueStore = ReadonlyMap<string, StoredValue>;

/** A produced port value: carries its structured key and produced value, for serialization and key-wise comparison. */
export interface StoredValue {
  readonly key: ValueKey;
  readonly value: JsonValue;
}

/** Canonical string encoding of a Value_Key: `${nodeId}\u0000${portId}\u0000${iterationIndex}`. */
export type ValueKeyString = string;

// ---------------------------------------------------------------------------
// ExecutionState
// ---------------------------------------------------------------------------

/** The complete, serializable state of a run at a point in time (R2.1). Immutable structure. */
export interface ExecutionState {
  /** Node_Status_Map: exactly one entry per WorkflowNode (R2.7). */
  readonly nodeStatus: ReadonlyMap<string, ExecutionStatus>;
  /** ValueStore: Value_Key -> produced port value (R2.4). */
  readonly valueStore: ValueStore;
  /** The set of satisfied edges, represented by Edge_Id (R2.1, R17.6). */
  readonly satisfiedEdges: ReadonlySet<string>;
  /** Loop_Counter_Map: Loop_Scope_Id -> number of completed iterations (from 0). */
  readonly loopCounters: ReadonlyMap<string, number>;
  /** Status of the entire run. */
  readonly runStatus: RunStatus;
  /** Node_Id of the human_input node currently paused awaiting a human response; null when not paused. */
  readonly pendingHumanInput: string | null;
}

// ---------------------------------------------------------------------------
// NodeExecutor and execution results
// ---------------------------------------------------------------------------

/** Stable enum identifier carried by a failing NodeExecutorResult (R14.1). */
export enum ExecutorErrorCode {
  EXECUTOR_FAILED = 'EXECUTOR_FAILED',             // Executor actively returned a failure
  INVALID_OUTPUT = 'INVALID_OUTPUT',               // Output port set does not match expectedPorts
  MISSING_INPUT = 'MISSING_INPUT',                 // A required input was missing before the call (defensive)
  CONDITION_EVAL_FAILED = 'CONDITION_EVAL_FAILED', // Condition evaluator raised an error
  INVALID_GRAPH = 'INVALID_GRAPH',                 // An unvalidated graph was passed in (R1.5)
  INTERNAL = 'INTERNAL',                           // A should-not-happen internal inconsistency
}

/**
 * The NodeExecutor return value: on success it carries an Output_Port Port_Id -> produced value map;
 * on failure it carries an Executor_Error_Code and a readable description.
 */
export type NodeExecutorResult =
  | { readonly ok: true; readonly outputs: ReadonlyMap<string, JsonValue> }
  | { readonly ok: false; readonly code: ExecutorErrorCode; readonly message: string };

/**
 * The injected pure "node executor": maps a WorkflowNode and its input port values
 * (in the current iteration scope) to output port values or a failure. Must be pure
 * (same input always yields the same output).
 */
export type NodeExecutor = (
  node: WorkflowNode,
  inputs: ReadonlyMap<string, JsonValue>, // Input_Port Port_Id -> value
  env: ExecutionEnvironment,
) => NodeExecutorResult;

// ---------------------------------------------------------------------------
// Execution_Environment (injected environment)
// ---------------------------------------------------------------------------

/** Error propagation policy (R14.2, R14.3). */
export type ErrorPolicy = 'block_downstream' | 'fail_fast';

/**
 * NodeExecutor_Registry: an injected mapping from NodeType or a concrete Node_Id to a NodeExecutor.
 * Resolution priority: exact Node_Id match first, then fall back to NodeType.
 */
export interface NodeExecutorRegistry {
  readonly byNodeId?: ReadonlyMap<string, NodeExecutor>;
  readonly byType: ReadonlyMap<NodeType, NodeExecutor>;
}

/**
 * Condition_Evaluator: maps a condition node, or a loop node's Break_Condition, evaluated
 * over its input values, to a deterministic boolean (R7.1, R8.2, R8.3). Pure function.
 */
export type ConditionEvaluator = (
  node: WorkflowNode,
  inputs: ReadonlyMap<string, JsonValue>,
) => { readonly ok: true; readonly value: boolean } | { readonly ok: false; readonly message: string };

/**
 * Human_Input_Provider: maps a human_input node to a deterministic response value or "no response yet"
 * (R12.1, R12.2). Returning undefined means no response has been provided (should pause). Pure function.
 */
export type HumanInputProvider = (node: WorkflowNode) => JsonValue | undefined;

/** The immutable environment (env) injected into the engine. All external behavior is obtained deterministically via env. */
export interface ExecutionEnvironment {
  readonly executorRegistry: NodeExecutorRegistry;
  readonly conditionEvaluator: ConditionEvaluator;
  readonly humanInputProvider: HumanInputProvider;
  readonly errorPolicy: ErrorPolicy;
}

// ---------------------------------------------------------------------------
// Result types for step / run
// ---------------------------------------------------------------------------

/** The step return value (R3.1, R4.6). */
export interface MicroStepResult {
  readonly state: ExecutionState;
  /** Progress_Flag: whether this step advanced at least one node status or one LoopCounter. */
  readonly progress: boolean;
}

/** The run return value (R10.1). */
export interface RunResult {
  readonly state: ExecutionState;
  /** Number of steps applied. */
  readonly steps: number;
}

// ---------------------------------------------------------------------------
// Serialization result types
// ---------------------------------------------------------------------------

/** serializeState failure result (theoretically only for internal inconsistency; normal states are always serializable). */
export interface StateSerializeError {
  readonly message: string;
}

/** The deserializeState return value (R15.2, R15.6). */
export type StateDeserializeResult =
  | { readonly ok: true; readonly state: ExecutionState }
  | { readonly ok: false; readonly error: StateDeserializeError };

export interface StateDeserializeError {
  readonly message: string;
  readonly position?: number; // JSON parse failure position (when available)
}

// ---------------------------------------------------------------------------
// Error result wrappers (used to reject invalid graphs in step/run/serialize)
// ---------------------------------------------------------------------------

/** Returned by public functions when an unvalidated graph is passed in (R1.5). */
export interface EngineError {
  readonly code: ExecutorErrorCode; // typically INVALID_GRAPH
  readonly message: string;
}

export type StepOutcome =
  | { readonly ok: true; readonly result: MicroStepResult }
  | { readonly ok: false; readonly error: EngineError };

export type RunOutcome =
  | { readonly ok: true; readonly result: RunResult }
  | { readonly ok: false; readonly error: EngineError };

// Re-exported base-layer types are referenced above for type positions only;
// WorkflowGraph is part of several signatures consumed by sibling modules.
export type { WorkflowGraph };
