// Feature: agent-definition-registry, Property 24: 错误码跨层互斥
/**
 * Property 24 — Cross-layer error-code disjointness.
 *
 * The four layers of the workflow orchestration engine each own an error-code
 * enum. This layer's AgentErrorCode value set must be pairwise disjoint from
 * the value sets of the three prior layers:
 *   - base layer       : ErrorCode          (../workflow/types)
 *   - config layer     : ConfigErrorCode    (../workflow/nodeTypes/configTypes)
 *   - execution layer  : ExecutorErrorCode  (../workflow/engine/types)
 *
 * This is a deterministic set assertion (no random inputs), so it uses a plain
 * `it` rather than fc.property, but lives in prop-24.test.ts per the plan.
 *
 * Validates: Requirements 12.2, 12.3, 12.4
 */

import { describe, it, expect } from 'vitest';
import { AgentErrorCode } from './types';
import { ErrorCode } from '../workflow/types';
import { ConfigErrorCode } from '../workflow/nodeTypes/configTypes';
import { ExecutorErrorCode } from '../workflow/engine/types';

/** Compute the intersection of two string-value sets. */
function intersect(a: readonly string[], b: readonly string[]): string[] {
  const setB = new Set(b);
  return a.filter((v) => setB.has(v));
}

describe('Property 24: 错误码跨层互斥', () => {
  const agentValues = Object.values(AgentErrorCode) as string[];
  const baseValues = Object.values(ErrorCode) as string[];
  const configValues = Object.values(ConfigErrorCode) as string[];
  const executorValues = Object.values(ExecutorErrorCode) as string[];

  it('AgentErrorCode 与基础层 ErrorCode 取值集合不相交 (R12.2)', () => {
    expect(intersect(agentValues, baseValues)).toStrictEqual([]);
  });

  it('AgentErrorCode 与配置层 ConfigErrorCode 取值集合不相交 (R12.3)', () => {
    expect(intersect(agentValues, configValues)).toStrictEqual([]);
  });

  it('AgentErrorCode 与执行层 ExecutorErrorCode 取值集合不相交 (R12.4)', () => {
    expect(intersect(agentValues, executorValues)).toStrictEqual([]);
  });
});
