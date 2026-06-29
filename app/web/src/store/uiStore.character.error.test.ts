import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  useUIStore,
  defaultCharacters,
  setCharacterDbForTesting,
  type Character,
} from '@/store/uiStore';
import type { CharacterDb } from '@/lib/characterDb';

/**
 * Error / degradation unit tests for the Character_Store (task 4.7).
 *
 * Covers the four Character_DB failure branches (Req 9.1–9.4):
 *  - init failure        -> Memory_Fallback_Mode (charactersPersistent=false,
 *                           Default_Characters in memory, warning toast)
 *  - read failure        -> Default_Characters in memory, stays persistent
 *  - write (save) failure -> in-memory state preserved + "保存失败" toast
 *  - delete failure       -> in-memory state preserved + "保存失败" toast
 *
 * The toast store is mocked so we can assert the user-facing messages.
 */

const mocks = vi.hoisted(() => ({ addToast: vi.fn() }));

vi.mock('@/store/toastStore', () => {
  const useToastStore: any = (selector: any) => selector({ addToast: mocks.addToast });
  useToastStore.getState = () => ({ addToast: mocks.addToast });
  return { useToastStore };
});

/** A Character_DB stub whose individual methods can be made to reject. */
function makeStubDb(overrides: Partial<CharacterDb>): CharacterDb {
  return {
    init: async () => {},
    getAllCharacters: async () => [],
    saveCharacter: async () => {},
    deleteCharacter: async () => {},
    ...overrides,
  };
}

const sampleStored: Character[] = [
  { id: 'a', name: '甲', avatar: 'linear-gradient(135deg, #48CAE4, #0096C7)', systemPrompt: 'pa', voiceId: 'jyy', description: 'da' },
  { id: 'b', name: '乙', avatar: 'linear-gradient(135deg, #FF6B9D, #D44D7A)', systemPrompt: 'pb', voiceId: '', description: 'db' },
];

beforeEach(() => {
  vi.clearAllMocks();
  useUIStore.setState({
    characters: [],
    currentCharacterId: 'assistant',
    charactersLoading: true,
    charactersPersistent: true,
  });
});

describe('Character_Store init failure (Req 9.1/9.2)', () => {
  it('enters Memory_Fallback_Mode with Default_Characters and warns the user', async () => {
    setCharacterDbForTesting(makeStubDb({ init: async () => { throw new Error('no idb'); } }));

    await useUIStore.getState().loadCharacters();

    const state = useUIStore.getState();
    expect(state.charactersPersistent).toBe(false);
    expect(state.characters).toEqual(defaultCharacters);
    expect(state.charactersLoading).toBe(false);
    // currentCharacterId points to an existing default character.
    expect(state.characters.some((c) => c.id === state.currentCharacterId)).toBe(true);
    expect(mocks.addToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: '角色无法保存', type: 'warning' }),
    );
  });
});

describe('Character_Store read failure (Req 9.3)', () => {
  it('falls back to Default_Characters in memory while staying persistent', async () => {
    setCharacterDbForTesting(
      makeStubDb({ getAllCharacters: async () => { throw new Error('read fail'); } }),
    );

    await useUIStore.getState().loadCharacters();

    const state = useUIStore.getState();
    expect(state.characters).toEqual(defaultCharacters);
    expect(state.charactersPersistent).toBe(true);
    expect(state.charactersLoading).toBe(false);
    expect(state.characters.some((c) => c.id === state.currentCharacterId)).toBe(true);
  });
});

describe('Character_Store write failures (Req 9.4)', () => {
  it('preserves the created character in memory and toasts on save failure', async () => {
    setCharacterDbForTesting(
      makeStubDb({
        getAllCharacters: async () => sampleStored.map((c) => ({ ...c })),
        saveCharacter: async () => { throw new Error('save fail'); },
      }),
    );

    await useUIStore.getState().loadCharacters();
    mocks.addToast.mockClear();

    const before = useUIStore.getState().characters.length;
    await useUIStore.getState().createCharacter({
      name: '新角色',
      systemPrompt: 'p',
      description: 'd',
      avatar: 'linear-gradient(135deg, #52B788, #40916C)',
      voiceId: '',
    });

    const state = useUIStore.getState();
    // In-memory state preserved (not rolled back) even though persistence failed.
    expect(state.characters.length).toBe(before + 1);
    expect(state.characters.some((c) => c.name === '新角色')).toBe(true);
    expect(mocks.addToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: '保存失败', type: 'error' }),
    );
  });

  it('preserves remaining characters in memory and toasts on delete failure', async () => {
    setCharacterDbForTesting(
      makeStubDb({
        getAllCharacters: async () => sampleStored.map((c) => ({ ...c })),
        deleteCharacter: async () => { throw new Error('delete fail'); },
      }),
    );

    await useUIStore.getState().loadCharacters();
    mocks.addToast.mockClear();

    await useUIStore.getState().deleteCharacter('a');

    const state = useUIStore.getState();
    // Character removed from memory; persistence failure does not restore it.
    expect(state.characters.find((c) => c.id === 'a')).toBeUndefined();
    expect(state.characters.find((c) => c.id === 'b')).toBeDefined();
    expect(mocks.addToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: '保存失败', type: 'error' }),
    );
  });
});
