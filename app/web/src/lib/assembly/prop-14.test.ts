// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-conversation-assembly, Property 14: 错误码跨层互斥
//
// 对任意 AssemblyErrorCode 取值 c，c 不出现于 ErrorCode、ConfigErrorCode、
// ExecutorErrorCode、AgentErrorCode、ToolErrorCode、ResolutionErrorCode、
// MessageErrorCode 任一取值集合（八层错误码两两不相交）。
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

describe('Property 14: 错误码跨层互斥', () => {
  it('AssemblyErrorCode 与其余七层错误码两两不相交', () => {
    const assemblyValues = new Set<string>(Object.values(AssemblyErrorCode));

    const otherLayers: Record<string, readonly string[]> = {
      ErrorCode: Object.values(ErrorCode),
      ConfigErrorCode: Object.values(ConfigErrorCode),
      ExecutorErrorCode: Object.values(ExecutorErrorCode),
      AgentErrorCode: Object.values(AgentErrorCode),
      ToolErrorCode: Object.values(ToolErrorCode),
      ResolutionErrorCode: Object.values(ResolutionErrorCode),
      MessageErrorCode: Object.values(MessageErrorCode),
    };

    for (const [layerName, values] of Object.entries(otherLayers)) {
      const intersection = values.filter((v) => assemblyValues.has(v));
      expect(
        intersection,
        `AssemblyErrorCode 与 ${layerName} 存在交集: ${intersection.join(', ')}`,
      ).toEqual([]);
    }
  });
});
