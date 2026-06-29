// Feature: agent-tool-system, Example: validateArguments 四种代表性情形
/**
 * Example & boundary test (R14.2–R14.5): on a concrete tool with one required
 * string parameter `q` and one optional number parameter `n`, exercise the
 * four representative argument bindings — missing required, unknown argument,
 * type mismatch, and a passing binding.
 */

import { describe, it, expect } from 'vitest';
import { validateArguments } from './validate';
import { ToolErrorCode } from './types';
import type { ToolDefinition, ArgumentMap } from './types';
import { T_STRING, T_NUMBER } from '../workflow/portType';

const tool: ToolDefinition = {
  id: 'search',
  name: 'Search',
  description: '',
  parameters: [
    { name: 'q', type: T_STRING, required: true },
    { name: 'n', type: T_NUMBER, required: false },
  ],
  resultType: T_STRING,
  tags: [],
};

describe('Example: validateArguments', () => {
  it('missing required argument → TOOL_MISSING_REQUIRED_ARGUMENT at "q"', () => {
    const args: ArgumentMap = new Map();
    const result = validateArguments(tool, args);
    expect(result.valid).toBe(false);
    const missing = result.errors.filter(
      (e) => e.code === ToolErrorCode.TOOL_MISSING_REQUIRED_ARGUMENT,
    );
    expect(missing).toHaveLength(1);
    expect(missing[0].location.paramName).toBe('q');
  });

  it('unknown argument → TOOL_UNKNOWN_ARGUMENT at "x" (and still missing "q")', () => {
    const args: ArgumentMap = new Map([['x', T_STRING]]);
    const result = validateArguments(tool, args);
    expect(result.valid).toBe(false);

    const unknown = result.errors.filter(
      (e) => e.code === ToolErrorCode.TOOL_UNKNOWN_ARGUMENT,
    );
    expect(unknown).toHaveLength(1);
    expect(unknown[0].location.paramName).toBe('x');

    const missing = result.errors.filter(
      (e) => e.code === ToolErrorCode.TOOL_MISSING_REQUIRED_ARGUMENT,
    );
    expect(missing).toHaveLength(1);
    expect(missing[0].location.paramName).toBe('q');
  });

  it('type mismatch → TOOL_ARGUMENT_TYPE_MISMATCH at "q" (number not assignable to string)', () => {
    const args: ArgumentMap = new Map([['q', T_NUMBER]]);
    const result = validateArguments(tool, args);
    expect(result.valid).toBe(false);
    const mismatch = result.errors.filter(
      (e) => e.code === ToolErrorCode.TOOL_ARGUMENT_TYPE_MISMATCH,
    );
    expect(mismatch).toHaveLength(1);
    expect(mismatch[0].location.paramName).toBe('q');
  });

  it('valid binding → valid === true with no errors', () => {
    const args: ArgumentMap = new Map([['q', T_STRING]]);
    const result = validateArguments(tool, args);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});
