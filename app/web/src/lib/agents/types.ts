/**
 * Feature: agent-definition-registry
 *
 * Foundational type module for the agent definition registry — the fourth
 * sub-spec of Nuwa's multi-agent workflow orchestration engine.
 *
 * This module declares the pure, immutable data models, the layer's error-code
 * enumeration, discriminated-union result types, derived helper types and the
 * fixed numeric/length constants. It contains no logic, no I/O, no React, no
 * network access and no mutable global state — only type-level and constant
 * declarations consumed by the other `agents/*` modules.
 *
 * All `AGENT_`-prefixed error codes are disjoint from the error-code sets of
 * the three prior layers (workflow-graph-model, workflow-node-types,
 * workflow-execution-engine), enabling cross-layer aggregation (R12).
 */

// —— Generation params & model binding ——

/** Generation parameter group (R3.2). temperature/topP are reals, maxTokens is an integer. */
export interface GenerationParams {
  readonly temperature: number; // Temperature ∈ [0, 2] (R3.3)
  readonly maxTokens: number; // Max_Tokens: integer ≥ 1 (R3.5)
  readonly topP: number; // Top_P ∈ [0, 1] (R3.4)
}

/** Model binding (R3.1): a Model_Id reference plus a set of generation params. */
export interface ModelBinding {
  readonly modelId: string; // Model_Id: non-empty string
  readonly params: GenerationParams;
}

/** Tool binding (R4.1): carries a single non-empty Tool_Id. */
export interface ToolBinding {
  readonly toolId: string;
}

/** Voice binding (R4.3): carries a single non-empty Voice_Id. */
export interface VoiceBinding {
  readonly voiceId: string;
}

// —— Agent definition ——

/**
 * Agent definition (R2.1): an immutable, typed, reusable AI agent spec.
 * Equality is based on the semantic content of all fields, not reference
 * identity (R2.5).
 */
export interface AgentDefinition {
  readonly id: string; // Agent_Id: non-empty, unique within a registry
  readonly name: string; // Agent_Name: non-empty string
  readonly role: string; // Agent_Role: may be an empty string
  readonly systemPrompt: string; // System_Prompt: length ≤ SYSTEM_PROMPT_MAX_LENGTH
  readonly model: ModelBinding; // model binding
  readonly tools: readonly ToolBinding[]; // Tool_Binding_List: ordered, Tool_Id unique
  readonly voice: VoiceBinding | null; // nullable voice binding (R4.3)
  readonly tags: readonly string[]; // Tag_Set: unique, each non-empty
}

// —— Registry ——

/** Immutable collection of agents keyed by Agent_Id (R5.1). */
export interface AgentRegistry {
  readonly agents: ReadonlyMap<string, AgentDefinition>;
}

// —— Error codes (R12.1): all AGENT_ prefixed; value set disjoint from the
//    three prior layers' enumerations (R12.2–R12.4) ——

export enum AgentErrorCode {
  AGENT_DUPLICATE_ID = 'AGENT_DUPLICATE_ID', // R6.3 / R11.3
  AGENT_NOT_FOUND = 'AGENT_NOT_FOUND', // R7.3 / R8.3
  AGENT_EMPTY_ID = 'AGENT_EMPTY_ID', // R10.2
  AGENT_EMPTY_NAME = 'AGENT_EMPTY_NAME', // R10.3
  AGENT_TEMPERATURE_OUT_OF_RANGE = 'AGENT_TEMPERATURE_OUT_OF_RANGE', // R10.4
  AGENT_MAX_TOKENS_INVALID = 'AGENT_MAX_TOKENS_INVALID', // R10.5
  AGENT_TOP_P_OUT_OF_RANGE = 'AGENT_TOP_P_OUT_OF_RANGE', // R10.6
  AGENT_DUPLICATE_TOOL_BINDING = 'AGENT_DUPLICATE_TOOL_BINDING', // R10.7
  AGENT_SYSTEM_PROMPT_TOO_LONG = 'AGENT_SYSTEM_PROMPT_TOO_LONG', // R10.8
  AGENT_MALFORMED_JSON = 'AGENT_MALFORMED_JSON', // R15.6
}

/** Error location info (R12.5). Each field is filled in on demand. */
export interface AgentErrorLocation {
  readonly agentId?: string; // the involved Agent_Id
  readonly field?: string; // the involved field (id/name/temperature/maxTokens/topP/systemPrompt)
  readonly toolId?: string; // the involved duplicate Tool_Id
}

/** A single error value (R12.5). */
export interface AgentError {
  readonly code: AgentErrorCode;
  readonly message: string; // human-readable description
  readonly location: AgentErrorLocation;
}

// —— Result types ——

/** Mutation result (R6.1 / R7.1 / R8.1). */
export type RegistryResult =
  | { readonly ok: true; readonly registry: AgentRegistry }
  | { readonly ok: false; readonly error: AgentError };

/** Deserialization result (R15.2 / R15.6). */
export type RegistryDeserializeResult =
  | { readonly ok: true; readonly registry: AgentRegistry }
  | { readonly ok: false; readonly error: AgentError };

/** Single-agent validation result (R10.1). valid is true ⇔ errors is empty. */
export interface AgentValidationResult {
  readonly valid: boolean;
  readonly errors: readonly AgentError[];
}

/** Registry validation result (R11.1). valid is true ⇔ errors is empty. */
export interface RegistryValidationResult {
  readonly valid: boolean;
  readonly errors: readonly AgentError[];
}

/** Model binding resolution result (R16.1). */
export interface ModelBindingResolution {
  readonly modelId: string;
  readonly params: GenerationParams;
}

/** Tag_Index: Tag -> set of Agent_Ids holding that Tag (R17.1). */
export type TagIndex = ReadonlyMap<string, ReadonlySet<string>>;

// —— Constants ——

/** Maximum allowed character length for System_Prompt (fixed positive upper bound). */
export const SYSTEM_PROMPT_MAX_LENGTH = 8000;

/** Generation_Params legal range constants. */
export const TEMPERATURE_MIN = 0;
export const TEMPERATURE_MAX = 2;
export const TOP_P_MIN = 0;
export const TOP_P_MAX = 1;
export const MAX_TOKENS_MIN = 1;
