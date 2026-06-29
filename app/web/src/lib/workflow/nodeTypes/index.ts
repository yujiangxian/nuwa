/**
 * workflow-node-types — public API barrel.
 *
 * Feature: workflow-node-types
 *
 * This module only re-exports the public surface of the sibling modules so that
 * the orchestration engine and tests can import everything from a single entry
 * point. It contains no logic of its own.
 *
 * Type-only symbols are re-exported with `export type { ... }` and runtime values
 * (enums / functions) with `export { ... }`, so the barrel stays correct under
 * `isolatedModules` / `verbatimModuleSyntax`.
 */

// ---------------------------------------------------------------------------
// ./configTypes — typed config union, helper types, error & result types
// ---------------------------------------------------------------------------

export type {
  // Discriminated union + per-branch config types
  TypedNodeConfig,
  LlmConfig,
  ConditionConfig,
  ToolConfig,
  TransformConfig,
  HumanInputConfig,
  LoopConfig,
  // Helper declarations
  ArgumentBinding,
  InputPortDecl,
  // NodeType -> config-branch maps
  ConfigByType,
  ConfigOf,
  // Error & validation-result types
  ConfigError,
  ConfigErrorLocation,
  ConfigValidationResult,
} from './configTypes';

// `ConfigErrorCode` is an enum (a runtime value), so it is re-exported as a value.
export { ConfigErrorCode } from './configTypes';

// ---------------------------------------------------------------------------
// ./expression — expression AST, operator aliases, and the static typer
// ---------------------------------------------------------------------------

export type {
  Expression,
  CompareOp,
  LogicOp,
  ArithOp,
  InputTypeEnv,
  ExpressionTypeResult,
  ExpressionTypeError,
} from './expression';

export { typeOfExpression, referencedInputs } from './expression';

// ---------------------------------------------------------------------------
// ./expectedPorts — per-type port contract derivation
// ---------------------------------------------------------------------------

export type { ExpectedPorts } from './expectedPorts';

export { expectedPorts, inferTransformOutputType } from './expectedPorts';

// ---------------------------------------------------------------------------
// ./defaults — default configuration factory
// ---------------------------------------------------------------------------

export type { DefaultConfig } from './defaults';

export { defaultConfig } from './defaults';

// ---------------------------------------------------------------------------
// ./normalize — numeric clamping & canonical normalization
// ---------------------------------------------------------------------------

export { clampNumericFields, normalizeNodeConfig, configSemanticEquals } from './normalize';

// ---------------------------------------------------------------------------
// ./validateConfig — config validation aggregator & per-type check functions
// ---------------------------------------------------------------------------

export {
  validateNodeConfig,
  refineConfig,
  checkLlmConfig,
  checkConditionConfig,
  checkToolConfig,
  checkTransformConfig,
  checkHumanInputConfig,
  checkLoopConfig,
  checkPortContract,
} from './validateConfig';
