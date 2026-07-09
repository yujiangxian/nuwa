// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-message-protocol, Property 18: 查询确定且精确

import { describe, it } from 'vitest';
import fc from 'fast-check';
import { messagesByRole, lastMessage, toolCalls } from './query';
import { arbitraryTranscript, arbitraryRole } from './arbitraries';

describe('Property 18: 查询确定且精确', () => {
  it('对任意 transcript 与 role，messagesByRole/lastMessage/toolCalls 精确、保序且确定', () => {
    fc.assert(
      fc.property(arbitraryTranscript, arbitraryRole, (t, role) => {
        // —— messagesByRole: every result has role===role; every excluded message
        //    has role!==role; relative order preserved (equals the filtered list). ——
        const byRole = messagesByRole(t, role);
        for (const m of byRole) {
          if (m.role !== role) {
            throw new Error('expected every messagesByRole result to match the role');
          }
        }
        const expectedByRole = t.messages.filter((m) => m.role === role);
        if (byRole.length !== expectedByRole.length) {
          throw new Error('expected messagesByRole to return exactly the matching messages');
        }
        for (let i = 0; i < expectedByRole.length; i++) {
          if (byRole[i] !== expectedByRole[i]) {
            throw new Error('expected messagesByRole to preserve relative order');
          }
        }
        // The non-matching remainder all differ from role.
        for (const m of t.messages) {
          if (m.role !== role && byRole.includes(m)) {
            throw new Error('expected non-matching messages to be excluded');
          }
        }

        // —— lastMessage: last element when non-empty, undefined when empty. ——
        const last = lastMessage(t);
        if (t.messages.length === 0) {
          if (last !== undefined) {
            throw new Error('expected lastMessage to be undefined for an empty transcript');
          }
        } else if (last !== t.messages[t.messages.length - 1]) {
          throw new Error('expected lastMessage to equal the final message');
        }

        // —— toolCalls: exactly the tool_call parts, in appearance order. ——
        const calls = toolCalls(t);
        let expectedCallCount = 0;
        for (const m of t.messages) {
          for (const p of m.parts) {
            if (p.kind === 'tool_call') {
              expectedCallCount++;
            }
          }
        }
        if (calls.length !== expectedCallCount) {
          throw new Error('expected toolCalls count to equal the number of tool_call parts');
        }
        for (const c of calls) {
          if (c.part.kind !== 'tool_call') {
            throw new Error('expected every toolCalls item to be a tool_call part');
          }
        }
        // Appearance order: rebuild the expected sequence and compare element-wise.
        const expectedCalls: { messageId: string; part: unknown }[] = [];
        for (const m of t.messages) {
          for (const p of m.parts) {
            if (p.kind === 'tool_call') {
              expectedCalls.push({ messageId: m.id, part: p });
            }
          }
        }
        for (let i = 0; i < expectedCalls.length; i++) {
          if (calls[i].messageId !== expectedCalls[i].messageId || calls[i].part !== expectedCalls[i].part) {
            throw new Error('expected toolCalls to preserve appearance order');
          }
        }

        // —— Determinism: a second call yields an equal result. ——
        const byRole2 = messagesByRole(t, role);
        const calls2 = toolCalls(t);
        if (JSON.stringify(byRole) !== JSON.stringify(byRole2)) {
          throw new Error('expected messagesByRole to be deterministic');
        }
        if (JSON.stringify(calls) !== JSON.stringify(calls2)) {
          throw new Error('expected toolCalls to be deterministic');
        }
        if (lastMessage(t) !== last) {
          throw new Error('expected lastMessage to be deterministic');
        }
      }),
      { numRuns: 100 },
    );
  });
});
