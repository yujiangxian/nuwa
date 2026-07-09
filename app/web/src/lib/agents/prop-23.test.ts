// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-definition-registry, Property 23: 标签索引与按工具/按标签查找的一致与精确
/**
 * Property 23 — Tag index & tool/tag lookups are consistent and exact.
 *
 * For any AgentRegistry `r`:
 *   - Consistency: for every tag `t` present in `r`, buildTagIndex(r).get(t)
 *     equals the set of ids returned by listByTag(r, t).
 *   - Exactness (tags): every definition in listByTag(r, t) has `t` in its tags,
 *     and every definition NOT in the result does NOT have `t`.
 *   - Exactness (tools): for every toolId present in `r`, every definition in
 *     findByTool(r, toolId) contains that toolId, and every other definition
 *     does not.
 *   - Randomly probed (possibly-absent) tags/toolIds yield consistent empties.
 *
 * Validates: Requirements 17.2, 17.4, 17.5
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { buildTagIndex, listByTag, findByTool, listAgents } from './registry';
import { arbitraryRegistry } from './arbitraries';

describe('Property 23: 标签索引与按工具/按标签查找的一致与精确', () => {
  it('buildTagIndex 与 listByTag 一致；按标签/按工具查找精确', () => {
    fc.assert(
      fc.property(arbitraryRegistry, fc.string(), fc.string(), (r, probeTag, probeTool) => {
        const all = listAgents(r);
        const index = buildTagIndex(r);

        // Collect all tags / toolIds actually present in the registry.
        const allTags = new Set<string>();
        const allToolIds = new Set<string>();
        for (const a of all) {
          for (const t of a.tags) allTags.add(t);
          for (const tb of a.tools) allToolIds.add(tb.toolId);
        }

        // —— Tag consistency + exactness (R17.2, R17.5) ——
        for (const t of allTags) {
          const byTag = listByTag(r, t);
          const byTagIds = new Set(byTag.map((a) => a.id));

          // Consistency: index set == listByTag id set.
          const indexSet = index.get(t);
          expect(indexSet).toBeDefined();
          expect(new Set(indexSet)).toStrictEqual(byTagIds);

          // Exactness: every result holds t; every non-result does not.
          for (const a of all) {
            if (byTagIds.has(a.id)) {
              expect(a.tags.includes(t)).toBe(true);
            } else {
              expect(a.tags.includes(t)).toBe(false);
            }
          }
        }

        // —— Tool exactness (R17.4) ——
        for (const toolId of allToolIds) {
          const byTool = findByTool(r, toolId);
          const byToolIds = new Set(byTool.map((a) => a.id));
          for (const a of all) {
            const has = a.tools.some((tb) => tb.toolId === toolId);
            if (byToolIds.has(a.id)) {
              expect(has).toBe(true);
            } else {
              expect(has).toBe(false);
            }
          }
        }

        // —— Random probes (tag/toolId possibly absent): consistency holds ——
        const probeByTag = listByTag(r, probeTag);
        const probeByTagIds = new Set(probeByTag.map((a) => a.id));
        const probeIndexSet = index.get(probeTag);
        // If the tag is absent the index has no entry and listByTag is empty;
        // otherwise the two id sets coincide.
        expect(new Set(probeIndexSet ?? [])).toStrictEqual(probeByTagIds);
        for (const a of all) {
          expect(probeByTagIds.has(a.id)).toBe(a.tags.includes(probeTag));
        }

        const probeByTool = findByTool(r, probeTool);
        const probeByToolIds = new Set(probeByTool.map((a) => a.id));
        for (const a of all) {
          expect(probeByToolIds.has(a.id)).toBe(
            a.tools.some((tb) => tb.toolId === probeTool)
          );
        }
      }),
      { numRuns: 100 }
    );
  });
});
