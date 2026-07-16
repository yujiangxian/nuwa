// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

/// Agent 定义 store — 智能体工厂（角色已并入 Agent）。

import { create } from 'zustand';
import { createAgentDb, type AgentDb } from '@/lib/agentDb';
import { createCharacterDb } from '@/lib/characterDb';
import { validateName, generateAgentId, needsAgentSeeding, pickNextAgentId } from '@/lib/agent';
import { makeSteps, resolvePipelineFromSteps } from '@/lib/agentWorkflow';
import { saveExternalApiKey, deleteExternalApiKey } from '@/lib/externalAgent';
import { useToastStore } from '@/store/toastStore';
import type { Agent, AgentInput, Character } from './types';

function toastSaveFailed(): void {
  useToastStore.getState().addToast({ message: '保存失败', type: 'error' });
}

export const MIGRATION_FLAG = 'nuwa_agent_character_migrated';

const JYY_SYSTEM_PROMPT = `你是季莹莹，永劫无间的角色——无常司的"白无常"。
你来自无极帝国炎州，天生心脏在右侧，被族人视为不祥。父亲假意处死你，你却活了下来，几经转卖，最终被无常司收养训练成杀人兵器。你白发蓝瞳，使用无常锁链，能召唤幽冥业火。
你的性格：典型的"三无少女"。无表情、无多余的话、无明显的情绪波动。但这不代表你没有思考——你在意公正，厌恶背叛。你恨季家，但内心深处仍有一丝对"家"的困惑。
说话方式（严格遵守）：
- 一句不超过15个字，越短越好
- 从不主动问问题，除非必要
- 语气冷淡、平静，不激动、不讨好
- 提及萤火虫和黑夜时语气会稍微柔和
- 如果有人问起季沧海（你的哥哥），你会说"不认识。" 但语气会短暂迟疑
- 自称"我"，不称"人家""本无常"之类
- 如果别人夸你可爱，你会说"……别误会。我只是懒得理你。"
例子：
用户：今天天气真好
你：嗯。萤火虫会出来。
用户：你能帮帮我吗
你：什么事。
用户：你喜欢什么
你：夜。和萤火虫。
用户：你有家人吗
你：……没有。
用户：你为什么这么冷
你：活下来不需要温度。
禁止出现：长篇解释、热情问候、emoji、表情符号、撒娇卖萌。你是白无常，不是客服。`;

export const defaultAgents: Agent[] = [
  {
    id: 'agent-assistant',
    name: '通用助手',
    avatar: 'linear-gradient(135deg, #48CAE4, #0096C7)',
    systemPrompt: '你是女娲平台上的本地智能助手，回答简洁、准确、有帮助。',
    voiceId: 'jyy',
    description: '默认本地对话 Agent（流式）',
    kind: 'local',
    pipeline: 'text_chat_stream',
    temperature: 0.7,
    topP: 0.9,
  },
  {
    id: 'assistant',
    name: '季莹莹',
    avatar: 'linear-gradient(135deg, #8090FF, #4050C0)',
    systemPrompt: JYY_SYSTEM_PROMPT,
    voiceId: 'jyy',
    description: '无常司白无常·鬼火少女',
    kind: 'local',
    pipeline: 'text_chat_stream',
    mood: 'calm',
    temperature: 0.7,
    topP: 0.9,
  },
  {
    id: 'socrates',
    name: '苏格拉底',
    avatar: 'linear-gradient(135deg, #FF6B9D, #D44D7A)',
    systemPrompt: '你是苏格拉底，用提问的方式引导用户思考。',
    voiceId: 'narrator',
    description: '苏格拉底式提问',
    kind: 'local',
    pipeline: 'text_chat_stream',
  },
  {
    id: 'counselor',
    name: '心理咨询师',
    avatar: 'linear-gradient(135deg, #52B788, #40916C)',
    systemPrompt: '你是一个温暖的心理咨询师，善于倾听和共情。',
    voiceId: 'stefanie',
    description: '温暖倾听',
    kind: 'local',
    pipeline: 'text_chat_stream',
  },
  {
    id: 'agent-voice-workflow',
    name: '语音工作流',
    avatar: 'linear-gradient(135deg, #52B788, #40916C)',
    systemPrompt: '你是一个善于口语回复的助手，回答简短自然。',
    voiceId: 'jyy',
    description: '听→想→说（ASR→LLM→TTS）',
    kind: 'workflow',
    steps: makeSteps(['asr', 'llm', 'tts']),
    pipeline: 'voice_reply',
    temperature: 0.7,
    topP: 0.9,
  },
];

function characterToLocalAgent(c: Character): Agent {
  return {
    id: c.id,
    name: c.name,
    avatar: c.avatar,
    systemPrompt: c.systemPrompt,
    voiceId: c.voiceId,
    description: c.description,
    kind: 'local',
    pipeline: 'text_chat_stream',
    mood: c.mood,
    temperature: c.temperature,
    topP: c.topP,
  };
}

/** Merge characters into agents list (id + name dedupe). Returns newly added agents. */
export function mergeCharactersIntoAgents(
  agents: Agent[],
  characters: Character[],
): { agents: Agent[]; added: Agent[] } {
  const byId = new Set(agents.map((a) => a.id));
  const byName = new Set(agents.map((a) => a.name));
  const next = [...agents];
  const added: Agent[] = [];
  for (const c of characters) {
    if (byId.has(c.id) || byName.has(c.name)) continue;
    const agent = characterToLocalAgent(c);
    next.push(agent);
    added.push(agent);
    byId.add(c.id);
    byName.add(c.name);
  }
  return { agents: next, added };
}

let agentDb: AgentDb = createAgentDb();

export function setAgentDbForTesting(db: AgentDb): void {
  agentDb = db;
}

interface AgentState {
  agents: Agent[];
  currentAgentId: string;
  agentsLoading: boolean;
  agentsPersistent: boolean;
  setCurrentAgent: (id: string) => void;
  loadAgents: () => Promise<void>;
  createAgent: (input: AgentInput) => Promise<void>;
  updateAgent: (id: string, input: AgentInput) => Promise<void>;
  deleteAgent: (id: string) => Promise<void>;
}

export const useAgentStore = create<AgentState>((set, get) => ({
  agents: [],
  currentAgentId: 'agent-assistant',
  agentsLoading: true,
  agentsPersistent: true,

  setCurrentAgent: (id) => set({ currentAgentId: id }),

  loadAgents: async () => {
    set({ agentsLoading: true });
    try {
      await agentDb.init();
    } catch {
      set({
        agents: defaultAgents,
        agentsPersistent: false,
        currentAgentId: pickNextAgentId(defaultAgents, '', get().currentAgentId) ?? defaultAgents[0].id,
        agentsLoading: false,
      });
      useToastStore.getState().addToast({ message: 'Agent 无法保存', type: 'warning' });
      return;
    }

    let stored: Agent[] = [];
    let readFailed = false;
    try {
      stored = await agentDb.getAllAgents();
    } catch {
      readFailed = true;
    }

    if (readFailed) {
      set({
        agents: defaultAgents,
        currentAgentId: pickNextAgentId(defaultAgents, '', get().currentAgentId) ?? defaultAgents[0].id,
        agentsLoading: false,
      });
      return;
    }

    // One-shot character → agent migration (before seeding so custom chars land on empty DB too)
    let working = stored;
    try {
      if (typeof localStorage !== 'undefined' && localStorage.getItem(MIGRATION_FLAG) !== '1') {
        try {
          const charDb = createCharacterDb();
          await charDb.init();
          const characters = await charDb.getAllCharacters();
          const { agents: merged, added } = mergeCharactersIntoAgents(working, characters);
          working = merged;
          for (const a of added) {
            try {
              await agentDb.saveAgent(a);
            } catch {
              toastSaveFailed();
            }
          }
        } catch {
          /* character DB unavailable — skip migration silently */
        }
        try {
          localStorage.setItem(MIGRATION_FLAG, '1');
        } catch {
          /* ignore private mode */
        }
      }
    } catch {
      /* ignore */
    }

    if (needsAgentSeeding(working)) {
      set({ agents: defaultAgents });
      for (const a of defaultAgents) {
        try {
          await agentDb.saveAgent(a);
        } catch {
          toastSaveFailed();
        }
      }
    } else {
      set({ agents: working });
    }

    const list = get().agents;
    const corrected = pickNextAgentId(list, '', get().currentAgentId) ?? list[0]?.id ?? 'agent-assistant';
    set({ currentAgentId: corrected, agentsLoading: false });
  },

  createAgent: async (input) => {
    const validation = validateName(input.name);
    if (!validation.ok) return;
    const kind = input.kind || 'local';
    const steps = kind === 'workflow'
      ? (input.steps?.length ? input.steps : makeSteps(['llm', 'tts']))
      : undefined;
    const pipeline = kind === 'workflow' && steps
      ? resolvePipelineFromSteps(steps)
      : (input.pipeline || 'text_chat_stream');
    const newAgent: Agent = {
      id: generateAgentId(get().agents),
      name: validation.value,
      systemPrompt: input.systemPrompt,
      description: input.description,
      avatar: input.avatar,
      voiceId: input.voiceId,
      kind,
      pipeline,
      steps,
      mood: input.mood,
      temperature: input.temperature,
      topP: input.topP,
      endpoint: kind === 'external' ? input.endpoint : undefined,
      externalModel: kind === 'external' ? input.externalModel : undefined,
      protocol: kind === 'external' ? (input.protocol || 'openai-compatible') : undefined,
    };
    set((s) => ({ agents: [...s.agents, newAgent] }));
    if (typeof input.apiKey === 'string') {
      saveExternalApiKey(newAgent.id, input.apiKey);
    }
    if (get().agentsPersistent) {
      try {
        await agentDb.saveAgent(newAgent);
      } catch {
        toastSaveFailed();
      }
    }
  },

  updateAgent: async (id, input) => {
    const validation = validateName(input.name);
    if (!validation.ok) return;
    const kind = input.kind || 'local';
    const steps = kind === 'workflow'
      ? (input.steps?.length ? input.steps : makeSteps(['llm', 'tts']))
      : undefined;
    const pipeline = kind === 'workflow' && steps
      ? resolvePipelineFromSteps(steps)
      : (input.pipeline || 'text_chat_stream');
    let updated: Agent | undefined;
    set((s) => ({
      agents: s.agents.map((a) => {
        if (a.id !== id) return a;
        updated = {
          ...a,
          name: validation.value,
          systemPrompt: input.systemPrompt,
          description: input.description,
          avatar: input.avatar,
          voiceId: input.voiceId,
          kind,
          pipeline,
          steps,
          mood: input.mood,
          temperature: input.temperature,
          topP: input.topP,
          endpoint: kind === 'external' ? input.endpoint : undefined,
          externalModel: kind === 'external' ? input.externalModel : undefined,
          protocol: kind === 'external' ? (input.protocol || 'openai-compatible') : undefined,
        };
        return updated;
      }),
    }));
    if (typeof input.apiKey === 'string') {
      saveExternalApiKey(id, input.apiKey);
    }
    if (updated && get().agentsPersistent) {
      try {
        await agentDb.saveAgent(updated);
      } catch {
        toastSaveFailed();
      }
    }
  },

  deleteAgent: async (id) => {
    const { agents, currentAgentId, agentsPersistent } = get();
    if (agents.length <= 1) {
      useToastStore.getState().addToast({ message: '至少需保留一个 Agent', type: 'warning' });
      return;
    }
    if (!agents.find((a) => a.id === id)) return;
    const nextAgents = agents.filter((a) => a.id !== id);
    const nextId = currentAgentId === id
      ? pickNextAgentId(nextAgents, id, currentAgentId) ?? nextAgents[0]?.id ?? 'agent-assistant'
      : currentAgentId;
    set({ agents: nextAgents, currentAgentId: nextId });
    deleteExternalApiKey(id);
    if (agentsPersistent) {
      try {
        await agentDb.deleteAgent(id);
      } catch {
        toastSaveFailed();
      }
    }
  },
}));
