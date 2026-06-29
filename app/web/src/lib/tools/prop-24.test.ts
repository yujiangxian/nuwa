// Feature: agent-tool-system, Property 24: 错误码跨层互斥
/**
 * Property 24 (R11.2–R11.5): the `ToolErrorCode` value set must be disjoint
 * from each of the four prior layers' error-code enumerations. We assert
 * pairwise empty intersections across all five layers so that errors from any
 * two layers can be aggregated without code collision.
 */

import { describe, it, expect } from 'vitest';
import { ToolErrorCode } from './types';
import { ErrorCode } from '../workflow/types';
import { ConfigErrorCode } from '../workflow/nodeTypes/configTypes';
import { ExecutorErrorCode } from '../workflow/engine/types';
import { AgentErrorCode } from '../agents/types';

const LAYERS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['ToolErrorCode', Object.values(ToolErrorCode)],
  ['ErrorCode', Object.values(ErrorCode)],
  ['ConfigErrorCode', Object.values(ConfigErrorCode)],
  ['ExecutorErrorCode', Object.values(ExecutorErrorCode)],
  ['AgentErrorCode', Object.values(AgentErrorCode)],
];

function intersection(a: readonly string[], b: readonly string[]): string[] {
  const setB = new Set(b);
  return a.filter((v) => setB.has(v));
}

describe('Property 24: 错误码跨层互斥', () => {
  it('ToolErrorCode is pairwise disjoint from the four prior layers', () => {
    const tool = Object.values(ToolErrorCode);
    expect(intersection(tool, Object.values(ErrorCode))).toEqual([]);
    expect(intersection(tool, Object.values(ConfigErrorCode))).toEqual([]);
    expect(intersection(tool, Object.values(ExecutorErrorCode))).toEqual([]);
    expect(intersection(tool, Object.values(AgentErrorCode))).toEqual([]);
  });

  it('every pair of the five layers has an empty value-set intersection', () => {
    for (let i = 0; i < LAYERS.length; i++) {
      for (let j = i + 1; j < LAYERS.length; j++) {
        const [nameA, valuesA] = LAYERS[i];
        const [nameB, valuesB] = LAYERS[j];
        const shared = intersection(valuesA, valuesB);
        expect(
          shared,
          `${nameA} and ${nameB} share code(s): ${shared.join(', ')}`,
        ).toEqual([]);
      }
    }
  });
});
