// Feature: agent-definition-registry
/**
 * Validation module for the agent definition registry.
 *
 * Provides pure, deterministic validation of a single AgentDefinition
 * (validateAgent) and of an entire AgentRegistry (validateRegistry), plus a
 * stable comparator (compareAgentErrors) used to order collected errors so the
 * output never depends on the order in which rules fired.
 *
 * This module depends only on `./types`. To avoid a circular dependency with
 * `./registry`, it walks `registry.agents` directly instead of importing
 * `listAgents`.
 */

import {
  AgentErrorCode,
  SYSTEM_PROMPT_MAX_LENGTH,
  type AgentDefinition,
  type AgentError,
  type AgentRegistry,
  type AgentValidationResult,
  type RegistryValidationResult,
} from './types';

/**
 * Declaration order of AgentErrorCode members, used as the primary sort key in
 * compareAgentErrors. Object.values on a string enum yields its members in
 * declaration order.
 */
const ERROR_CODE_ORDER: readonly AgentErrorCode[] = Object.values(AgentErrorCode);

/** Index of an error code within the enum declaration order. */
function codeRank(code: AgentErrorCode): number {
  return ERROR_CODE_ORDER.indexOf(code);
}

/** UTF-16 code-unit lexicographic comparison. */
function cmpString(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Stable comparator (R10.10, R11.5): first by AgentErrorCode declaration order,
 * then by location fields (agentId, field, toolId) in lexicographic order, and
 * finally by message as a total-order tie breaker for stable, deterministic
 * output.
 */
export function compareAgentErrors(a: AgentError, b: AgentError): number {
  // 1. By error-code declaration order.
  const byCode = codeRank(a.code) - codeRank(b.code);
  if (byCode !== 0) return byCode;

  // 2. By location fields, lexicographically: agentId, field, toolId.
  const byAgentId = cmpString(a.location.agentId ?? '', b.location.agentId ?? '');
  if (byAgentId !== 0) return byAgentId;

  const byField = cmpString(a.location.field ?? '', b.location.field ?? '');
  if (byField !== 0) return byField;

  const byToolId = cmpString(a.location.toolId ?? '', b.location.toolId ?? '');
  if (byToolId !== 0) return byToolId;

  // 3. Message fallback to guarantee a stable total order.
  return cmpString(a.message, b.message);
}

/**
 * Single-agent validation (R10.1, algorithm 2). Every rule is evaluated
 * independently without short-circuiting (R10.10), each violation pushes an
 * AgentError carrying a non-empty message and a location. Collected errors are
 * sorted with compareAgentErrors for deterministic, stable output (R10.11).
 */
export function validateAgent(agent: AgentDefinition): AgentValidationResult {
  const errors: AgentError[] = [];

  // R10.2: empty id.
  if (agent.id === '') {
    errors.push({
      code: AgentErrorCode.AGENT_EMPTY_ID,
      message: 'Agent id must be a non-empty string.',
      location: { field: 'id' },
    });
  }

  // R10.3: empty name.
  if (agent.name === '') {
    errors.push({
      code: AgentErrorCode.AGENT_EMPTY_NAME,
      message: 'Agent name must be a non-empty string.',
      location: { field: 'name' },
    });
  }

  // R10.4: temperature out of [0, 2]. NaN fails the comparison and is treated
  // as out of range.
  const t = agent.model.params.temperature;
  if (!(t >= 0 && t <= 2)) {
    errors.push({
      code: AgentErrorCode.AGENT_TEMPERATURE_OUT_OF_RANGE,
      message: 'Temperature must be within the range [0, 2].',
      location: { field: 'temperature' },
    });
  }

  // R10.5: maxTokens must be an integer ≥ 1.
  const m = agent.model.params.maxTokens;
  if (!(Number.isInteger(m) && m >= 1)) {
    errors.push({
      code: AgentErrorCode.AGENT_MAX_TOKENS_INVALID,
      message: 'maxTokens must be an integer greater than or equal to 1.',
      location: { field: 'maxTokens' },
    });
  }

  // R10.6: topP out of [0, 1]. NaN fails the comparison and is treated as out
  // of range.
  const p = agent.model.params.topP;
  if (!(p >= 0 && p <= 1)) {
    errors.push({
      code: AgentErrorCode.AGENT_TOP_P_OUT_OF_RANGE,
      message: 'topP must be within the range [0, 1].',
      location: { field: 'topP' },
    });
  }

  // R10.7: duplicate tool bindings. Emit exactly one error per toolId that
  // appears two or more times, located by that toolId.
  const toolCounts = new Map<string, number>();
  for (const binding of agent.tools) {
    toolCounts.set(binding.toolId, (toolCounts.get(binding.toolId) ?? 0) + 1);
  }
  for (const [toolId, count] of toolCounts) {
    if (count >= 2) {
      errors.push({
        code: AgentErrorCode.AGENT_DUPLICATE_TOOL_BINDING,
        message: `Tool binding "${toolId}" appears more than once.`,
        location: { toolId },
      });
    }
  }

  // R10.8: system prompt too long, measured in Unicode code points.
  if ([...agent.systemPrompt].length > SYSTEM_PROMPT_MAX_LENGTH) {
    errors.push({
      code: AgentErrorCode.AGENT_SYSTEM_PROMPT_TOO_LONG,
      message: `System prompt exceeds the maximum length of ${SYSTEM_PROMPT_MAX_LENGTH} characters.`,
      location: { field: 'systemPrompt' },
    });
  }

  errors.sort(compareAgentErrors);
  return { valid: errors.length === 0, errors };
}

/**
 * Registry validation (R11.1, algorithm 3). Applies validateAgent to every
 * entry and aggregates the errors, then checks global Agent_Id uniqueness by
 * counting the .id multiplicity of the entry values: any id appearing two or
 * more times yields one AGENT_DUPLICATE_ID error. Collected errors are sorted
 * with compareAgentErrors for deterministic, stable output (R11.5).
 *
 * Entries are walked in Agent_Id lexicographic order so aggregation is stable
 * regardless of the underlying Map iteration order.
 */
export function validateRegistry(registry: AgentRegistry): RegistryValidationResult {
  const errors: AgentError[] = [];

  // Walk values in Agent_Id lexicographic order for stable aggregation.
  const values = [...registry.agents.values()].sort((a, b) => cmpString(a.id, b.id));

  // R11.2: per-agent validation.
  for (const agent of values) {
    errors.push(...validateAgent(agent).errors);
  }

  // R11.3: global id uniqueness based on entry-value .id multiplicity.
  const idCounts = new Map<string, number>();
  for (const agent of values) {
    idCounts.set(agent.id, (idCounts.get(agent.id) ?? 0) + 1);
  }
  for (const [id, count] of idCounts) {
    if (count >= 2) {
      errors.push({
        code: AgentErrorCode.AGENT_DUPLICATE_ID,
        message: `Agent id "${id}" is held by more than one registry entry.`,
        location: { agentId: id },
      });
    }
  }

  errors.sort(compareAgentErrors);
  return { valid: errors.length === 0, errors };
}
