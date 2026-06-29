// Feature: agent-message-protocol, Property 9: validateTranscript 重复 Message_Id 检测
//
// 对任意含两条或更多相同 Message_Id 的 Transcript，validateTranscript 含一条
// MESSAGE_DUPLICATE_ID（定位该 id）。
//
// Validates: Requirements 8.3

import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { validateTranscript } from './validate';
import { arbitraryDuplicateIdTranscript } from './arbitraries';
import { MessageErrorCode } from './types';
import type { Transcript } from './types';

/** Collect the Message_Ids that occur at least twice in the transcript. */
function duplicatedIds(t: Transcript): Set<string> {
  const counts = new Map<string, number>();
  for (const m of t.messages) {
    counts.set(m.id, (counts.get(m.id) ?? 0) + 1);
  }
  const dups = new Set<string>();
  for (const [id, count] of counts) {
    if (count >= 2) dups.add(id);
  }
  return dups;
}

describe('Property 9: validateTranscript detects duplicate Message_Id', () => {
  it('a transcript with a repeated Message_Id produces a MESSAGE_DUPLICATE_ID locating that id', () => {
    fc.assert(
      fc.property(arbitraryDuplicateIdTranscript, (t) => {
        const dups = duplicatedIds(t);
        expect(dups.size).toBeGreaterThanOrEqual(1);

        const { errors } = validateTranscript(t);
        const dupErrors = errors.filter(
          (e) => e.code === MessageErrorCode.MESSAGE_DUPLICATE_ID,
        );

        // At least one duplicate-id error, located at a genuinely duplicated id.
        expect(dupErrors.length).toBeGreaterThanOrEqual(1);
        for (const id of dups) {
          expect(dupErrors.some((e) => e.location.messageId === id)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});
