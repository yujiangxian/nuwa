// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-message-protocol, Property 11: validateTranscript 重复 Call_Id 检测

import { describe, it } from 'vitest';
import fc from 'fast-check';
import { validateTranscript } from './validate';
import { MessageErrorCode } from './types';
import { arbitraryDuplicateCallIdTranscript } from './arbitraries';

/**
 * Property 11: validateTranscript 重复 Call_Id 检测
 *
 * 对任意含两个或更多相同 Call_Id 的 Tool_Call_Part 的 Transcript，validateTranscript
 * 含一条 MESSAGE_DUPLICATE_CALL_ID（定位该 Call_Id）。
 *
 * **Validates: Requirements 8.5**
 */
describe('Property 11: validateTranscript duplicate Call_Id detection', () => {
  it('reports exactly one MESSAGE_DUPLICATE_CALL_ID locating the repeated callId', () => {
    fc.assert(
      fc.property(arbitraryDuplicateCallIdTranscript, (t) => {
        // The transcript holds two tool_call parts sharing the same callId.
        const callId = (() => {
          for (const m of t.messages) {
            for (const p of m.parts) {
              if (p.kind === 'tool_call') return p.callId;
            }
          }
          return '';
        })();

        const result = validateTranscript(t);
        const dupErrors = result.errors.filter(
          (e) => e.code === MessageErrorCode.MESSAGE_DUPLICATE_CALL_ID,
        );

        if (dupErrors.length !== 1) {
          throw new Error(
            `expected exactly one MESSAGE_DUPLICATE_CALL_ID, got ${dupErrors.length}`,
          );
        }
        if (dupErrors[0].location.callId !== callId) {
          throw new Error(
            `expected error to locate callId ${JSON.stringify(callId)}, got ${JSON.stringify(
              dupErrors[0].location.callId,
            )}`,
          );
        }
      }),
      { numRuns: 100 },
    );
  });
});
