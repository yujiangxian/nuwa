// Feature: agent-tool-resolution, Property 10: 工具节点——实参校验镜像 validateArguments
/**
 * Property 10 (Validates: Requirements 6.3, 6.4, 6.5):
 * For any ToolConfig `c` whose toolName exists in `r` and whose argNames are
 * pairwise distinct, let t = getTool(r, c.toolName) and m the Argument_Map
 * projected from its argumentBindings. Then
 * resolveToolNodeArguments(c, r).valid === validateArguments(t, m).valid, and
 * the paramName set of its RESOLUTION_ARGUMENT_INVALID errors equals the
 * paramName set of validateArguments(t, m).errors.
 */

import fc from 'fast-check';
import { describe, it, expect } from 'vitest';

import type { ToolConfig, ArgumentBinding } from '../workflow/nodeTypes/configTypes';
import type { ToolDefinition, ToolRegistry, ArgumentMap } from '../tools/types';
import type { PortType } from '../workflow/types';
import { resolveToolNodeArguments } from './validate';
import { ResolutionErrorCode } from './types';
import { validateArguments } from '../tools/validate';
import { arbitraryValidToolDefinition, arbitraryPortType } from './arbitraries';

// A tool in a single-tool registry paired with a ToolConfig whose argNames are a
// subset of the tool's (unique) parameter names — hence pairwise distinct — with
// possibly type-mismatched portTypes (exercises pass / missing-required /
// type-mismatch branches).
const arbitraryToolAndDistinctConfig = arbitraryValidToolDefinition.chain(
  (tool: ToolDefinition) => {
    const perParam: fc.Arbitrary<ArgumentBinding[]>[] = tool.parameters.map((p) =>
      fc.oneof(
        fc.constant<ArgumentBinding[]>([]),
        fc
          .tuple(fc.string({ minLength: 1 }), arbitraryPortType)
          .map<ArgumentBinding[]>(([portId, portType]) => [
            { portId, argName: p.name, portType },
          ]),
      ),
    );
    return fc.tuple(...perParam).map((groups) => {
      const argumentBindings: ArgumentBinding[] = [];
      for (const group of groups) for (const b of group) argumentBindings.push(b);
      const registry: ToolRegistry = { tools: new Map([[tool.id, tool]]) };
      const toolConfig: ToolConfig = {
        kind: 'tool',
        toolName: tool.id,
        argumentBindings,
      };
      return { tool, registry, toolConfig };
    });
  },
);

describe('Property 10: tool node — argument validation mirrors validateArguments', () => {
  it('mirrors valid and the invalid-paramName set of validateArguments', () => {
    fc.assert(
      fc.property(arbitraryToolAndDistinctConfig, ({ tool, registry, toolConfig }) => {
        // Project the Argument_Map (first occurrence wins; argNames are distinct here).
        const argMap = new Map<string, PortType>();
        for (const b of toolConfig.argumentBindings) {
          if (!argMap.has(b.argName)) argMap.set(b.argName, b.portType);
        }

        const result = resolveToolNodeArguments(toolConfig, registry);
        const direct = validateArguments(tool, argMap as ArgumentMap);

        expect(result.valid).toBe(direct.valid);

        const resolutionParamNames = new Set(
          result.errors
            .filter((e) => e.code === ResolutionErrorCode.RESOLUTION_ARGUMENT_INVALID)
            .map((e) => e.location.paramName),
        );
        const directParamNames = new Set(direct.errors.map((e) => e.location.paramName));
        expect(resolutionParamNames).toEqual(directParamNames);
      }),
      { numRuns: 100 },
    );
  });
});
