// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { actionAvailabilityFor } from '@/lib/messageActions';

/**
 * Property-based test for the chat-message-actions availability matrix.
 * numRuns >= 100.
 */

const roleArb = fc.constantFrom('user' as const, 'assistant' as const);

const messageArb = fc.record({
  id: fc.string({ minLength: 1 }),
  role: roleArb,
});

describe('actionAvailabilityFor (chat-message-actions Property 7)', () => {
  it('Property 7: 消息操作可用性矩阵', () => {
    // Feature: chat-message-actions, Property 7: 消息操作可用性矩阵
    // Validates: Requirements 1.1, 1.2, 1.3, 1.4
    fc.assert(
      fc.property(
        fc.array(messageArb, { minLength: 1, maxLength: 12 }),
        fc.nat(),
        fc.boolean(),
        (messages, indexRaw, isGenerating) => {
          const index = indexRaw % messages.length;
          const msg = messages[index];
          const isLast = index === messages.length - 1;
          const isLastAssistant = isLast && msg.role === 'assistant';

          const avail = actionAvailabilityFor(messages, index, isGenerating);

          // canCopy 恒为真，不受 Generating_State 限制（Req 1.4 不含 Copy）。
          expect(avail.canCopy).toBe(true);
          // canDelete === !isGenerating（Req 1.4）。
          expect(avail.canDelete).toBe(!isGenerating);
          // canRegenerate === (最后一条 assistant && !isGenerating)（Req 1.2, 1.4）。
          expect(avail.canRegenerate).toBe(isLastAssistant && !isGenerating);
          // canEdit === (user 消息 && !isGenerating)（Req 1.3, 1.4）。
          expect(avail.canEdit).toBe(msg.role === 'user' && !isGenerating);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('Property 7: 生成态下 Delete/Regenerate/Edit 全部禁用、Copy 仍可用', () => {
    // Feature: chat-message-actions, Property 7: Generating_State 禁用矩阵
    // Validates: Requirements 1.4
    fc.assert(
      fc.property(
        fc.array(messageArb, { minLength: 1, maxLength: 12 }),
        fc.nat(),
        (messages, indexRaw) => {
          const index = indexRaw % messages.length;
          const avail = actionAvailabilityFor(messages, index, true);
          expect(avail.canCopy).toBe(true);
          expect(avail.canDelete).toBe(false);
          expect(avail.canRegenerate).toBe(false);
          expect(avail.canEdit).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
