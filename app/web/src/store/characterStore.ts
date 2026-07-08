/// 角色管理独立 store — 从 uiStore 拆分。
/// 管理 characters 数组、currentCharacterId、CRUD 操作与 IndexedDB 持久化。

import { create } from 'zustand';
import { createCharacterDb, type CharacterDb } from '@/lib/characterDb';
import { validateName, generateCharacterId, needsSeeding, pickNextCurrentId } from '@/lib/character';
import { useToastStore } from '@/store/toastStore';
import type { Character, CharacterInput } from './types';

function toastSaveFailed(): void {
  useToastStore.getState().addToast({ message: '保存失败', type: 'error' });
}

export const defaultCharacters: Character[] = [
  {
    id: 'assistant',
    name: '季莹莹',
    avatar: 'linear-gradient(135deg, #8090FF, #4050C0)',
    systemPrompt: `你是季莹莹，永劫无间的角色——无常司的"白无常"。
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
禁止出现：长篇解释、热情问候、emoji、表情符号、撒娇卖萌。你是白无常，不是客服。`,
    voiceId: 'jyy',
    description: '无常司白无常·鬼火少女',
    mood: 'calm',
    temperature: 0.7,
    topP: 0.9,
  },
  { id: 'socrates', name: '苏格拉底', avatar: 'linear-gradient(135deg, #FF6B9D, #D44D7A)', systemPrompt: '你是苏格拉底，用提问的方式引导用户思考。', voiceId: 'narrator', description: '苏格拉底式提问' },
  { id: 'counselor', name: '心理咨询师', avatar: 'linear-gradient(135deg, #52B788, #40916C)', systemPrompt: '你是一个温暖的心理咨询师，善于倾听和共情。', voiceId: 'stefanie', description: '温暖倾听' },
];

let characterDb: CharacterDb = createCharacterDb();

export function setCharacterDbForTesting(db: CharacterDb): void {
  characterDb = db;
}

interface CharacterState {
  characters: Character[];
  currentCharacterId: string;
  charactersLoading: boolean;
  charactersPersistent: boolean;
  setCurrentCharacter: (id: string) => void;
  loadCharacters: () => Promise<void>;
  createCharacter: (input: CharacterInput) => Promise<void>;
  updateCharacter: (id: string, input: CharacterInput) => Promise<void>;
  deleteCharacter: (id: string) => Promise<void>;
}

export const useCharacterStore = create<CharacterState>((set, get) => ({
  characters: [],
  currentCharacterId: 'assistant',
  charactersLoading: true,
  charactersPersistent: true,

  setCurrentCharacter: (id) => set({ currentCharacterId: id }),

  loadCharacters: async () => {
    set({ charactersLoading: true });
    try {
      await characterDb.init();
    } catch {
      set({
        characters: defaultCharacters,
        charactersPersistent: false,
        currentCharacterId: pickNextCurrentId(defaultCharacters, '', get().currentCharacterId) ?? defaultCharacters[0].id,
        charactersLoading: false,
      });
      useToastStore.getState().addToast({ message: '角色无法保存', type: 'warning' });
      return;
    }

    let stored: Character[] = [];
    let readFailed = false;
    try {
      stored = await characterDb.getAllCharacters();
    } catch {
      readFailed = true;
    }

    if (readFailed) {
      set({
        characters: defaultCharacters,
        currentCharacterId: pickNextCurrentId(defaultCharacters, '', get().currentCharacterId) ?? defaultCharacters[0].id,
        charactersLoading: false,
      });
      return;
    }

    if (needsSeeding(stored)) {
      set({ characters: defaultCharacters });
      for (const c of defaultCharacters) {
        try {
          await characterDb.saveCharacter(c);
        } catch {
          toastSaveFailed();
        }
      }
    } else {
      set({ characters: stored });
    }

    const chars = get().characters;
    const corrected = pickNextCurrentId(chars, '', get().currentCharacterId) ?? chars[0]?.id ?? 'assistant';
    set({ currentCharacterId: corrected, charactersLoading: false });
  },

  createCharacter: async (input) => {
    const validation = validateName(input.name);
    if (!validation.ok) return;
    const newCharacter: Character = {
      id: generateCharacterId(get().characters),
      name: validation.value,
      systemPrompt: input.systemPrompt,
      description: input.description,
      avatar: input.avatar,
      voiceId: input.voiceId,
    };
    set((s) => ({ characters: [...s.characters, newCharacter] }));
    if (get().charactersPersistent) {
      try {
        await characterDb.saveCharacter(newCharacter);
      } catch {
        toastSaveFailed();
      }
    }
  },

  updateCharacter: async (id, input) => {
    const validation = validateName(input.name);
    if (!validation.ok) return;
    let updated: Character | undefined;
    set((s) => ({
      characters: s.characters.map((c) => {
        if (c.id === id) {
          updated = { ...c, name: validation.value, systemPrompt: input.systemPrompt, description: input.description, avatar: input.avatar, voiceId: input.voiceId };
          return updated;
        }
        return c;
      }),
    }));
    if (updated && get().charactersPersistent) {
      try {
        await characterDb.saveCharacter(updated);
      } catch {
        toastSaveFailed();
      }
    }
  },

  deleteCharacter: async (id) => {
    const { characters, currentCharacterId, charactersPersistent } = get();
    if (characters.length <= 1) {
      useToastStore.getState().addToast({ message: '至少需保留一个角色', type: 'warning' });
      return;
    }
    const target = characters.find((c) => c.id === id);
    if (!target) return;
    const nextChars = characters.filter((c) => c.id !== id);
    const nextId = currentCharacterId === id
      ? pickNextCurrentId(nextChars, id, currentCharacterId) ?? nextChars[0]?.id ?? 'assistant'
      : currentCharacterId;
    set({ characters: nextChars, currentCharacterId: nextId });
    if (charactersPersistent) {
      try {
        await characterDb.deleteCharacter(id);
      } catch {
        toastSaveFailed();
      }
    }
  },
}));
