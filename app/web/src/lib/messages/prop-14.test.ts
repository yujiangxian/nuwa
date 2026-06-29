// Feature: agent-message-protocol, Property 14: normalizeMessage 语义等价唯一且保持关键字段

import { describe, it } from 'vitest';
import fc from 'fast-check';
import { normalizeMessage, messageEquals } from './normalize';
import { arbitraryValidMessage, arbitraryReorderedJsonMessage } from './arbitraries';

/**
 * Property 14: normalizeMessage 语义等价唯一且保持关键字段
 *
 * 对任意 Message base 与其仅在内部 JSON 键序/空白上不同的变体 variant，
 * normalizeMessage(base) 与 normalizeMessage(variant) messageEquals（语义等价收敛到
 * 唯一规范表示）；且 normalizeMessage(base) 保持 id、role、parts 长度、各片段 kind，
 * 以及 tool_call 的 callId/toolName、tool_result 的 callId、text 的 text。
 *
 * **Validates: Requirements 10.4, 10.6**
 */
describe('Property 14: normalizeMessage semantic uniqueness & field preservation', () => {
  it('reordered-JSON variants normalize to an equal message and key fields are preserved', () => {
    fc.assert(
      fc.property(
        arbitraryValidMessage.chain((base) =>
          fc.tuple(fc.constant(base), arbitraryReorderedJsonMessage(base)),
        ),
        ([base, variant]) => {
          const normBase = normalizeMessage(base);
          const normVariant = normalizeMessage(variant);

          // Semantic equivalence collapses to a unique canonical representation.
          if (!messageEquals(normBase, normVariant)) {
            throw new Error(
              `semantically equivalent messages did not normalize equal:\nbase=${JSON.stringify(
                normBase,
              )}\nvariant=${JSON.stringify(normVariant)}`,
            );
          }

          // Key identifying fields are preserved by normalization.
          if (normBase.id !== base.id) {
            throw new Error('normalizeMessage changed id');
          }
          if (normBase.role !== base.role) {
            throw new Error('normalizeMessage changed role');
          }
          if (normBase.parts.length !== base.parts.length) {
            throw new Error('normalizeMessage changed parts length');
          }

          for (let i = 0; i < base.parts.length; i++) {
            const op = base.parts[i];
            const np = normBase.parts[i];
            if (np.kind !== op.kind) {
              throw new Error(`normalizeMessage changed part kind at index ${i}`);
            }
            if (op.kind === 'text' && np.kind === 'text') {
              if (np.text !== op.text) {
                throw new Error(`normalizeMessage changed text at index ${i}`);
              }
            } else if (op.kind === 'tool_call' && np.kind === 'tool_call') {
              if (np.callId !== op.callId) {
                throw new Error(`normalizeMessage changed tool_call callId at index ${i}`);
              }
              if (np.toolName !== op.toolName) {
                throw new Error(`normalizeMessage changed tool_call toolName at index ${i}`);
              }
            } else if (op.kind === 'tool_result' && np.kind === 'tool_result') {
              if (np.callId !== op.callId) {
                throw new Error(`normalizeMessage changed tool_result callId at index ${i}`);
              }
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
