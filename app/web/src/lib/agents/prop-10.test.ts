// Feature: agent-definition-registry, Property 10: validateAgent 完整报告、确定与稳定排序
import { describe, it } from 'vitest';
import fc from 'fast-check';
import { validateAgent } from './validate';
import { AgentErrorCode } from './types';
import type { AgentDefinition, AgentError } from './types';
import { arbitraryValidAgentDefinition } from './arbitraries';

/** Serialize an error's code + location into a comparable key string. */
function errKey(e: AgentError): string {
  const loc = e.location;
  return `${e.code}|${loc.agentId ?? ''}|${loc.field ?? ''}|${loc.toolId ?? ''}`;
}

describe('Property 10: validateAgent full report, determinism and stable ordering', () => {
  it('reports every injected violation, is deterministic, and is order-insensitive to tools/tags permutation', () => {
    // **Validates: Requirements 10.10, 10.11**
    fc.assert(
      fc.property(arbitraryValidAgentDefinition, (base) => {
        // Inject k >= 2 mutually independent violations: empty id + empty name +
        // topP out of range + a duplicate tool binding.
        const invalid: AgentDefinition = {
          ...base,
          id: '',
          name: '',
          model: { ...base.model, params: { ...base.model.params, topP: 1.5 } },
          tools: [{ toolId: 'dup' }, { toolId: 'dup' }],
        };

        const codes = validateAgent(invalid).errors.map((e) => e.code);
        // Full report (no short-circuit): every injected code must be present.
        for (const expected of [
          AgentErrorCode.AGENT_EMPTY_ID,
          AgentErrorCode.AGENT_EMPTY_NAME,
          AgentErrorCode.AGENT_TOP_P_OUT_OF_RANGE,
          AgentErrorCode.AGENT_DUPLICATE_TOOL_BINDING,
        ]) {
          if (!codes.includes(expected)) return false;
        }

        // Determinism: two calls return deep-equal results.
        const a1 = validateAgent(invalid);
        const a2 = validateAgent(invalid);
        if (JSON.stringify(a1) !== JSON.stringify(a2)) return false;

        // Stable ordering: permuting tools/tags write order yields the same
        // sorted error sequence (by code + location key).
        const permuted: AgentDefinition = {
          ...invalid,
          tools: [...invalid.tools].reverse(),
          tags: [...invalid.tags].reverse(),
        };
        const seqA = validateAgent(invalid).errors.map(errKey);
        const seqB = validateAgent(permuted).errors.map(errKey);
        if (seqA.length !== seqB.length) return false;
        for (let i = 0; i < seqA.length; i++) {
          if (seqA[i] !== seqB[i]) return false;
        }
        return true;
      }),
      { numRuns: 100 }
    );
  });
});
