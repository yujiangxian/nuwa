// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-tool-system, Property 19: validateArguments 缺必需/未知/类型不匹配检测
import fc from 'fast-check';
import { describe, it, expect } from 'vitest';

import { validateArguments } from './validate';
import { ToolErrorCode } from './types';
import type { ToolDefinition, ArgumentMap } from './types';
import type { PortType } from '../workflow/types';
import { T_STRING, T_NUMBER } from '../workflow/portType';
import { arbitraryValidToolDefinition } from './arbitraries';

/** Produce a Param_Name deterministically absent from `used` by appending '_'. */
function freshName(used: ReadonlySet<string>, seed: string): string {
  let n = seed.length > 0 ? seed : 'p';
  while (used.has(n)) n += '_';
  return n;
}

/**
 * Validates: Requirements 14.2, 14.3, 14.4
 *
 * For any tool definition: omitting a required parameter yields
 * TOOL_MISSING_REQUIRED_ARGUMENT locating that Param_Name; an unknown argument
 * name yields TOOL_UNKNOWN_ARGUMENT locating that name; and a same-named
 * argument whose type is not assignable to the parameter type yields
 * TOOL_ARGUMENT_TYPE_MISMATCH locating that name. T_STRING is not assignable to
 * T_NUMBER, giving a robust type-mismatch trigger.
 */
describe('Property 19: validateArguments 缺必需/未知/类型不匹配检测', () => {
  it('detects missing-required, unknown, and type-mismatch with correct locations', () => {
    fc.assert(
      fc.property(arbitraryValidToolDefinition, fc.string(), (base, seed) => {
        const used = new Set(base.parameters.map((p) => p.name));

        // (A) Missing required: append a guaranteed required parameter, then
        // validate against an empty argument map.
        const reqName = freshName(used, `req_${seed}`);
        const toolA: ToolDefinition = {
          ...base,
          parameters: [...base.parameters, { name: reqName, type: T_NUMBER, required: true }],
        };
        const resA = validateArguments(toolA, new Map() as ArgumentMap);
        expect(
          resA.errors.some(
            (e) =>
              e.code === ToolErrorCode.TOOL_MISSING_REQUIRED_ARGUMENT &&
              e.location.paramName === reqName,
          ),
        ).toBe(true);

        // (B) Unknown argument: a key that is not any declared parameter name.
        const unknownKey = freshName(used, `unknown_${seed}`);
        const resB = validateArguments(
          base,
          new Map<string, PortType>([[unknownKey, T_STRING]]) as ArgumentMap,
        );
        expect(
          resB.errors.some(
            (e) =>
              e.code === ToolErrorCode.TOOL_UNKNOWN_ARGUMENT &&
              e.location.paramName === unknownKey,
          ),
        ).toBe(true);

        // (C) Type mismatch: declare a number parameter and supply a string,
        // which is not assignable to number.
        const mmName = freshName(used, `mm_${seed}`);
        const toolC: ToolDefinition = {
          ...base,
          parameters: [...base.parameters, { name: mmName, type: T_NUMBER, required: false }],
        };
        const resC = validateArguments(
          toolC,
          new Map<string, PortType>([[mmName, T_STRING]]) as ArgumentMap,
        );
        expect(
          resC.errors.some(
            (e) =>
              e.code === ToolErrorCode.TOOL_ARGUMENT_TYPE_MISMATCH &&
              e.location.paramName === mmName,
          ),
        ).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
