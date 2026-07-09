// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-message-protocol, Property 20: 错误码跨层互斥

import { describe, it } from 'vitest';
import { MessageErrorCode } from './types';
import { ErrorCode } from '../workflow/types';
import { ConfigErrorCode } from '../workflow/nodeTypes/configTypes';
import { ExecutorErrorCode } from '../workflow/engine/types';
import { AgentErrorCode } from '../agents/types';
import { ToolErrorCode } from '../tools/types';
import { ResolutionErrorCode } from '../resolution/types';

/** The six prior-layer error-code enums whose value sets must not overlap with MessageErrorCode. */
const PRIOR_LAYERS: ReadonlyArray<readonly [string, Record<string, string>]> = [
  ['ErrorCode', ErrorCode as unknown as Record<string, string>],
  ['ConfigErrorCode', ConfigErrorCode as unknown as Record<string, string>],
  ['ExecutorErrorCode', ExecutorErrorCode as unknown as Record<string, string>],
  ['AgentErrorCode', AgentErrorCode as unknown as Record<string, string>],
  ['ToolErrorCode', ToolErrorCode as unknown as Record<string, string>],
  ['ResolutionErrorCode', ResolutionErrorCode as unknown as Record<string, string>],
];

describe('Property 20: 错误码跨层互斥', () => {
  it('MessageErrorCode 取值与其余六层枚举两两交集为空', () => {
    const messageValues = new Set(Object.values(MessageErrorCode));

    for (const [layerName, layerEnum] of PRIOR_LAYERS) {
      for (const value of Object.values(layerEnum)) {
        if (messageValues.has(value as MessageErrorCode)) {
          throw new Error(
            `MessageErrorCode overlaps with ${layerName} on value "${value}"`,
          );
        }
      }
    }
  });
});
