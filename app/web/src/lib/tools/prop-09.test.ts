// Feature: agent-tool-system, Property 9: validateTool 逐类违规检测
/**
 * Property 9: per-category violation detection in validateTool.
 *
 * Starting from a valid ToolDefinition base, injecting any single violation
 * makes validateTool produce the matching ToolErrorCode at the right location:
 *   empty id            -> TOOL_EMPTY_ID            (field = 'id')
 *   empty name          -> TOOL_EMPTY_NAME          (field = 'name')
 *   empty Param_Name    -> TOOL_EMPTY_PARAM_NAME
 *   duplicate Param_Name-> TOOL_DUPLICATE_PARAM     (paramName = 'p')
 *   empty Tag           -> TOOL_EMPTY_TAG
 *
 * Validates: Requirements 9.2, 9.3, 9.4, 9.5, 9.6
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { validateTool } from './validate';
import { ToolErrorCode } from './types';
import type { ToolDefinition, ToolError } from './types';
import { arbitraryValidToolDefinition } from './arbitraries';

function findByCode(
  errors: readonly ToolError[],
  code: ToolErrorCode,
): ToolError | undefined {
  return errors.find((e) => e.code === code);
}

describe('Property 9: per-category violation detection in validateTool', () => {
  it('detects each single injected violation with the correct code and location', () => {
    fc.assert(
      fc.property(arbitraryValidToolDefinition, (base) => {
        // Empty id -> TOOL_EMPTY_ID (field = 'id').
        {
          const tool: ToolDefinition = { ...base, id: '' };
          const err = findByCode(validateTool(tool).errors, ToolErrorCode.TOOL_EMPTY_ID);
          expect(err).toBeDefined();
          expect(err!.location.field).toBe('id');
        }

        // Empty name -> TOOL_EMPTY_NAME (field = 'name').
        {
          const tool: ToolDefinition = { ...base, name: '' };
          const err = findByCode(validateTool(tool).errors, ToolErrorCode.TOOL_EMPTY_NAME);
          expect(err).toBeDefined();
          expect(err!.location.field).toBe('name');
        }

        // Empty Param_Name -> TOOL_EMPTY_PARAM_NAME.
        {
          const tool: ToolDefinition = {
            ...base,
            parameters: [{ name: '', type: base.resultType, required: false }],
          };
          const err = findByCode(
            validateTool(tool).errors,
            ToolErrorCode.TOOL_EMPTY_PARAM_NAME,
          );
          expect(err).toBeDefined();
          expect(err!.location.paramName).toBe('');
        }

        // Duplicate Param_Name -> TOOL_DUPLICATE_PARAM (paramName = 'p').
        {
          const tool: ToolDefinition = {
            ...base,
            parameters: [
              { name: 'p', type: base.resultType, required: false },
              { name: 'p', type: base.resultType, required: true },
            ],
          };
          const err = findByCode(
            validateTool(tool).errors,
            ToolErrorCode.TOOL_DUPLICATE_PARAM,
          );
          expect(err).toBeDefined();
          expect(err!.location.paramName).toBe('p');
        }

        // Empty Tag -> TOOL_EMPTY_TAG.
        {
          const tool: ToolDefinition = { ...base, tags: [''] };
          const err = findByCode(validateTool(tool).errors, ToolErrorCode.TOOL_EMPTY_TAG);
          expect(err).toBeDefined();
          expect(err!.location.tag).toBe('');
        }

        return true;
      }),
      { numRuns: 100 },
    );
  });
});
