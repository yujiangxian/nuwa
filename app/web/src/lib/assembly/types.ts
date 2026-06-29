/**
 * Assembly types, enums, and constants.
 *
 * Feature: agent-conversation-assembly
 *
 * Pure type/enum/constant declarations: no logic, no I/O, no imports.
 */

/** Assembly options (R3.1). */
export interface AssemblyOptions {
  /** Max_Messages: integer >= 1; absent means no truncation (R3.2, R3.3). */
  readonly maxMessages?: number;
}

/**
 * Error codes (R7.1): all ASSEMBLY_ prefixed, disjoint from the prior seven
 * layers' enums (R7.2-R7.8).
 */
export enum AssemblyErrorCode {
  /** R6.2 */
  ASSEMBLY_SYSTEM_PROMPT_TOO_LONG = 'ASSEMBLY_SYSTEM_PROMPT_TOO_LONG',
  /** R6.3 */
  ASSEMBLY_MAX_MESSAGES_INVALID = 'ASSEMBLY_MAX_MESSAGES_INVALID',
}

/** Error location information (R7.9). */
export interface AssemblyErrorLocation {
  readonly field?: string;
}

/** Single error value (R7.9). */
export interface AssemblyError {
  readonly code: AssemblyErrorCode;
  readonly message: string;
  readonly location: AssemblyErrorLocation;
}

/** Validation result (R6.1). valid is true iff errors is empty. */
export interface AssemblyValidationResult {
  readonly valid: boolean;
  readonly errors: readonly AssemblyError[];
}

/** Message_Id prefix for derived System_Message (R2.3). */
export const SYSTEM_MESSAGE_ID_PREFIX = 'system:';
