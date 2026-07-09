// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-tool-resolution, Property 9: 工具节点——重复 argName 检测
/**
 * Property 9 (Validates: Requirements 6.6):
 * For any ToolConfig `c` (whose toolName exists in `r`) carrying a duplicate
 * argName, resolveToolNodeArguments(c, r) includes one
 * RESOLUTION_DUPLICATE_ARGUMENT error locating that argName.
 */

import fc from 'fast-check';
import { describe, it, expect } from 'vitest';

import type { ToolConfig, ArgumentBinding } from '../workflow/nodeTypes/configTypes';
import type { ToolDefinition, ToolRegistry } from '../tools/types';
import { resolveToolNodeArguments } from './validate';
import { ResolutionErrorCode } from './types';
import {
  arbitraryValidToolDefinition,
  arbitraryPortType,
} from './arbitraries';

// A tool guaranteed to have at least one parameter, in a single-tool registry,
// paired with a ToolConfig that binds the first parameter's name twice.
const arbitraryToolAndDuplicateConfig = arbitraryValidToolDefinition
  .filter((t) => t.parameters.length > 0)
  .chain((tool: ToolDefinition) =>
    fc
      .tuple(
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        arbitraryPortType,
        arbitraryPortType,
      )
      .map(([portIdA, portIdB, typeA, typeB]) => {
        const argName = tool.parameters[0].name;
        const bindings: ArgumentBinding[] = [
          { portId: portIdA, argName, portType: typeA },
          { portId: portIdB, argName, portType: typeB },
        ];
        const registry: ToolRegistry = { tools: new Map([[tool.id, tool]]) };
        const toolConfig: ToolConfig = {
          kind: 'tool',
          toolName: tool.id,
          argumentBindings: bindings,
        };
        return { registry, toolConfig, argName };
      }),
  );

describe('Property 9: tool node — duplicate argName detection', () => {
  it('reports RESOLUTION_DUPLICATE_ARGUMENT locating the duplicated argName', () => {
    fc.assert(
      fc.property(arbitraryToolAndDuplicateConfig, ({ registry, toolConfig, argName }) => {
        const result = resolveToolNodeArguments(toolConfig, registry);

        const dupErrors = result.errors.filter(
          (e) => e.code === ResolutionErrorCode.RESOLUTION_DUPLICATE_ARGUMENT,
        );
        expect(dupErrors).toHaveLength(1);
        expect(dupErrors[0].location.paramName).toBe(argName);
      }),
      { numRuns: 100 },
    );
  });
});
