// Feature: agent-message-protocol, Property 19: 工具结果配对正确

import { describe, it } from 'vitest';
import fc from 'fast-check';
import { pairToolResults } from './query';
import { arbitraryTranscript } from './arbitraries';
import type { Transcript, ToolCallPart } from './types';

/**
 * Compute, for each tool_result part in appearance order, the earliest (first-seen)
 * tool_call sharing its Call_Id (or null when none precedes/exists). This mirrors
 * the specification independently of the implementation under test.
 */
function expectedFirstCallByResult(t: Transcript): (ToolCallPart | null)[] {
  const firstCall = new Map<string, ToolCallPart>();
  for (const m of t.messages) {
    for (const p of m.parts) {
      if (p.kind === 'tool_call' && !firstCall.has(p.callId)) {
        firstCall.set(p.callId, p);
      }
    }
  }
  const out: (ToolCallPart | null)[] = [];
  for (const m of t.messages) {
    for (const p of m.parts) {
      if (p.kind === 'tool_result') {
        out.push(firstCall.get(p.callId) ?? null);
      }
    }
  }
  return out;
}

describe('Property 19: 工具结果配对正确', () => {
  it('对任意 transcript，配对项数等于 tool_result 数量，且每项 call 配对正确', () => {
    fc.assert(
      fc.property(arbitraryTranscript, (t) => {
        const pairings = pairToolResults(t);

        // Count equals the number of tool_result parts.
        let resultCount = 0;
        for (const m of t.messages) {
          for (const p of m.parts) {
            if (p.kind === 'tool_result') {
              resultCount++;
            }
          }
        }
        if (pairings.length !== resultCount) {
          throw new Error('expected pairing count to equal the number of tool_result parts');
        }

        const expectedCalls = expectedFirstCallByResult(t);

        for (let i = 0; i < pairings.length; i++) {
          const pr = pairings[i];
          const expectedCall = expectedCalls[i];

          if (expectedCall === null) {
            // No earlier tool_call shares the Call_Id -> unpaired.
            if (pr.call !== null) {
              throw new Error('expected call to be null for an unpaired tool_result');
            }
          } else {
            // A matching tool_call exists -> paired with equal Call_Id.
            if (pr.call === null) {
              throw new Error('expected a non-null call for a paired tool_result');
            }
            if (pr.call.callId !== pr.result.callId) {
              throw new Error('expected paired call.callId to equal result.callId');
            }
            if (pr.call !== expectedCall) {
              throw new Error('expected the earliest first-seen tool_call to be paired');
            }
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});
