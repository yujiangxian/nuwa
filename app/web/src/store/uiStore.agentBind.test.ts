// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, it, expect, beforeEach } from 'vitest';
import { useUIStore, setChatDbForTesting, defaultAgents } from '@/store/uiStore';
import { useAgentStore } from '@/store/agentStore';
import { createFakeChatDb } from '@/store/testChatDb';

describe('session ↔ agent binding', () => {
  beforeEach(() => {
    setChatDbForTesting(createFakeChatDb());
    useAgentStore.setState({
      agents: defaultAgents,
      currentAgentId: 'agent-assistant',
      agentsLoading: false,
      agentsPersistent: true,
    });
    useUIStore.setState({
      agents: defaultAgents,
      currentAgentId: 'agent-assistant',
      sessions: [],
      currentSessionId: null,
      messages: [],
      sessionsLoading: false,
      isPersistent: true,
    });
  });

  it('createSession writes agentId === characterId and voice from agent', async () => {
    await useUIStore.getState().createSession('socrates');
    const s = useUIStore.getState().sessions[0];
    expect(s.agentId).toBe('socrates');
    expect(s.characterId).toBe('socrates');
    expect(s.voiceId).toBe('');
  });

  it('switchSession restores currentAgentId from session', async () => {
    await useUIStore.getState().createSession('socrates');
    const aId = useUIStore.getState().currentSessionId!;
    useUIStore.setState({ currentAgentId: 'agent-assistant' });
    useAgentStore.setState({ currentAgentId: 'agent-assistant' });

    await useUIStore.getState().createSession('agent-assistant');
    const bId = useUIStore.getState().currentSessionId!;

    await useUIStore.getState().switchSession(aId);
    expect(useUIStore.getState().currentAgentId).toBe('socrates');
    expect(useAgentStore.getState().currentAgentId).toBe('socrates');

    await useUIStore.getState().switchSession(bId);
    expect(useUIStore.getState().currentAgentId).toBe('agent-assistant');
  });

  it('switchSession keeps agent when bound id missing', async () => {
    useUIStore.setState({
      sessions: [{
        id: 'orphan',
        title: 'x',
        characterId: 'gone',
        agentId: 'gone',
        voiceId: 'jyy',
        updatedAt: new Date().toISOString(),
        pinned: false,
      }],
      currentSessionId: null,
      currentAgentId: 'agent-assistant',
    });
    useAgentStore.setState({ currentAgentId: 'agent-assistant' });
    await useUIStore.getState().switchSession('orphan');
    expect(useUIStore.getState().currentAgentId).toBe('agent-assistant');
  });

  it('bindSessionAgent updates session + persists', async () => {
    await useUIStore.getState().createSession('agent-assistant');
    const sid = useUIStore.getState().currentSessionId!;
    await useUIStore.getState().bindSessionAgent(sid, 'counselor');
    const sess = useUIStore.getState().sessions.find((s) => s.id === sid)!;
    expect(sess.agentId).toBe('counselor');
    expect(sess.characterId).toBe('counselor');
    expect(sess.voiceId).toBe('');
    expect(useUIStore.getState().currentAgentId).toBe('counselor');
  });
});
