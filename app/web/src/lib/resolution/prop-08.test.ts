// Feature: agent-tool-resolution, Property 8: 工具节点——工具缺失短路
/**
 * Property 8 (Validates: Requirements 6.2):
 * For any ToolConfig `c` and tool registry `r`, IF getTool(r, c.toolName) is
 * undefined THEN resolveToolNodeArguments(c, r) returns valid=false with exactly
 * one RESOLUTION_TOOL_NOT_FOUND error locating c.toolName.
 */

import fc from 'fast-check';
import { describe, it, expect } from 'vitest';

import type { ToolConfig, ArgumentBinding } from '../workflow/nodeTypes/configTypes';
import { resolveToolNodeArguments } from './validate';
import { ResolutionErrorCode } from './types';
import { getTool } from '../tools/registry';
import { arbitraryToolRegistry, arbitraryPortType } from './arbitraries';

const arbitraryArgumentBinding: fc.Arbitrary<ArgumentBinding> = fc
  .tuple(fc.string({ minLength: 1 }), fc.string({ minLength: 1 }), arbitraryPortType)
  .map(([portId, argName, portType]) => ({ portId, argName, portType }));

// A ToolRegistry paired with a ToolConfig whose toolName is guaranteed absent.
const arbitraryRegistryAndMissingToolConfig = arbitraryToolRegistry.chain((toolRegistry) =>
  fc
    .tuple(
      fc.string({ minLength: 1 }).filter((name) => getTool(toolRegistry, name) === undefined),
      fc.array(arbitraryArgumentBinding, { maxLength: 5 }),
    )
    .map(([toolName, argumentBindings]) => ({
      toolRegistry,
      toolConfig: { kind: 'tool' as const, toolName, argumentBindings } satisfies ToolConfig,
    })),
);

describe('Property 8: tool node — missing tool short-circuits', () => {
  it('returns a single RESOLUTION_TOOL_NOT_FOUND locating the toolName', () => {
    fc.assert(
      fc.property(arbitraryRegistryAndMissingToolConfig, ({ toolRegistry, toolConfig }) => {
        const result = resolveToolNodeArguments(toolConfig, toolRegistry);

        expect(result.valid).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].code).toBe(ResolutionErrorCode.RESOLUTION_TOOL_NOT_FOUND);
        expect(result.errors[0].location.toolName).toBe(toolConfig.toolName);
      }),
      { numRuns: 100 },
    );
  });
});
