// Feature: agent-tool-resolution, Property 16: 校验结果 valid 当且仅当无错误且错误良构
/**
 * Property 16: For legal inputs to each of the three validation functions, the
 * result's `valid` is true iff `errors` is empty, and every ResolutionError has
 * a non-empty `message` string and an object `location`.
 *
 * **Validates: Requirements 4.1, 5.1, 6.1, 7.7**
 */

import { describe, it } from 'vitest';
import fc from 'fast-check';

import {
  validateAgentToolRefs,
  validateRegistriesConsistency,
  resolveToolNodeArguments,
} from './validate';
import {
  arbitraryToolRegistryAndAgent,
  arbitraryAgentRegistry,
  arbitraryToolRegistry,
  arbitraryToolConfigFor,
} from './arbitraries';
import type { ResolutionValidationResult } from './types';
import { listTools } from '../tools/registry';

/** Assert that a validation result is well-formed (R7.7) and valid⇔empty. */
function wellFormed(result: ResolutionValidationResult): boolean {
  if (result.valid !== (result.errors.length === 0)) return false;
  for (const e of result.errors) {
    if (typeof e.message !== 'string' || e.message.length === 0) return false;
    if (typeof e.location !== 'object' || e.location === null) return false;
  }
  return true;
}

/** A ToolRegistry plus a ToolConfig whose toolName exists in that registry. */
const arbitraryRegistryAndToolConfig = arbitraryToolRegistry.chain((toolRegistry) => {
  const tools = listTools(toolRegistry);
  if (tools.length === 0) {
    // No tool to reference; skip by producing a vacuously legal-but-empty pair.
    return fc.constant(null);
  }
  return fc
    .constantFrom(...tools)
    .chain((tool) =>
      arbitraryToolConfigFor(tool).map((toolConfig) => ({ toolRegistry, toolConfig })),
    );
});

describe('Property 16: 校验结果 valid 当且仅当无错误且错误良构', () => {
  it('validateAgentToolRefs：valid⇔errors 空且每条 error 良构', () => {
    fc.assert(
      fc.property(arbitraryToolRegistryAndAgent, ({ toolRegistry, agent }) =>
        wellFormed(validateAgentToolRefs(agent, toolRegistry)),
      ),
      { numRuns: 100 },
    );
  });

  it('validateRegistriesConsistency：valid⇔errors 空且每条 error 良构', () => {
    fc.assert(
      fc.property(
        fc.tuple(arbitraryAgentRegistry, arbitraryToolRegistry),
        ([agentRegistry, toolRegistry]) =>
          wellFormed(validateRegistriesConsistency(agentRegistry, toolRegistry)),
      ),
      { numRuns: 100 },
    );
  });

  it('resolveToolNodeArguments：valid⇔errors 空且每条 error 良构', () => {
    fc.assert(
      fc.property(arbitraryRegistryAndToolConfig, (pair) => {
        if (pair === null) return true; // empty registry: nothing to validate
        return wellFormed(resolveToolNodeArguments(pair.toolConfig, pair.toolRegistry));
      }),
      { numRuns: 100 },
    );
  });
});
