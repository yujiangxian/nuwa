/**
 * Agent tool system — core data model, error codes, and result types.
 *
 * Feature: agent-tool-system
 *
 * This module is the bottom leaf of the `tools/` layer. It declares only
 * immutable data-model interfaces, the `ToolErrorCode` string enum, error/result
 * value shapes, and derived map/index types. It contains no logic, no I/O, no
 * React, no network, and no mutable global state — pure type declarations that
 * reference the prior layer's `PortType` purely as a type.
 */

import type { PortType } from '../workflow/types';

// ---------------------------------------------------------------------------
// Data model (R2, R3, R4, R14.1)
// ---------------------------------------------------------------------------

/** Parameter definition (R3.1). */
export interface ParameterDef {
  /** Param_Name: non-empty; unique within one schema. */
  readonly name: string;
  /** Param_Type: references the prior-layer PortType. */
  readonly type: PortType;
  /** Required flag. */
  readonly required: boolean;
}

/** Parameter schema (R2.3): an ordered list of ParameterDef with unique Param_Name. */
export type ParameterSchema = readonly ParameterDef[];

/**
 * Tool definition (R2.1): an immutable, typed, reusable tool specification.
 * Equality is based on semantic content (R2.5).
 */
export interface ToolDefinition {
  /** Tool_Id: non-empty; unique within a registry. */
  readonly id: string;
  /** Tool_Name: non-empty. */
  readonly name: string;
  /** Tool_Description: may be the empty string. */
  readonly description: string;
  /** Parameter_Schema. */
  readonly parameters: ParameterSchema;
  /** Result_Type. */
  readonly resultType: PortType;
  /** Tag_Set: no duplicates, each non-empty. */
  readonly tags: readonly string[];
}

/** Immutable tool collection keyed by Tool_Id (R4.1). */
export interface ToolRegistry {
  readonly tools: ReadonlyMap<string, ToolDefinition>;
}

/** Argument_Map (R14.1): Param_Name -> actual-argument PortType. */
export type ArgumentMap = ReadonlyMap<string, PortType>;

// ---------------------------------------------------------------------------
// Error codes (R11.1): all TOOL_-prefixed; values disjoint from the prior four
// layers' enums (R11.2–R11.5).
// ---------------------------------------------------------------------------

export enum ToolErrorCode {
  TOOL_DUPLICATE_ID = 'TOOL_DUPLICATE_ID', // R5.3 / R10.3
  TOOL_NOT_FOUND = 'TOOL_NOT_FOUND', // R6.3 / R7.3
  TOOL_EMPTY_ID = 'TOOL_EMPTY_ID', // R9.2
  TOOL_EMPTY_NAME = 'TOOL_EMPTY_NAME', // R9.3
  TOOL_EMPTY_PARAM_NAME = 'TOOL_EMPTY_PARAM_NAME', // R9.4
  TOOL_DUPLICATE_PARAM = 'TOOL_DUPLICATE_PARAM', // R9.5
  TOOL_EMPTY_TAG = 'TOOL_EMPTY_TAG', // R9.6
  TOOL_MISSING_REQUIRED_ARGUMENT = 'TOOL_MISSING_REQUIRED_ARGUMENT', // R14.2
  TOOL_UNKNOWN_ARGUMENT = 'TOOL_UNKNOWN_ARGUMENT', // R14.3
  TOOL_ARGUMENT_TYPE_MISMATCH = 'TOOL_ARGUMENT_TYPE_MISMATCH', // R14.4
  TOOL_MALFORMED_JSON = 'TOOL_MALFORMED_JSON', // R13.6
}

/** Error location information (R11.6). */
export interface ToolErrorLocation {
  /** The involved Tool_Id. */
  readonly toolId?: string;
  /** The involved field name (id/name). */
  readonly field?: string;
  /** The involved Param_Name. */
  readonly paramName?: string;
  /** The involved Tag. */
  readonly tag?: string;
}

/** A single error value (R11.6). */
export interface ToolError {
  readonly code: ToolErrorCode;
  readonly message: string;
  readonly location: ToolErrorLocation;
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type ToolRegistryResult =
  | { readonly ok: true; readonly registry: ToolRegistry }
  | { readonly ok: false; readonly error: ToolError };

export type RegistryDeserializeResult =
  | { readonly ok: true; readonly registry: ToolRegistry }
  | { readonly ok: false; readonly error: ToolError };

export interface ToolValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ToolError[];
}

export interface RegistryValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ToolError[];
}

export interface ArgumentValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ToolError[];
}

/** Tool_Index: Tag -> set of Tool_Ids holding that Tag (R16.1). */
export type ToolIndex = ReadonlyMap<string, ReadonlySet<string>>;
