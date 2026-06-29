// Feature: agent-turn-reducer, Property 4: 含工具调用转移到 awaiting_tools

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { initialTurnState, applyModelResponse } from './reducer';
import { arbitraryTranscript } from '../messages/arbitraries';
import { arbitraryModelResponseWithTools } from './arbitraries';

/** Deduplicate while preserving first-seen order. */
function uniqueInOrder(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * Property 4: For any awaiting_model state derived from `t` and a ModelResponse
 * `r` with a non-empty Tool_Call_List, `applyModelResponse` succeeds, the new
 * status is `awaiting_tools`, pendingCallIds equals `r.toolCalls`' callIds
 * deduplicated in order, and the new transcript has exactly one more message
 * (the last being role `assistant`).
 *
 * Validates: Requirements 4.4, 4.6
 */
describe('Property 4: 含工具调用转移到 awaiting_tools', () => {
  it('含工具调用的模型输出成功转移到 awaiting_tools', () => {
    fc.assert(
      fc.property(
        arbitraryTranscript.chain((t) =>
          arbitraryModelResponseWithTools(t).map((r) => ({ t, r })),
        ),
        ({ t, r }) => {
          const s = initialTurnState(t);
          const res = applyModelResponse(s, r);

          expect(res.ok).toBe(true);
          if (!res.ok) {
            throw new Error('expected applyModelResponse to succeed');
          }
          const next = res.state;

          // New status is awaiting_tools (R4.4).
          expect(next.status).toBe('awaiting_tools');

          // pendingCallIds equals tool call ids, deduplicated, order-preserving (R4.4).
          expect([...next.pendingCallIds]).toEqual(
            uniqueInOrder(r.toolCalls.map((c) => c.callId)),
          );

          // Transcript grew by exactly one message; last is role assistant (R4.6).
          expect(next.transcript.messages.length).toBe(t.messages.length + 1);
          const last = next.transcript.messages[next.transcript.messages.length - 1];
          expect(last.role).toBe('assistant');
        },
      ),
      { numRuns: 100 },
    );
  });
});
