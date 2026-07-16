// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mergeCharactersIntoAgents,
  MIGRATION_FLAG,
  defaultAgents,
  useAgentStore,
  setAgentDbForTesting,
} from '@/store/agentStore';
import { createAgentDb } from '@/lib/agentDb';
import { createCharacterDb } from '@/lib/characterDb';
import type { Character } from '@/store/types';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';

describe('mergeCharactersIntoAgents', () => {
  it('converts characters to local agents with field mapping', () => {
    const chars: Character[] = [{
      id: 'custom-1',
      name: '自定义',
      avatar: 'grad',
      systemPrompt: 'hi',
      voiceId: 'jyy',
      description: 'd',
      mood: 'calm',
      temperature: 0.5,
      topP: 0.8,
    }];
    const { agents, added } = mergeCharactersIntoAgents([], chars);
    expect(added).toHaveLength(1);
    expect(agents[0]).toMatchObject({
      id: 'custom-1',
      name: '自定义',
      kind: 'local',
      pipeline: 'text_chat_stream',
      mood: 'calm',
      temperature: 0.5,
      topP: 0.8,
    });
  });

  it('dedupes by id and by name', () => {
    const existing = defaultAgents.slice(0, 2); // agent-assistant + assistant(季莹莹)
    const chars: Character[] = [
      { id: 'assistant', name: '别的名字', avatar: '', systemPrompt: '', voiceId: 'jyy', description: '' },
      { id: 'new-id', name: '季莹莹', avatar: '', systemPrompt: '', voiceId: 'jyy', description: '' },
      { id: 'custom-2', name: '全新', avatar: '', systemPrompt: 'x', voiceId: 'jyy', description: '' },
    ];
    const { added } = mergeCharactersIntoAgents(existing, chars);
    expect(added).toHaveLength(1);
    expect(added[0].id).toBe('custom-2');
  });
});

describe('loadAgents character migration', () => {
  beforeEach(() => {
    localStorage.clear();
    globalThis.indexedDB = new IDBFactory();
    setAgentDbForTesting(createAgentDb());
    useAgentStore.setState({
      agents: [],
      currentAgentId: 'agent-assistant',
      agentsLoading: false,
      agentsPersistent: true,
    });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('migrates once and sets flag; second load does not re-import', async () => {
    // Pre-seed defaults so we can delete the migrated agent afterward
    const agentDb = createAgentDb();
    await agentDb.init();
    for (const a of defaultAgents) {
      await agentDb.saveAgent(a);
    }
    setAgentDbForTesting(agentDb);

    const charDb = createCharacterDb();
    await charDb.init();
    await charDb.saveCharacter({
      id: 'migrated-once',
      name: '一次性角色',
      avatar: 'a',
      systemPrompt: 'p',
      voiceId: 'jyy',
      description: 'd',
    });

    await useAgentStore.getState().loadAgents();
    expect(localStorage.getItem(MIGRATION_FLAG)).toBe('1');
    expect(useAgentStore.getState().agents.some((a) => a.id === 'migrated-once')).toBe(true);

    await useAgentStore.getState().deleteAgent('migrated-once');
    expect(useAgentStore.getState().agents.some((a) => a.id === 'migrated-once')).toBe(false);

    await useAgentStore.getState().loadAgents();
    expect(useAgentStore.getState().agents.some((a) => a.id === 'migrated-once')).toBe(false);
  });
});
