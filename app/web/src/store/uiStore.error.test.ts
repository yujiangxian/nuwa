// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, it, expect, beforeEach } from 'vitest';
import { useUIStore, setChatDbForTesting, defaultAgents } from '@/store/uiStore';
import type { ChatDb } from '@/lib/chatDb';
import { useToastStore } from '@/store/toastStore';
import { createFakeChatDb } from '@/store/testChatDb';

/**
 * Error / degradation unit tests for Chat_Store (Requirements 9.1–9.4).
 * Each case injects a Chat_DB stub that rejects at a specific stage and asserts
 * the documented fallback behaviour.
 */

function resetStore(): void {
  useUIStore.setState({
    sessions: [],
    currentSessionId: null,
    messages: [],
    sessionsLoading: true,
    isPersistent: true,
    agents: defaultAgents,
    currentAgentId: 'assistant',
  });
  useToastStore.setState({ toasts: [] });
}

beforeEach(resetStore);

describe('Chat_Store error handling', () => {
  it('init 失败 → 进入 Memory_Fallback_Mode（isPersistent=false、自动建会话、提示）', async () => {
    // Requirements: 9.1, 9.2
    const base = createFakeChatDb();
    const db: ChatDb = { ...base, init: async () => { throw new Error('indexeddb unavailable'); } };
    setChatDbForTesting(db);

    await useUIStore.getState().loadSessions();

    const s = useUIStore.getState();
    expect(s.isPersistent).toBe(false);
    expect(s.sessions.length).toBe(1); // 自动建的内存会话
    expect(s.currentSessionId).toBe(s.sessions[0].id);
    expect(s.sessionsLoading).toBe(false);
    expect(useToastStore.getState().toasts.some((t) => t.message === '本地历史无法保存')).toBe(true);
  });

  it('读取失败 → 以空集合继续并触发空状态处理（自动建会话）', async () => {
    // Requirements: 9.3
    const base = createFakeChatDb();
    const db: ChatDb = { ...base, getAllSessions: async () => { throw new Error('read failed'); } };
    setChatDbForTesting(db);

    await useUIStore.getState().loadSessions();

    const s = useUIStore.getState();
    expect(s.isPersistent).toBe(true); // init 成功，仍处于持久模式
    expect(s.sessions.length).toBe(1); // 空状态自动建会话
    expect(s.currentSessionId).toBe(s.sessions[0].id);
    expect(s.sessionsLoading).toBe(false);
  });

  it('写入失败 → 保留内存状态并提示「保存失败」', async () => {
    // Requirements: 9.4
    const base = createFakeChatDb();
    const db: ChatDb = { ...base, saveMessage: async () => { throw new Error('write failed'); } };
    setChatDbForTesting(db);

    const sid = 'sess-write-fail';
    useUIStore.setState({
      sessions: [{ id: sid, title: '新对话', characterId: 'assistant', voiceId: 'jyy', updatedAt: new Date().toISOString(), pinned: false }],
      currentSessionId: sid,
      messages: [],
      isPersistent: true,
      sessionsLoading: false,
    });

    await useUIStore.getState().appendMessage({ id: 'msg-1', role: 'user', content: '你好' });

    const s = useUIStore.getState();
    // 内存状态保留：消息仍在 messages 中。
    expect(s.messages.map((m) => m.id)).toContain('msg-1');
    // 提示「保存失败」。
    expect(useToastStore.getState().toasts.some((t) => t.message === '保存失败')).toBe(true);
  });
});
