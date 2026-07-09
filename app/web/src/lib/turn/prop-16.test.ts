// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-turn-reducer, Property 16: 错误码跨层互斥

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

// Validates: Requirements 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9
describe('Property 16: 错误码跨层互斥', () => {
  it('TurnErrorCode 的取值与其余八层错误码取值两两交集为空', () => {
    const turnValues = new Set<string>(Object.values(TurnErrorCode));

    const otherLayers: ReadonlyArray<readonly [string, Record<string, string>]> = [
      ['ErrorCode', ErrorCode as unknown as Record<string, string>],
      ['ConfigErrorCode', ConfigErrorCode as unknown as Record<string, string>],
      ['ExecutorErrorCode', ExecutorErrorCode as unknown as Record<string, string>],
      ['AgentErrorCode', AgentErrorCode as unknown as Record<string, string>],
      ['ToolErrorCode', ToolErrorCode as unknown as Record<string, string>],
      ['ResolutionErrorCode', ResolutionErrorCode as unknown as Record<string, string>],
      ['MessageErrorCode', MessageErrorCode as unknown as Record<string, string>],
      ['AssemblyErrorCode', AssemblyErrorCode as unknown as Record<string, string>],
    ];

    for (const [name, layerEnum] of otherLayers) {
      const intersection = Object.values(layerEnum).filter((v) => turnValues.has(v));
      expect(intersection, `TurnErrorCode 与 ${name} 不应有交集`).toEqual([]);
    }
  });
});
