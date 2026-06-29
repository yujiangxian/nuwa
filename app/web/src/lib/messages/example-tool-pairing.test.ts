// Feature: agent-message-protocol, Example: tool-call/result pairing

import { describe, it, expect } from 'vitest';
import type { Transcript } from './types';
import { MessageErrorCode } from './types';
import { validateTranscript } from './validate';
import { pairToolResults } from './query';

/**
 * Example tests for representative tool-call/result pairing scenarios
 * (R8.4, R12.4): one well-formed paired transcript and one with an orphaned
 * tool_result.
 */
describe('Example: tool-call/result pairing', () => {
  it('pairs a tool_result with its earlier tool_call in a well-formed transcript', () => {
    const t1: Transcript = {
      messages: [
        {
          id: 'm1',
          role: 'assistant',
          parts: [
            { kind: 'tool_call', callId: 'c1', toolName: 'search', argumentsJson: '{}' },
          ],
        },
        {
          id: 'm2',
          role: 'tool',
          parts: [{ kind: 'tool_result', callId: 'c1', resultJson: '{}' }],
        },
      ],
    };

    expect(validateTranscript(t1).valid).toBe(true);

    const pairings = pairToolResults(t1);
    expect(pairings).toHaveLength(1);
    expect(pairings[0].call).not.toBeNull();
    expect(pairings[0].call?.callId).toBe('c1');
  });

  it('leaves an orphaned tool_result unpaired and reports MESSAGE_UNPAIRED_TOOL_RESULT', () => {
    const t2: Transcript = {
      messages: [
        {
          id: 'm1',
          role: 'tool',
          parts: [{ kind: 'tool_result', callId: 'c2', resultJson: '{}' }],
        },
      ],
    };

    const result = validateTranscript(t2);
    expect(result.errors.map((e) => e.code)).toContain(
      MessageErrorCode.MESSAGE_UNPAIRED_TOOL_RESULT,
    );

    const pairings = pairToolResults(t2);
    expect(pairings).toHaveLength(1);
    expect(pairings[0].call).toBeNull();
  });
});
