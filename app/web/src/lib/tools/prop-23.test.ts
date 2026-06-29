// Feature: agent-tool-system, Property 23: 标签索引与按标签查找的一致与精确
import fc from 'fast-check';
import { describe, it, expect } from 'vitest';

import { buildToolIndex, listByTag, listTools } from './registry';
import { arbitraryRegistry } from './arbitraries';

/**
 * Validates: Requirements 16.2, 16.3, 16.4
 *
 * For any registry and any Tag t, the Tool_Id set stored under t in
 * buildToolIndex equals the Tool_Id set of listByTag(r, t); every tool returned
 * by listByTag carries t, and every other tool does not.
 */
describe('Property 23: 标签索引与按标签查找的一致与精确', () => {
  it('tag index and listByTag agree, and listByTag is exact', () => {
    fc.assert(
      fc.property(arbitraryRegistry, (r) => {
        const index = buildToolIndex(r);
        const all = listTools(r);

        // Collect every tag appearing in the registry.
        const tags = new Set<string>();
        for (const tool of all) {
          for (const tag of tool.tags) {
            tags.add(tag);
          }
        }

        for (const tag of tags) {
          const indexSet = new Set(index.get(tag) ?? new Set<string>());
          const byTag = listByTag(r, tag);
          const byTagIds = new Set(byTag.map((x) => x.id));

          // Index set equals listByTag id set.
          expect(indexSet).toEqual(byTagIds);

          // Every result carries the tag.
          for (const def of byTag) {
            expect(def.tags.includes(tag)).toBe(true);
          }

          // Every non-result does not carry the tag.
          for (const def of all) {
            if (!byTagIds.has(def.id)) {
              expect(def.tags.includes(tag)).toBe(false);
            }
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});
