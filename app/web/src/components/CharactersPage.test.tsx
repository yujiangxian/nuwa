// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  useUIStore,
  setCharacterDbForTesting,
  type Character,
} from '@/store/uiStore';
import { useCharacterStore } from '@/store/characterStore';
import type { CharacterDb } from '@/lib/characterDb';

/**
 * Component tests for CharactersPage (task 6.5).
 *
 * Covers: list render of name/description/avatar + bound voice name (Req 3.1/3.2),
 * voice loading & error states (Req 3.3/3.4); form controls + name maxLength
 * (Req 4.1/4.7), create reflected in list (Req 4.5), empty-name prompt without
 * create/update (Req 4.6/5.3), edit reflected in list (Req 5.4); delete two-step
 * confirm/cancel (Req 6.1/6.3) and unique-character disabled prompt (Req 6.4);
 * voice dropdown source & empty-value option (Req 7.1/7.2/7.4).
 */

const mocks = vi.hoisted(() => ({
  voices: { data: [] as any[], isLoading: false, isError: false },
  addToast: vi.fn(),
}));

vi.mock('@/hooks/useApi', () => ({
  useVoices: () => mocks.voices,
}));

vi.mock('@/store/toastStore', () => {
  const useToastStore: any = (selector: any) => selector({ addToast: mocks.addToast });
  useToastStore.getState = () => ({ addToast: mocks.addToast });
  return { useToastStore };
});

import CharactersPage from '@/components/CharactersPage';

/** Simple in-memory Character_DB so store actions succeed without IndexedDB. */
function makeFakeDb(): CharacterDb {
  const map = new Map<string, Character>();
  return {
    init: vi.fn(async () => {}),
    getAllCharacters: vi.fn(async () => [...map.values()]),
    saveCharacter: vi.fn(async (c: Character) => { map.set(c.id, c); }),
    deleteCharacter: vi.fn(async (id: string) => { map.delete(id); }),
  };
}

const baseCharacters: Character[] = [
  { id: 'assistant', name: '季莹莹', avatar: 'linear-gradient(135deg, #8090FF, #4050C0)', systemPrompt: '你是季莹莹，无常司的白无常。', voiceId: 'jyy', description: '无常司白无常·鬼火少女' },
  { id: 'socrates', name: '苏格拉底', avatar: 'linear-gradient(135deg, #FF6B9D, #D44D7A)', systemPrompt: '提问引导', voiceId: 'unknown-voice', description: '苏式提问' },
];

const sampleVoices = [
  { id: 'jyy', name: '佳怡音色', path: '/voices/jyy.wav', transcript: '你好', sample_rate: 24000 },
  { id: 'narrator', name: '旁白君', path: '/voices/narrator.wav', transcript: '旁白', sample_rate: 24000 },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.voices = { data: sampleVoices, isLoading: false, isError: false };
  setCharacterDbForTesting(makeFakeDb());
  useUIStore.setState({
    characters: baseCharacters.map((c) => ({ ...c })),
    currentCharacterId: 'assistant',
    charactersLoading: false,
    charactersPersistent: true,
  });
  useCharacterStore.setState({
    characters: baseCharacters.map((c) => ({ ...c })),
    currentCharacterId: 'assistant',
    charactersLoading: false,
    charactersPersistent: true,
  });
});

describe('CharactersPage list rendering', () => {
  it('renders name, description and bound voice name for each character (Req 3.1/3.2)', () => {
    render(<CharactersPage />);
    expect(screen.getByText('季莹莹')).toBeInTheDocument();
    expect(screen.getByText('无常司白无常·鬼火少女')).toBeInTheDocument();
    // jyy resolves to its display name.
    expect(screen.getByText('音色：佳怡音色')).toBeInTheDocument();
    // avatar swatch rendered.
    expect(screen.getByTestId('avatar-assistant')).toBeInTheDocument();
  });

  it('shows 默认音色 placeholder when voiceId has no matching voice (Req 7.3)', () => {
    render(<CharactersPage />);
    expect(screen.getByText('音色：默认音色')).toBeInTheDocument();
  });

  it('shows the loading state while voices are loading (Req 3.3)', () => {
    mocks.voices = { data: [], isLoading: true, isError: false };
    render(<CharactersPage />);
    expect(screen.getByText('音色加载中…')).toBeInTheDocument();
    // Characters still render.
    expect(screen.getByText('季莹莹')).toBeInTheDocument();
  });

  it('shows the error state but still renders characters (Req 3.4)', () => {
    mocks.voices = { data: [], isLoading: false, isError: true };
    render(<CharactersPage />);
    expect(screen.getByText('音色加载失败')).toBeInTheDocument();
    expect(screen.getByText('季莹莹')).toBeInTheDocument();
  });
});

describe('CharactersPage create form', () => {
  it('exposes the form controls and enforces the name maxLength (Req 4.1/4.7)', () => {
    render(<CharactersPage />);
    fireEvent.click(screen.getByRole('button', { name: '新建角色' }));

    const nameInput = screen.getByLabelText('角色名称') as HTMLInputElement;
    expect(nameInput).toBeInTheDocument();
    expect(nameInput.maxLength).toBe(20);
    expect(screen.getByLabelText('人设提示词')).toBeInTheDocument();
    expect(screen.getByLabelText('角色描述')).toBeInTheDocument();
    expect(screen.getByLabelText('绑定音色')).toBeInTheDocument();
  });

  it('creates a character and reflects it in the list (Req 4.5)', async () => {
    render(<CharactersPage />);
    fireEvent.click(screen.getByRole('button', { name: '新建角色' }));

    fireEvent.change(screen.getByLabelText('角色名称'), { target: { value: '诗人' } });
    fireEvent.change(screen.getByLabelText('人设提示词'), { target: { value: '你是一位诗人' } });
    fireEvent.change(screen.getByLabelText('角色描述'), { target: { value: '吟诗作对' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));

    await waitFor(() => expect(screen.getByText('诗人')).toBeInTheDocument());
    expect(screen.getByText('吟诗作对')).toBeInTheDocument();
  });

  it('shows 请填写名称 and does not create when the name is blank (Req 4.6)', async () => {
    render(<CharactersPage />);
    fireEvent.click(screen.getByRole('button', { name: '新建角色' }));

    fireEvent.change(screen.getByLabelText('角色名称'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));

    expect(await screen.findByText('请填写名称')).toBeInTheDocument();
    // No new character: still exactly the two base characters.
    expect(useUIStore.getState().characters.length).toBe(2);
  });

  it('offers a no-binding empty option plus all voices in the dropdown (Req 7.1/7.2/7.4)', () => {
    render(<CharactersPage />);
    fireEvent.click(screen.getByRole('button', { name: '新建角色' }));

    const select = screen.getByLabelText('绑定音色') as HTMLSelectElement;
    const options = Array.from(select.options);
    // First option is the empty (no-binding) value.
    expect(options[0].value).toBe('');
    // Each real voice present as an option.
    expect(options.some((o) => o.value === 'jyy')).toBe(true);
    expect(options.some((o) => o.value === 'narrator')).toBe(true);
  });
});

describe('CharactersPage edit form', () => {
  it('edits a character and reflects the updated fields (Req 5.4)', async () => {
    render(<CharactersPage />);
    fireEvent.click(screen.getByRole('button', { name: '编辑季莹莹' }));

    const nameInput = screen.getByLabelText('角色名称') as HTMLInputElement;
    expect(nameInput.value).toBe('季莹莹');
    fireEvent.change(nameInput, { target: { value: '超级助手' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(screen.getByText('超级助手')).toBeInTheDocument());
    expect(screen.queryByText('季莹莹')).not.toBeInTheDocument();
  });

  it('shows 请填写名称 and does not update when edited name is blank (Req 5.3)', async () => {
    render(<CharactersPage />);
    fireEvent.click(screen.getByRole('button', { name: '编辑季莹莹' }));

    fireEvent.change(screen.getByLabelText('角色名称'), { target: { value: '  ' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(await screen.findByText('请填写名称')).toBeInTheDocument();
    // Character unchanged.
    expect(useUIStore.getState().characters.find((c) => c.id === 'assistant')?.name).toBe('季莹莹');
  });
});

describe('CharactersPage delete', () => {
  it('deletes after the two-step confirm (Req 6.1)', async () => {
    render(<CharactersPage />);
    fireEvent.click(screen.getByRole('button', { name: '删除季莹莹' }));
    // Confirm controls appear; nothing deleted yet.
    expect(useUIStore.getState().characters.length).toBe(2);

    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    await waitFor(() => expect(screen.queryByText('季莹莹')).not.toBeInTheDocument());
    expect(useUIStore.getState().characters.find((c) => c.id === 'assistant')).toBeUndefined();
  });

  it('does not delete when the confirm is cancelled (Req 6.3)', () => {
    render(<CharactersPage />);
    fireEvent.click(screen.getByRole('button', { name: '删除季莹莹' }));
    fireEvent.click(screen.getByRole('button', { name: '取消删除' }));
    expect(screen.getByText('季莹莹')).toBeInTheDocument();
    expect(useUIStore.getState().characters.length).toBe(2);
  });

  it('disables delete and shows the prompt for the only character (Req 6.4)', () => {
    useUIStore.setState({ characters: [baseCharacters[0]] });
    render(<CharactersPage />);
    const delBtn = screen.getByRole('button', { name: '删除季莹莹' }) as HTMLButtonElement;
    expect(delBtn.disabled).toBe(true);
    expect(screen.getByText('至少需保留一个角色')).toBeInTheDocument();
  });
});
