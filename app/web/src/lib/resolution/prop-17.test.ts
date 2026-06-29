// Feature: agent-tool-resolution, Property 17: 错误码跨层互斥
/**
 * Property 17: Every ResolutionErrorCode value is disjoint from each of the
 * five prior-layer error-code enums (ErrorCode, ConfigErrorCode,
 * ExecutorErrorCode, AgentErrorCode, ToolErrorCode) — the six layers' code sets
 * are pairwise disjoint.
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

describe('Property 17: 错误码跨层互斥', () => {
  it('ResolutionErrorCode 取值与其余五层枚举两两交集为空', () => {
    const resolutionValues = new Set<string>(Object.values(ResolutionErrorCode));

    const otherLayers: Record<string, readonly string[]> = {
      ErrorCode: Object.values(ErrorCode),
      ConfigErrorCode: Object.values(ConfigErrorCode),
      ExecutorErrorCode: Object.values(ExecutorErrorCode),
      AgentErrorCode: Object.values(AgentErrorCode),
      ToolErrorCode: Object.values(ToolErrorCode),
    };

    for (const [, values] of Object.entries(otherLayers)) {
      for (const v of values) {
        expect(resolutionValues.has(v)).toBe(false);
      }
    }
  });
});
