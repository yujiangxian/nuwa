// Feature: agent-tool-resolution, Property 13: 能力索引与逐项派生一致
/**
 * Property 13: For any Capability c, buildCapabilityIndex maps c to exactly the
 * set of Agent_Ids whose agentCapabilities contain c — the index agrees with
 * per-agent derivation.
 *
 * **Validates: Requirements 8.4**
 */

import { describe, it } from 'vitest';
import fc from 'fast-check';

import { agentCapabilities, buildCapabilityIndex } from './capability';
import { listAgents } from '../agents/registry';
import { arbitraryAgentRegistry, arbitraryToolRegistry } from './arbitraries';

describe('Property 13: 能力索引与逐项派生一致', () => {
  it('索引中每个 Capability 对应的 Agent_Id 集合等于逐项派生结果', () => {
    fc.assert(
      fc.property(
        fc.tuple(arbitraryAgentRegistry, arbitraryToolRegistry),
        ([agentRegistry, toolRegistry]) => {
          const idx = buildCapabilityIndex(agentRegistry, toolRegistry);

          // Collect every capability across all agents.
          const allCaps = new Set<string>();
          for (const agent of listAgents(agentRegistry)) {
            for (const cap of agentCapabilities(agent, toolRegistry)) {
              allCaps.add(cap);
            }
          }

          for (const cap of allCaps) {
            const fromIndex = new Set(idx.get(cap) ?? new Set<string>());
            const expected = new Set(
              listAgents(agentRegistry)
                .filter((a) => agentCapabilities(a, toolRegistry).includes(cap))
                .map((a) => a.id),
            );

            if (fromIndex.size !== expected.size) return false;
            for (const id of expected) {
              if (!fromIndex.has(id)) return false;
            }
          }

          return true;
        },
      ),
      { numRuns: 100 },
    );
  });
});
