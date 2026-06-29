/**
 * workflow-node-types — typed node configuration schema and result types.
 *
 * Feature: workflow-node-types
 *
 * This module is a bottom-level leaf of the nodeTypes sub-spec. It declares the
 * `TypedNodeConfig` discriminated union (one branch per `NodeType`), the helper
 * declarations (`ArgumentBinding`, `InputPortDecl`), the `ConfigByType` map, the
 * `ConfigErrorCode` enum (whose string values are disjoint from the base layer
 * `ErrorCode`), and the error / validation-result types.
 *
 * It contains only type and enum declarations — no logic, no I/O. The reference
 * to `Expression` is a type-only import, so the mutual reference between this
 * module and `./expression` is resolved by TypeScript without a runtime cycle.
 */

import type { NodeType, PortType } from '../types';
import type { Expression } from './expression';

// ---------------------------------------------------------------------------
// 1.1 Per-type config branches (discriminator `kind` equals its NodeType)
// ---------------------------------------------------------------------------

/** llm node config (R2.1). */
export interface LlmConfig {
  readonly kind: 'llm';
  readonly modelId: string; // Model_Id: non-empty string
  readonly systemPrompt: string; // System_Prompt
  readonly temperature: number; // Temperature ∈ [0, 2]
  readonly maxTokens: number; // Max_Tokens: integer ≥ 1
}

/** condition node config (R3.1). */
export interface ConditionConfig {
  readonly kind: 'condition';
  readonly condition: Expression; // Condition_Expression: must type to boolean
}

/** tool node config (R4.1). `argumentBindings` maps Port_Id -> tool argument name. */
export interface ToolConfig {
  readonly kind: 'tool';
  readonly toolName: string; // Tool_Name: non-empty string
  readonly argumentBindings: ReadonlyArray<ArgumentBinding>; // ordered, stable representation
}

/** A single argument binding: input port Port_Id ↦ tool argument name. */
export interface ArgumentBinding {
  readonly portId: string; // must belong to the node's declared input ports
  readonly argName: string; // tool argument name (must be unique within one config)
  readonly portType: PortType; // the input port type (used to derive expectedPorts inputs)
}

/** transform node config (R5.1). */
export interface TransformConfig {
  readonly kind: 'transform';
  readonly transform: Expression; // Transform_Expression
  readonly declaredInputs: ReadonlyArray<InputPortDecl>; // input declarations (the Input_Type_Environment)
  readonly outputType: PortType; // declared output port type (must be isAssignable-compatible with inferred)
}

/** transform input port declaration (id + type + required flag). */
export interface InputPortDecl {
  readonly portId: string;
  readonly portType: PortType;
  readonly required: boolean;
}

/** human_input node config (R6.1). */
export interface HumanInputConfig {
  readonly kind: 'human_input';
  readonly prompt: string; // Human_Prompt: non-empty string
  readonly responseType: PortType; // Response_Type
}

/** loop node config (R7.1). */
export interface LoopConfig {
  readonly kind: 'loop';
  readonly maxIterations: number; // Max_Iterations: integer ≥ 1
  readonly breakCondition: Expression; // Break_Condition: must be assignable to boolean
}

/** Typed node config discriminated union (R1.1): branches cover exactly the six NodeTypes. */
export type TypedNodeConfig =
  | LlmConfig
  | ConditionConfig
  | ToolConfig
  | TransformConfig
  | HumanInputConfig
  | LoopConfig;

/** Maps each NodeType to its config branch type (for generic signatures). */
export interface ConfigByType {
  readonly llm: LlmConfig;
  readonly condition: ConditionConfig;
  readonly tool: ToolConfig;
  readonly transform: TransformConfig;
  readonly human_input: HumanInputConfig;
  readonly loop: LoopConfig;
}

/** Helper: the config branch type for a specific NodeType `T`. */
export type ConfigOf<T extends NodeType> = ConfigByType[T];

// ---------------------------------------------------------------------------
// 1.2 Error codes, error and validation-result types
//     (R8.7, R15.6: values disjoint from the base layer ErrorCode)
// ---------------------------------------------------------------------------

/**
 * Stable config-layer error codes (R8.7). The string values are deliberately
 * chosen to be disjoint from the base layer `ErrorCode` values (R15.6), so the
 * two layers can be aggregated without collision.
 */
export enum ConfigErrorCode {
  CONFIG_TYPE_MISMATCH = 'CONFIG_TYPE_MISMATCH', // R1.5
  MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD', // R2.4 / R4.4 / R6.4
  NUMERIC_OUT_OF_RANGE = 'NUMERIC_OUT_OF_RANGE', // R2.5 / R2.6 / R7.3
  PORT_ARITY_MISMATCH = 'PORT_ARITY_MISMATCH', // R3.3
  PORT_CONTRACT_MISMATCH = 'PORT_CONTRACT_MISMATCH', // R3.4 / R4.5 / R6.5
  DUPLICATE_ARGUMENT_BINDING = 'DUPLICATE_ARGUMENT_BINDING', // R4.6
  EXPRESSION_TYPE_ERROR = 'EXPRESSION_TYPE_ERROR', // R3.6 / R5.4 / R7.5 / R13.6
  EXPRESSION_UNKNOWN_INPUT = 'EXPRESSION_UNKNOWN_INPUT', // R5.5 / R13.5
}

/** Config error location info (R16). Fields are filled as applicable. */
export interface ConfigErrorLocation {
  readonly nodeId: string; // owning node (R16.1, required)
  readonly portId?: string; // involved port (R16.2)
  readonly field?: string; // involved config field name (R16.3)
  readonly exprPortId?: string; // Port_Id involved in an expression typing failure (R16.4)
}

/** A single config error (R8.7, R16.5). */
export interface ConfigError {
  readonly code: ConfigErrorCode;
  readonly message: string; // human-readable description (R16.5)
  readonly location: ConfigErrorLocation;
}

/** Config validation result (R8.1). When `valid` is true, `errors` is empty (R8.2/R8.3). */
export interface ConfigValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ConfigError[];
}
