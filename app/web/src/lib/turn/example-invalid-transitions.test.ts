// Feature: agent-turn-reducer, Example: 非法转换与未知 callId

import { describe, it, expect } from 'vitest';
import { initialTurnState, applyModelResponse, applyToolResults } from './reducer';
import { TurnErrorCode } from './types';
import { emptyTranscript } from '../messages/transcript';

/**
 * Example: invalid transitions are rejected with the documented error codes.
 *   - any transition from `completed` fails with TURN_INVALID_STATE
 *   - applying tool results in `awaiting_model` fails with TURN_INVALID_STATE
 *   - an unknown callId fails with TURN_UNKNOWN_CALL_ID (location.callId set)
 *
 * Validates: Requirements 4.2, 5.2, 5.3, 7.3
 */
describe('Example: 非法转换与未知 callId', () => {
  it('completed 态施加任一转换均失败且 code 为 TURN_INVALID_STATE', () => {
    const completedRes = applyModelResponse(initialTurnState(emptyTranscript()), {
      messageId: 'a1',
      toolCalls: [],
    });
    expect(completedRes.ok).toBe(true);
    if (!completedRes.ok) throw new Error('expected completed state');
    const s = completedRes.state;
    expect(s.status).toBe('completed');

    const modelAgain = applyModelResponse(s, { messageId: 'a2', toolCalls: [] });
    expect(modelAgain.ok).toBe(false);
    if (modelAgain.ok) throw new Error('expected failure');
    expect(modelAgain.error.code).toBe(TurnErrorCode.TURN_INVALID_STATE);

    const toolsOnCompleted = applyToolResults(s, []);
    expect(toolsOnCompleted.ok).toBe(false);
    if (toolsOnCompleted.ok) throw new Error('expected failure');
    expect(toolsOnCompleted.error.code).toBe(TurnErrorCode.TURN_INVALID_STATE);
  });

  it('awaiting_model 态施加工具结果失败且 code 为 TURN_INVALID_STATE', () => {
    const s0 = initialTurnState(emptyTranscript());
    const res = applyToolResults(s0, []);
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected failure');
    expect(res.error.code).toBe(TurnErrorCode.TURN_INVALID_STATE);
  });

  it('未知 callId 失败且 code 为 TURN_UNKNOWN_CALL_ID、location.callId 为 cX', () => {
    const s0 = initialTurnState(emptyTranscript());
    const res1 = applyModelResponse(s0, {
      messageId: 'a1',
      toolCalls: [{ callId: 'c1', toolName: 't', argumentsJson: '{}' }],
    });
    expect(res1.ok).toBe(true);
    if (!res1.ok) throw new Error('expected awaiting_tools');
    expect(res1.state.status).toBe('awaiting_tools');

    const res = applyToolResults(res1.state, [{ callId: 'cX', resultJson: '{}' }]);
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected failure');
    expect(res.error.code).toBe(TurnErrorCode.TURN_UNKNOWN_CALL_ID);
    expect(res.error.location.callId).toBe('cX');
  });
});
