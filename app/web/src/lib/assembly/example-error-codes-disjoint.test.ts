// Feature: agent-conversation-assembly, Example: 八层错误码取值两两不相交
//
// Validates: Requirements 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8

import { describe, it, expect } from 'vitest';
import { AssemblyErrorCode } from './types';
import { ErrorCode } from '../workflow/types';
import { ConfigErrorCode } from '../workflow/nodeTypes/configTypes';
import { ExecutorErrorCode } from '../workflow/engine/types';
import { AgentErrorCode } from '../agents/types';
import { ToolErrorCode } from '../tools/types';
import { ResolutionErrorCode } from '../resolution/types';
import { MessageErrorCode } from '../messages/types';

const otherLayers: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['ErrorCode', Object.values(ErrorCode)],
  ['ConfigErrorCode', Object.values(ConfigErrorCode)],
  ['ExecutorErrorCode', Object.values(ExecutorErrorCode)],
  ['AgentErrorCode', Object.values(AgentErrorCode)],
  ['ToolErrorCode', Object.values(ToolErrorCode)],
  ['ResolutionErrorCode', Object.values(ResolutionErrorCode)],
  ['MessageErrorCode', Object.values(MessageErrorCode)],
];

describe('Example: AssemblyErrorCode 与其余七层取值不相交', () => {
  it('AssemblyErrorCode 与每一层的交集为空', () => {
    const assemblyValues = new Set<string>(Object.values(AssemblyErrorCode));
    for (const [name, values] of otherLayers) {
      const intersection = values.filter((v) => assemblyValues.has(v));
      expect(intersection, `与 ${name} 的交集应为空`).toEqual([]);
    }
  });
});
