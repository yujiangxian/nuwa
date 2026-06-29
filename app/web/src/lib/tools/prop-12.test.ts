// Feature: agent-tool-system, Property 12: validateRegistry 重复 id 检测
/**
 * Property 12: duplicate-id detection in validateRegistry.
 *
 * For any ToolRegistry built from two or more ToolDefinition values holding the
 * same Tool_Id, validateRegistry produces a TOOL_DUPLICATE_ID error located at
 * that id.
 *
 * Validates: Requirements 10.3
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { validateRegistry } from './validate';
import { ToolErrorCode } from './types';
import { arbitraryDuplicateIdRegistryValues } from './arbitraries';

describe('Property 12: duplicate-id detection in validateRegistry', () => {
  it('reports TOOL_DUPLICATE_ID for every id held by two or more tools', () => {
    fc.assert(
      fc.property(arbitraryDuplicateIdRegistryValues, (r) => {
        // Count multiplicity of each stored tool's own `.id`.
        const counts = new Map<string, number>();
        for (const tool of r.tools.values()) {
          counts.set(tool.id, (counts.get(tool.id) ?? 0) + 1);
        }

        const { errors } = validateRegistry(r);
        const duplicateErrors = errors.filter(
          (e) => e.code === ToolErrorCode.TOOL_DUPLICATE_ID,
        );

        for (const [id, count] of counts) {
          if (count >= 2) {
            const match = duplicateErrors.find((e) => e.location.toolId === id);
            expect(match).toBeDefined();
          }
        }
        return true;
      }),
      { numRuns: 100 },
    );
  });
});
