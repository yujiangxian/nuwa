// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { useUIStore, setChatDbForTesting, defaultAgents, type Agent, type ChatSession, type ChatMessage } from '@/store/uiStore';
import { DEFAULT_TITLE, deriveTitle } from '@/lib/chatTitle';
import { createFakeChatDb, type FakeChatDb } from '@/store/testChatDb';

/**
 * Chat_Store property-based tests (Properties 7, 8, 2, 3, 10).
 * A fresh in-memory fake Chat_DB is injected per test and the store state is
 * reset to a clean, persistent baseline before each case.
 */

let fake: FakeChatDb;

function resetStore(): void {
  fake = createFakeChatDb();
  setChatDbForTesting(fake);
  useUIStore.setState({
    sessions: [],
    currentSessionId: null,
    messages: [],
    sessionsLoading: false,
    isPersistent: true,
    agents: defaultAgents,
    currentAgentId: 'assistant',
  });
}

beforeEach(resetStore);

// Token generator for ids / voice ids (non-empty, simple alphabet).
const tokenArb = fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), { minLength: 1, maxLength: 6 });

function makeAgent(id: string, voiceId: string): Agent {
  return {
    id,
    name: id,
    avatar: '',
    systemPrompt: '',
    voiceId,
    description: '',
    kind: 'local',
    pipeline: 'text_chat_stream',
  };
}

describe('Chat_Store createSession (Property 7)', () => {
  it('Property 7: 新建会话字段派生与状态后置条件', async () => {
    // Feature: chat-session-persistence, Property 7: 新建会话字段派生与状态后置条件
    // Validates: Requirements 2.1, 2.2
    await fc.assert(
      fc.asyncProperty(
        fc
          .uniqueArray(fc.record({ id: tokenArb, voiceId: tokenArb }), { minLength: 1, maxLength: 5, selector: (c) => c.id })
          .chain((list) => fc.record({ list: fc.constant(list), pickIdx: fc.integer({ min: 0, max: list.length - 1 }) })),
        async ({ list, pickIdx }) => {
          resetStore();
          const agents = list.map((c) => makeAgent(c.id, c.voiceId));
          const picked = agents[pickIdx];
          useUIStore.setState({ agents, currentAgentId: picked.id });

          await useUIStore.getState().createSession(picked.id);

          const s = useUIStore.getState();
          const created = s.sessions[0];
          expect(created.characterId).toBe(picked.id);
          expect(created.agentId).toBe(picked.id);
          expect(created.voiceId).toBe(picked.voiceId);
          expect(created.title).toBe(DEFAULT_TITLE);
          expect(s.currentSessionId).toBe(created.id);
          expect(s.messages).toEqual([]);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('Chat_Store switchSession (Property 8)', () => {
  it('Property 8: 切换会话状态转移与幂等', async () => {
    // Feature: chat-session-persistence, Property 8: 切换会话状态转移与幂等
    // Validates: Requirements 3.1, 3.4
    const sessionSpecArb = fc.record({
      id: tokenArb,
      contents: fc.array(fc.string({ maxLength: 12 }), { maxLength: 4 }),
    });
    await fc.assert(
      fc.asyncProperty(
        fc
          .uniqueArray(sessionSpecArb, { minLength: 1, maxLength: 4, selector: (s) => s.id })
          .chain((specs) => fc.record({ specs: fc.constant(specs), targetIdx: fc.integer({ min: 0, max: specs.length - 1 }) })),
        async ({ specs, targetIdx }) => {
          resetStore();
          const sessions: ChatSession[] = [];
          const expected: Record<string, ChatMessage[]> = {};
          for (const spec of specs) {
            sessions.push({ id: spec.id, title: DEFAULT_TITLE, characterId: 'assistant', voiceId: 'jyy', updatedAt: new Date().toISOString(), pinned: false });
            const msgs: ChatMessage[] = [];
            for (let i = 0; i < spec.contents.length; i++) {
              const m: ChatMessage = { id: `${spec.id}-${i}`, role: i % 2 === 0 ? 'user' : 'assistant', content: spec.contents[i] };
              await fake.saveMessage({ ...m, sessionId: spec.id, seq: i });
              msgs.push(m);
            }
            expected[spec.id] = msgs;
          }
          const first = sessions[0];
          useUIStore.setState({ sessions, currentSessionId: first.id, messages: expected[first.id] });

          const target = sessions[targetIdx];
          await useUIStore.getState().switchSession(target.id);

          const s = useUIStore.getState();
          expect(s.currentSessionId).toBe(target.id);
          // messages always equal the target session's persisted message sequence,
          // covering both the transition case and the idempotent (target === current) case.
          expect(s.messages.map((m) => ({ id: m.id, role: m.role, content: m.content }))).toEqual(
            expected[target.id].map((m) => ({ id: m.id, role: m.role, content: m.content })),
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('Chat_Store appendMessage auto-title (Property 2)', () => {
  // Non-empty content whose trimmed form is non-empty (so deriveTitle != DEFAULT_TITLE).
  const userContentArb = fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0);

  it('Property 2: 自动标题首条触发且单次', async () => {
    // Feature: chat-session-persistence, Property 2: 自动标题首条触发且单次
    // Validates: Requirements 6.1, 6.4
    await fc.assert(
      fc.asyncProperty(userContentArb, fc.string({ maxLength: 10 }), async (content, extra) => {
        resetStore();
        // (a) DEFAULT_TITLE + no user message -> title becomes deriveTitle(content).
        const sid = 'sess-a';
        useUIStore.setState({
          sessions: [{ id: sid, title: DEFAULT_TITLE, characterId: 'assistant', voiceId: 'jyy', updatedAt: new Date().toISOString(), pinned: false }],
          currentSessionId: sid,
          messages: [],
        });
        await useUIStore.getState().appendMessage({ id: 'u1', role: 'user', content });
        expect(useUIStore.getState().sessions[0].title).toBe(deriveTitle(content));

        // (b) Session already has a non-default title -> further user messages keep it.
        const customTitle = 'custom-' + extra;
        useUIStore.setState({
          sessions: [{ id: 'sess-b', title: customTitle, characterId: 'assistant', voiceId: 'jyy', updatedAt: new Date().toISOString(), pinned: false }],
          currentSessionId: 'sess-b',
          messages: [],
        });
        await useUIStore.getState().appendMessage({ id: 'u2', role: 'user', content });
        expect(useUIStore.getState().sessions[0].title).toBe(customTitle);
      }),
      { numRuns: 100 },
    );
  });
});

describe('Chat_Store renameSession (Property 3)', () => {
  it('Property 3: 重命名 trim 语义', async () => {
    // Feature: chat-session-persistence, Property 3: 重命名 trim 语义
    // Validates: Requirements 5.1, 5.3
    await fc.assert(
      fc.asyncProperty(fc.string(), async (t) => {
        resetStore();
        const sid = 'rename-sess';
        const original = 'original-title';
        useUIStore.setState({
          sessions: [{ id: sid, title: original, characterId: 'assistant', voiceId: 'jyy', updatedAt: new Date().toISOString(), pinned: false }],
          currentSessionId: sid,
          messages: [],
        });
        await useUIStore.getState().renameSession(sid, t);
        const title = useUIStore.getState().sessions[0].title;
        if (t.trim().length > 0) {
          expect(title).toBe(t.trim());
        } else {
          expect(title).toBe(original);
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe('Chat_Store appendMessage updatedAt & persistence (Property 10)', () => {
  it('Property 10: 追加消息更新 updatedAt 并持久化', async () => {
    // Feature: chat-session-persistence, Property 10: 追加消息更新 updatedAt 并持久化
    // Validates: Requirements 8.6
    await fc.assert(
      fc.asyncProperty(
        fc.record({ id: tokenArb, role: fc.constantFrom<'user' | 'assistant'>('user', 'assistant'), content: fc.string({ maxLength: 20 }) }),
        async (msgSpec) => {
          resetStore();
          const sid = 'append-sess';
          const before = new Date(Date.now() - 1000).toISOString(); // strictly earlier baseline
          useUIStore.setState({
            sessions: [{ id: sid, title: DEFAULT_TITLE, characterId: 'assistant', voiceId: 'jyy', updatedAt: before, pinned: false }],
            currentSessionId: sid,
            messages: [],
          });

          const msg: ChatMessage = { id: msgSpec.id, role: msgSpec.role, content: msgSpec.content };
          await useUIStore.getState().appendMessage(msg);

          const session = useUIStore.getState().sessions[0];
          // updatedAt advanced (not earlier than before).
          expect(session.updatedAt >= before).toBe(true);
          // Persisted in persistent mode: message + session written to Chat_DB.
          const persistedMsg = fake.messageStore.get(msg.id);
          expect(persistedMsg).toBeDefined();
          expect(persistedMsg?.sessionId).toBe(sid);
          expect(fake.sessionStore.get(sid)?.updatedAt).toBe(session.updatedAt);
        },
      ),
      { numRuns: 100 },
    );
  });
});
