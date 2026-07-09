// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-tool-resolution, Example: 工具节点实参解析四种代表性例
/**
 * Example tests for resolveToolNodeArguments covering four representative
 * ToolConfig cases against a registry holding one tool: missing tool,
 * duplicate argName, type mismatch, and a passing binding.
 *
 * **Validates: Requirements 6.2, 6.3, 6.5, 6.6**
 */

import { describe, it, expect } from 'vitest';

import { resolveToolNodeArguments } from './validate';
import { ResolutionErrorCode } from './types';
import type { ToolDefinition, ToolRegistry } from '../tools/types';
import type { ToolConfig } from '../workflow/nodeTypes/configTypes';
import { T_STRING, T_NUMBER } from '../workflow/portType';

/** Tool `search` with one required string param `q` and one optional number `n`. */
const searchTool: ToolDefinition = {
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

const reg: ToolRegistry = { tools: new Map([['search', searchTool]]) };

describe('Example: 工具节点实参解析四种代表性例', () => {
  it('工具缺失：返回 valid=false，含 RESOLUTION_TOOL_NOT_FOUND 且定位 toolName', () => {
    const config: ToolConfig = {
      kind: 'tool',
      toolName: 'missing',
      argumentBindings: [],
    };
    const result = resolveToolNodeArguments(config, reg);
    expect(result.valid).toBe(false);
    const notFound = result.errors.filter(
      (e) => e.code === ResolutionErrorCode.RESOLUTION_TOOL_NOT_FOUND,
    );
    expect(notFound.length).toBeGreaterThanOrEqual(1);
    expect(notFound[0].location.toolName).toBe('missing');
  });

  it('重复 argName：含 RESOLUTION_DUPLICATE_ARGUMENT 且定位 paramName=q', () => {
    const config: ToolConfig = {
      kind: 'tool',
      toolName: 'search',
      argumentBindings: [
        { portId: 'p1', argName: 'q', portType: T_STRING },
        { portId: 'p2', argName: 'q', portType: T_STRING },
      ],
    };
    const result = resolveToolNodeArguments(config, reg);
    expect(result.valid).toBe(false);
    const dup = result.errors.filter(
      (e) => e.code === ResolutionErrorCode.RESOLUTION_DUPLICATE_ARGUMENT,
    );
    expect(dup.length).toBeGreaterThanOrEqual(1);
    expect(dup.some((e) => e.location.paramName === 'q')).toBe(true);
  });

  it('类型不匹配：number 不可赋值给 string，含 RESOLUTION_ARGUMENT_INVALID 且定位 paramName=q', () => {
    const config: ToolConfig = {
      kind: 'tool',
      toolName: 'search',
      argumentBindings: [{ portId: 'p1', argName: 'q', portType: T_NUMBER }],
    };
    const result = resolveToolNodeArguments(config, reg);
    expect(result.valid).toBe(false);
    const invalid = result.errors.filter(
      (e) => e.code === ResolutionErrorCode.RESOLUTION_ARGUMENT_INVALID,
    );
    expect(invalid.length).toBeGreaterThanOrEqual(1);
    expect(invalid.some((e) => e.location.paramName === 'q')).toBe(true);
  });

  it('通过：提供必需 q（string）、省略可选 n，返回 valid=true 且无错误', () => {
    const config: ToolConfig = {
      kind: 'tool',
      toolName: 'search',
      argumentBindings: [{ portId: 'p1', argName: 'q', portType: T_STRING }],
    };
    const result = resolveToolNodeArguments(config, reg);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});
