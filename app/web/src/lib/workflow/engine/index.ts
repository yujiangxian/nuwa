// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

/**
 * Workflow execution engine — public API barrel (`engine/index.ts`).
 *
 * Feature: workflow-execution-engine
 *
 * Re-exports the engine's public surface from its sibling modules. This file holds
 * no logic of its own — it only forwards the types and functions other code should
 * consume. Under `verbatimModuleSyntax`, type-only symbols are re-exported with
 * `export type` and runtime values with a plain `export`.
 */

// --- Public types (from ./types) -------------------------------------------
export type {
  ExecutionStatus,
  RunStatus,
  TerminalStatus,
  ValueKey,
  ValueStore,
  StoredValue,
  ExecutionState,
  NodeExecutor,
  NodeExecutorResult,
  NodeExecutorRegistry,
  ConditionEvaluator,
  HumanInputProvider,
  ExecutionEnvironment,
  ErrorPolicy,
  MicroStepResult,
  RunResult,
  StepOutcome,
  RunOutcome,
  EngineError,
  StateSerializeError,
  StateDeserializeResult,
  StateDeserializeError,
} from './types';

// --- Runtime enum (from ./types) -------------------------------------------
export { ExecutorErrorCode } from './types';

// --- State construction, key codec and equality (from ./state) -------------
export { initialState, valueKeyToString, valueKeyFromString, stateEquals } from './state';

// --- Micro-step reducer (from ./step) --------------------------------------
export { step } from './step';

// --- Run-to-completion driver and step budget (from ./run) -----------------
export { run, stepBudget } from './run';

// --- Canonical state serialization (from ./serializeState) -----------------
export { serializeState, deserializeState } from './serializeState';
