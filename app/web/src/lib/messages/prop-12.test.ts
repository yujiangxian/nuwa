// Feature: agent-message-protocol, Property 12: 良构 Transcript 校验通过

import { describe, it } from 'vitest';
import fc from 'fast-check';
import { validateTranscript } from './validate';
import { arbitraryTranscript } from './arbitraries';

/**
 * Property 12: 良构 Transcript 校验通过
 *
 * 对任意由唯一 Message_Id、非空 parts、每个 tool_result 之前都有同 Call_Id 的
 * tool_call、Call_Id 不重复构成的 Transcript（生成器保证良构），
 * validateTranscript(t).valid 为真且 errors 为空。
 *
 * **Validates: Requirements 8.2, 8.6**
 */
describe('Property 12: well-formed transcripts validate clean', () => {
  it('valid === true and errors is empty for any well-formed transcript', () => {
    fc.assert(
      fc.property(arbitraryTranscript, (t) => {
        const result = validateTranscript(t);
        if (result.valid !== true) {
          throw new Error(
            `expected valid transcript, got errors: ${JSON.stringify(result.errors)}`,
          );
        }
        if (result.errors.length !== 0) {
          throw new Error(
            `expected empty errors, got: ${JSON.stringify(result.errors)}`,
          );
        }
      }),
      { numRuns: 100 },
    );
  });
});
