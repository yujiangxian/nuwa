// Feature: agent-tool-resolution, Property 12: 能力派生忠实且完备
/**
 * Property 12: agentCapabilities is faithful and complete with respect to the
 * Tag_Sets of the agent's resolved tools — every derived Capability appears in
 * some resolved tool's Tag_Set, and every Tag of every resolved tool appears in
 * the derived capabilities. The result is de-duplicated and ascending.
 *
 * **Validates: Requirements 8.1, 8.2**
 */

import { describe, it } from 'vitest';
import fc from 'fast-check';

import { agentCapabilities } from './capability';
import { resolveAgentTools } from './resolve';
import { arbitraryToolRegistryAndAgent } from './arbitraries';

describe('Property 12: 能力派生忠实且完备', () => {
  it('agentCapabilities 为已解析工具标签之并（忠实且完备），去重且严格升序', () => {
    fc.assert(
      fc.property(arbitraryToolRegistryAndAgent, ({ toolRegistry, agent }) => {
        const caps = agentCapabilities(agent, toolRegistry);

        // Union of all resolved tools' tags.
        const resolved = resolveAgentTools(agent, toolRegistry).resolved;
        const resolvedTags = new Set<string>();
        for (const rb of resolved) {
          for (const tag of rb.tool.tags) resolvedTags.add(tag);
        }

        const capsSet = new Set(caps);

        // Bidirectional containment: caps set === resolvedTags set.
        if (capsSet.size !== resolvedTags.size) return false;
        for (const c of capsSet) {
          if (!resolvedTags.has(c)) return false;
        }
        for (const t of resolvedTags) {
          if (!capsSet.has(t)) return false;
        }

        // De-duplicated and strictly ascending (UTF-16 lexicographic).
        for (let i = 1; i < caps.length; i++) {
          if (!(caps[i - 1] < caps[i])) return false;
        }

        return true;
      }),
      { numRuns: 100 },
    );
  });
});
