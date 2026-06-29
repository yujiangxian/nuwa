// Feature: agent-conversation-assembly
//
// Assembly validation (R6): pure, deterministic, full reporting with stable
// ordering. No I/O, no exceptions — all errors are expressed as values.

import type { AgentDefinition } from '../agents/types';
import type {
  AssemblyOptions,
  AssemblyValidationResult,
  AssemblyError,
} from './types';
import { AssemblyErrorCode } from './types';
import { SYSTEM_PROMPT_MAX_LENGTH } from '../agents/types';

/** Declaration order of AssemblyErrorCode members, used for stable sorting. */
const ASSEMBLY_ERROR_CODE_ORDER: readonly AssemblyErrorCode[] =
  Object.values(AssemblyErrorCode);

/**
 * Stable comparator for AssemblyError values (R6.5): primarily by
 * AssemblyErrorCode declaration order, then by the located field
 * lexicographically, finally by message as a tie-breaker. The comparator is a
 * total order so sorting is deterministic.
 */
export function compareAssemblyErrors(a: AssemblyError, b: AssemblyError): number {
  const codeDelta =
    ASSEMBLY_ERROR_CODE_ORDER.indexOf(a.code) -
    ASSEMBLY_ERROR_CODE_ORDER.indexOf(b.code);
  if (codeDelta !== 0) return codeDelta;

  const fieldDelta = (a.location.field ?? '').localeCompare(b.location.field ?? '');
  if (fieldDelta !== 0) return fieldDelta;

  return a.message.localeCompare(b.message);
}

/**
 * Validate an assembly request (R6): checks the system-prompt length upper
 * bound and the legality of maxMessages. Collects all violations in a single
 * pass, sorts them with compareAssemblyErrors for a stable, deterministic
 * report, and returns { valid, errors } where valid is true iff errors is empty.
 */
export function validateAssembly(
  agent: AgentDefinition,
  options?: AssemblyOptions,
): AssemblyValidationResult {
  const errors: AssemblyError[] = [];

  // R6.2: System_Prompt length must not exceed SYSTEM_PROMPT_MAX_LENGTH.
  // Use the spread operator to count Unicode code points rather than UTF-16
  // code units, matching the agents-layer length semantics.
  if ([...agent.systemPrompt].length > SYSTEM_PROMPT_MAX_LENGTH) {
    errors.push({
      code: AssemblyErrorCode.ASSEMBLY_SYSTEM_PROMPT_TOO_LONG,
      message: `System prompt exceeds the maximum length of ${SYSTEM_PROMPT_MAX_LENGTH} characters.`,
      location: { field: 'systemPrompt' },
    });
  }

  // R6.3: when provided, maxMessages must be an integer >= 1.
  if (
    options?.maxMessages !== undefined &&
    !(Number.isInteger(options.maxMessages) && options.maxMessages >= 1)
  ) {
    errors.push({
      code: AssemblyErrorCode.ASSEMBLY_MAX_MESSAGES_INVALID,
      message: 'maxMessages must be an integer greater than or equal to 1.',
      location: { field: 'maxMessages' },
    });
  }

  errors.sort(compareAssemblyErrors);

  return { valid: errors.length === 0, errors };
}
