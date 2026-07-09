// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

/**
 * Resolution data model and error types.
 *
 * Feature: agent-tool-resolution
 *
 * Pure, immutable type and enum declarations for the agent-tool-resolution
 * layer. This module contains no logic and no I/O; it only declares the data
 * shapes used by the resolution, validation, and capability-derivation
 * functions. Prior-layer types (e.g. ToolDefinition) are referenced by import
 * and never redefined.
 */

import type { ToolDefinition } from '../tools/types';

/** A Tool_Id paired with the ToolDefinition it resolved to (R2.1). */
export interface ResolvedToolBinding {
  readonly toolId: string;
  readonly tool: ToolDefinition;
}

/** The result of resolving a single agent's tool bindings (R2.2). */
export interface AgentResolution {
  readonly agentId: string;
  /** Resolved bindings, ordered ascending by toolId and de-duplicated. */
  readonly resolved: readonly ResolvedToolBinding[];
  /** Dangling Tool_Ids, ordered ascending lexicographically and de-duplicated. */
  readonly unresolved: readonly string[];
}

/**
 * Stable error codes (R7.1). All values are RESOLUTION_-prefixed and disjoint
 * from the five prior-layer error-code enums (R7.2-R7.6).
 */
export enum ResolutionErrorCode {
  RESOLUTION_TOOL_NOT_FOUND = 'RESOLUTION_TOOL_NOT_FOUND',
  RESOLUTION_AGENT_NOT_FOUND = 'RESOLUTION_AGENT_NOT_FOUND',
  RESOLUTION_ARGUMENT_INVALID = 'RESOLUTION_ARGUMENT_INVALID',
  RESOLUTION_DUPLICATE_ARGUMENT = 'RESOLUTION_DUPLICATE_ARGUMENT',
}

/** Locating information for a ResolutionError (R7.7). */
export interface ResolutionErrorLocation {
  readonly agentId?: string;
  readonly toolId?: string;
  readonly toolName?: string;
  readonly paramName?: string;
  readonly field?: string;
}

/** A single error value (R7.7). */
export interface ResolutionError {
  readonly code: ResolutionErrorCode;
  readonly message: string;
  readonly location: ResolutionErrorLocation;
}

/** Validation result (R4.1 / R5.1 / R6.1). valid is true iff errors is empty. */
export interface ResolutionValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ResolutionError[];
}

/** Capability_Index: Capability(Tag) -> set of Agent_Ids holding it (R8.3). */
export type CapabilityIndex = ReadonlyMap<string, ReadonlySet<string>>;
