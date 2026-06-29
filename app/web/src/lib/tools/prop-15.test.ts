// Feature: agent-tool-system, Property 15: normalizeTool 语义等价唯一且保持关键字段
import fc from 'fast-check';
import { describe, it, expect } from 'vitest';

import { normalizeTool, toolEquals } from './normalize';
import { portTypeEquals } from '../workflow/portType';
import { arbitraryToolDefinition, arbitraryReorderedTool } from './arbitraries';

/**
 * Validates: Requirements 12.4, 12.6
 *
 * For any ToolDefinition base and a version reordered only in tags/parameters
 * order, normalizeTool(base) and normalizeTool(reordered) are toolEquals
 * (semantic uniqueness). Also, normalizeTool(base) preserves the key fields
 * id/name/description and resultType (semantically) of base.
 */
describe('Property 15: normalizeTool 语义等价唯一且保持关键字段', () => {
  it('normalized forms of reorderings are equal and key fields are preserved', () => {
    fc.assert(
      fc.property(
        // The ParameterSchema invariant (R2.3 / R3.1) requires Param_Name to be
        // unique within a schema. Constrain the generated base to that valid
        // input space (dedupe parameter names, keeping first occurrence) so a
        // pure reordering is genuinely semantics-preserving; otherwise
        // normalizeTool's dedupe-by-first-occurrence would be order-sensitive.
        arbitraryToolDefinition
          .map((t) => {
            const seen = new Set<string>();
            const parameters = t.parameters.filter((p) => {
              if (seen.has(p.name)) return false;
              seen.add(p.name);
              return true;
            });
            return { ...t, parameters };
          })
          .chain((base) =>
            fc.tuple(fc.constant(base), arbitraryReorderedTool(base)),
          ),
        ([base, reordered]) => {
          // Semantic uniqueness: order of tags/parameters does not matter.
          expect(
            toolEquals(normalizeTool(base), normalizeTool(reordered)),
          ).toBe(true);

          // Key fields preserved by normalization.
          const normalized = normalizeTool(base);
          expect(normalized.id).toBe(base.id);
          expect(normalized.name).toBe(base.name);
          expect(normalized.description).toBe(base.description);
          expect(portTypeEquals(normalized.resultType, base.resultType)).toBe(
            true,
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});
