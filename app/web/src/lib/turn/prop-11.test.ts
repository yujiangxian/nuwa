// Feature: agent-turn-reducer, Property 11: 工具结果施加不可变性与确定性
//
// 对任意 s 与 outcomes，applyToolResults 两次调用返回相等结果；调用不改变 s 与
// outcomes（以序列化比较）。
// Validates: Requirements 1.3, 1.4, 5.8

import fc from 'fast-check';
import { describe, it } from 'vitest';
import { applyToolResults } from './reducer';
import { arbitraryTurnStateAwaitingTools, arbitraryToolOutcomesFull } from './arbitraries';

describe('Property 11: applying tool results is immutable and deterministic', () => {
  it('returns equal results twice and leaves inputs unchanged', () => {
    fc.assert(
      fc.property(
        arbitraryTurnStateAwaitingTools.chain((s) =>
          arbitraryToolOutcomesFull(s.pendingCallIds).map((o) => ({ s, o })),
        ),
        ({ s, o }) => {
          const beforeState = JSON.stringify(s);
          const beforeOutcomes = JSON.stringify(o);

          const res1 = applyToolResults(s, o);
          const res2 = applyToolResults(s, o);

          const deterministic = JSON.stringify(res1) === JSON.stringify(res2);
          const stateUnchanged = JSON.stringify(s) === beforeState;
          const outcomesUnchanged = JSON.stringify(o) === beforeOutcomes;

          return deterministic && stateUnchanged && outcomesUnchanged;
        },
      ),
      { numRuns: 100 },
    );
  });
});
