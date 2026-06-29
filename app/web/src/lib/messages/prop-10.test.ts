// Feature: agent-message-protocol, Property 10: validateTranscript 未配对工具结果检测
//
// 对任意含一个 Tool_Result_Part 而其 Call_Id 不等于任何更早 Tool_Call_Part 的 Call_Id 的
// Transcript，validateTranscript 含一条 MESSAGE_UNPAIRED_TOOL_RESULT（定位该 Call_Id）。
//
// Validates: Requirements 8.4

import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { validateTranscript } from './validate';
import { arbitraryUnpairedResultTranscript } from './arbitraries';
import { MessageErrorCode } from './types';
import type { Transcript } from './types';

/**
 * Collect the Call_Ids of tool_result parts that have no earlier tool_call sharing
 * the same Call_Id, mirroring the validator's ordered pass.
 */
function unpairedResultCallIds(t: Transcript): Set<string> {
  const seenCallIds = new Set<string>();
  const unpaired = new Set<string>();
  for (const m of t.messages) {
    for (const p of m.parts) {
      if (p.kind === 'tool_call') {
        seenCallIds.add(p.callId);
      } else if (p.kind === 'tool_result' && !seenCallIds.has(p.callId)) {
        unpaired.add(p.callId);
      }
    }
  }
  return unpaired;
}

describe('Property 10: validateTranscript detects unpaired tool results', () => {
  it('an orphaned tool_result produces a MESSAGE_UNPAIRED_TOOL_RESULT locating its Call_Id', () => {
    fc.assert(
      fc.property(arbitraryUnpairedResultTranscript, (t) => {
        const unpaired = unpairedResultCallIds(t);
        expect(unpaired.size).toBeGreaterThanOrEqual(1);

        const { errors } = validateTranscript(t);
        const unpairedErrors = errors.filter(
          (e) => e.code === MessageErrorCode.MESSAGE_UNPAIRED_TOOL_RESULT,
        );

        expect(unpairedErrors.length).toBeGreaterThanOrEqual(1);
        for (const callId of unpaired) {
          expect(unpairedErrors.some((e) => e.location.callId === callId)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});
