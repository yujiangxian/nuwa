// Feature: agent-turn-reducer, Example: 完整一轮快乐路径

import { describe, it, expect } from 'vitest';
import { initialTurnState, applyModelResponse, applyToolResults } from './reducer';
import type { ModelResponse, ToolOutcome } from './types';
import { emptyTranscript } from '../messages/transcript';

/**
 * Example: a full happy-path turn cycle.
 *   initial (awaiting_model)
 *   → applyModelResponse with one tool call (awaiting_tools)
 *   → applyToolResults covering the call (awaiting_model)
 *   → applyModelResponse with no tool calls (completed)
 *
 * Validates: Requirements 4.4, 5.5, 4.5
 */
describe('Example: 完整一轮快乐路径', () => {
  it('从 awaiting_model 经工具调用回到 awaiting_model 并最终 completed', () => {
    // s0: initial state.
    const s0 = initialTurnState(emptyTranscript());
    expect(s0.status).toBe('awaiting_model');

    // r1: model response with one tool call.
    const r1: ModelResponse = {
      messageId: 'a1',
      assistantText: 'let me search',
      toolCalls: [{ callId: 'c1', toolName: 'search', argumentsJson: '{}' }],
    };
    const res1 = applyModelResponse(s0, r1);
    expect(res1.ok).toBe(true);
    if (!res1.ok) throw new Error('res1 expected ok');
    expect(res1.state.status).toBe('awaiting_tools');
    expect(res1.state.pendingCallIds).toEqual(['c1']);
    const last1 = res1.state.transcript.messages[res1.state.transcript.messages.length - 1];
    expect(last1.role).toBe('assistant');

    // res2: apply tool results covering c1.
    const outcomes: ToolOutcome[] = [{ callId: 'c1', resultJson: '{"ok":true}' }];
    const res2 = applyToolResults(res1.state, outcomes);
    expect(res2.ok).toBe(true);
    if (!res2.ok) throw new Error('res2 expected ok');
    expect(res2.state.status).toBe('awaiting_model');
    expect(res2.state.pendingCallIds).toHaveLength(0);
    const last2 = res2.state.transcript.messages[res2.state.transcript.messages.length - 1];
    expect(last2.role).toBe('tool');

    // r3: model response with no tool calls → completed.
    const r3: ModelResponse = { messageId: 'a2', assistantText: 'done', toolCalls: [] };
    const res3 = applyModelResponse(res2.state, r3);
    expect(res3.ok).toBe(true);
    if (!res3.ok) throw new Error('res3 expected ok');
    expect(res3.state.status).toBe('completed');
    expect(res3.state.transcript.messages).toHaveLength(3);
  });
});
