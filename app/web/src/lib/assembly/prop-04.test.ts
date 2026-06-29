// Feature: agent-conversation-assembly, Property 4: 装配首元素为系统消息
//
// 对任意 a、transcript t 与 options，assembleMessages(a, t, options) 非空，其首元素
// 语义等于 systemMessageOf(a)（role 'system'、text 等于 systemPrompt、id 等于前缀+agentId）。
//
// Validates: Requirements 4.2, 8.1

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { assembleMessages, systemMessageOf } from './assemble';
import { arbitraryAgent, arbitraryTranscript, arbitraryAssemblyOptions } from './arbitraries';

describe('Property 4: 装配首元素为系统消息', () => {
  it('结果非空且首元素深等于 systemMessageOf(a)', () => {
    fc.assert(
      fc.property(
        arbitraryAgent,
        arbitraryTranscript,
        arbitraryAssemblyOptions,
        (a, t, options) => {
          const res = assembleMessages(a, t, options);

          expect(res.length).toBeGreaterThanOrEqual(1);
          expect(res[0]).toEqual(systemMessageOf(a));
        },
      ),
      { numRuns: 100 },
    );
  });
});
