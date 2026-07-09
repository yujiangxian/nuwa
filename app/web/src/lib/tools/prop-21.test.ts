// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-tool-system, Property 21: validateArguments 完整报告与确定性
import fc from 'fast-check';
import { describe, it, expect } from 'vitest';

import { validateArguments } from './validate';
import { ToolErrorCode } from './types';
import type { ToolDefinition, ArgumentMap } from './types';
import type { PortType } from '../workflow/types';
import { T_STRING, T_NUMBER } from '../workflow/portType';
import { arbitraryValidToolDefinition } from './arbitraries';

/** Produce a Param_Name deterministically absent from `used` by appending '_'. */
function freshName(used: Set<string>, seed: string): string {
  let n = seed.length > 0 ? seed : 'p';
  while (used.has(n)) n += '_';
  used.add(n);
  return n;
}

/**
 * Validates: Requirements 14.6
 *
 * For an input that simultaneously contains a missing-required violation, an
 * unknown argument, and a type mismatch, validateArguments reports all three
 * error codes (no short-circuiting), and two invocations return equal results.
 */
describe('Property 21: validateArguments 完整报告与确定性', () => {
  it('reports all three violation classes and is deterministic', () => {
    fc.assert(
      fc.property(arbitraryValidToolDefinition, fc.string(), (base, seed) => {
        const used = new Set(base.parameters.map((p) => p.name));
        const reqName = freshName(used, `req_${seed}`); // required, will be omitted -> missing
        const mmName = freshName(used, `mm_${seed}`); // number param, supplied a string -> mismatch
        const unknownKey = freshName(used, `unknown_${seed}`); // not a parameter -> unknown

        const tool: ToolDefinition = {
          ...base,
          parameters: [
            ...base.parameters,
            { name: reqName, type: T_NUMBER, required: true },
            { name: mmName, type: T_NUMBER, required: false },
          ],
        };

        // Omit reqName (missing required), supply mmName as string (mismatch),
        // supply unknownKey (unknown argument).
        const argumentMap = new Map<string, PortType>([
          [mmName, T_STRING],
          [unknownKey, T_STRING],
        ]) as ArgumentMap;

        const res = validateArguments(tool, argumentMap);
        const codes = new Set(res.errors.map((e) => e.code));

        expect(codes.has(ToolErrorCode.TOOL_MISSING_REQUIRED_ARGUMENT)).toBe(true);
        expect(codes.has(ToolErrorCode.TOOL_UNKNOWN_ARGUMENT)).toBe(true);
        expect(codes.has(ToolErrorCode.TOOL_ARGUMENT_TYPE_MISMATCH)).toBe(true);

        // Determinism: a second invocation yields an equal result.
        const res2 = validateArguments(tool, argumentMap);
        expect(res2).toEqual(res);
      }),
      { numRuns: 100 },
    );
  });
});
