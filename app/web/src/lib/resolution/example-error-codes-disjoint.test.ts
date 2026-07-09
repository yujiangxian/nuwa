// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-tool-resolution, Example: 六层错误码取值两两不相交
/**
 * Example test asserting that the ResolutionErrorCode value set is disjoint
 * from each of the five prior-layer error-code enums (pairwise empty
 * intersection), landing Property 17 as a concrete check.
 *
 * **Validates: Requirements 7.2, 7.3, 7.4, 7.5, 7.6**
 */

import { describe, it, expect } from 'vitest';

import { ResolutionErrorCode } from './types';
import { ErrorCode } from '../workflow/types';
import { ConfigErrorCode } from '../workflow/nodeTypes/configTypes';
import { ExecutorErrorCode } from '../workflow/engine/types';
import { AgentErrorCode } from '../agents/types';
import { ToolErrorCode } from '../tools/types';

/** Compute the intersection of two string-value sets. */
function intersection(a: readonly string[], b: readonly string[]): string[] {
  const bSet = new Set(b);
  return a.filter((v) => bSet.has(v));
}

describe('Example: 六层错误码取值两两不相交', () => {
  const resolution = Object.values(ResolutionErrorCode);
  const others: ReadonlyArray<readonly [string, readonly string[]]> = [
    ['ErrorCode', Object.values(ErrorCode)],
    ['ConfigErrorCode', Object.values(ConfigErrorCode)],
    ['ExecutorErrorCode', Object.values(ExecutorErrorCode)],
    ['AgentErrorCode', Object.values(AgentErrorCode)],
    ['ToolErrorCode', Object.values(ToolErrorCode)],
  ];

  it('ResolutionErrorCode 与其余五层取值集合两两交集为空', () => {
    for (const [name, values] of others) {
      const overlap = intersection(resolution, values);
      expect(overlap, `ResolutionErrorCode 与 ${name} 存在重叠取值`).toEqual([]);
    }
  });
});
