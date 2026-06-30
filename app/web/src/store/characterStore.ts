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
  { id: 'assistant', name: '小助手', avatar: 'linear-gradient(135deg, #48CAE4, #0096C7)', systemPrompt: '你是一个有用的AI助手。', voiceId: 'jyy', description: '通用问答' },
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
