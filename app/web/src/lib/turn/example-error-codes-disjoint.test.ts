// Feature: agent-turn-reducer, Example: 九层错误码取值两两不相交

import { describe, it, expect } from 'vitest';
import { TurnErrorCode } from './types';
import { ErrorCode } from '../workflow/types';
import { ConfigErrorCode } from '../workflow/nodeTypes/configTypes';
import { ExecutorErrorCode } from '../workflow/engine/types';
import { AgentErrorCode } from '../agents/types';
import { ToolErrorCode } from '../tools/types';
import { ResolutionErrorCode } from '../resolution/types';
import { MessageErrorCode } from '../messages/types';
import { AssemblyErrorCode } from '../assembly/types';

/**
 * Example: the turn layer's error-code values are disjoint from each of the
 * eight prior layers' enums (pairwise empty intersection).
 *
 * Validates: Requirements 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9
 */
describe('Example: 九层错误码取值两两不相交', () => {
  const turnValues = new Set<string>(Object.values(TurnErrorCode));

  const others: ReadonlyArray<readonly [string, Record<string, string>]> = [
    ['ErrorCode', ErrorCode],
    ['ConfigErrorCode', ConfigErrorCode],
    ['ExecutorErrorCode', ExecutorErrorCode],
    ['AgentErrorCode', AgentErrorCode],
    ['ToolErrorCode', ToolErrorCode],
    ['ResolutionErrorCode', ResolutionErrorCode],
    ['MessageErrorCode', MessageErrorCode],
    ['AssemblyErrorCode', AssemblyErrorCode],
  ];

  it('TurnErrorCode 取值与其余八层两两交集为空', () => {
    for (const [name, layer] of others) {
      const overlap = Object.values(layer).filter((v) => turnValues.has(v));
      expect(overlap, `TurnErrorCode 与 ${name} 存在重叠取值: ${overlap.join(', ')}`).toEqual([]);
    }
  });
});
