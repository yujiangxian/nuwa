// Feature: agent-turn-reducer, Property 12: Transcript 单调增长（前缀保持）

import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { initialTurnState, applyModelResponse } from './reducer';
import { arbitraryTranscript } from '../messages/arbitraries';
import { arbitraryModelResponseWithTools } from './arbitraries';

// Validates: Requirements 4.6, 5.4, 7.1
describe('Property 12: Transcript 单调增长（前缀保持）', () => {
  it('成功的 applyModelResponse 在输入 transcript 末尾恰追加一条消息，且保持原前缀逐元素引用相等', () => {
    fc.assert(
      fc.property(
        arbitraryTranscript.chain((t) =>
          arbitraryModelResponseWithTools(t).map((r) => ({ t, r })),
        ),
        ({ t, r }) => {
          const res = applyModelResponse(initialTurnState(t), r);
          expect(res.ok).toBe(true);
          if (!res.ok) return;

          const next = res.state.transcript.messages;
          // 长度恰多 1。
          expect(next.length).toBe(t.messages.length + 1);
          // 前缀逐元素引用相等（保持原有消息不变）。
          const prefix = next.slice(0, t.messages.length);
          for (let i = 0; i < t.messages.length; i++) {
            expect(prefix[i]).toBe(t.messages[i]);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
