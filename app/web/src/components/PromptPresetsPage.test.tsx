// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  useUIStore,
  setPresetDbForTesting,
  type PromptPreset,
} from '@/store/uiStore';
import type { PresetDb } from '@/lib/promptPresetDb';
import { TITLE_MAX_LENGTH, CONTENT_MAX_LENGTH } from '@/lib/promptPreset';

/**
 * Component tests for PromptPresetsPage (task 6.5).
 *
 * Covers: list render of title/content + order (Req 2.1/2.3), empty state
 * (Req 2.2); form controls + title/content maxLength (Req 3.1/3.8/3.9),
 * create reflected in list (Req 3.5), empty-field disabled submit + prompt
 * (Req 3.6/3.7/4.3/4.4), edit reflected in list (Req 4.5); delete two-step
 * confirm/cancel + list removal (Req 5.1/5.3/5.4); fallback notice when
 * presetsPersistent=false (Req 8.2).
 */

const mocks = vi.hoisted(() => ({
  addToast: vi.fn(),
}));

vi.mock('@/store/toastStore', () => {
  const useToastStore: any = (selector: any) => selector({ addToast: mocks.addToast });
  useToastStore.getState = () => ({ addToast: mocks.addToast });
  return { useToastStore };
});

import PromptPresetsPage from '@/components/PromptPresetsPage';

/** Simple in-memory Preset_DB so store actions succeed without IndexedDB. */
function makeFakeDb(): PresetDb {
  const map = new Map<string, PromptPreset>();
  return {
    init: vi.fn(async () => {}),
    getAllPresets: vi.fn(async () => [...map.values()]),
    savePreset: vi.fn(async (p: PromptPreset) => { map.set(p.id, p); }),
    deletePreset: vi.fn(async (id: string) => { map.delete(id); }),
  };
}

const basePresets: PromptPreset[] = [
  { id: 'p1', title: '翻译助手', content: '请把下面的内容翻译成英文：' },
  { id: 'p2', title: '代码审查', content: '请审查以下代码并指出潜在问题：' },
];

beforeEach(() => {
  vi.clearAllMocks();
  setPresetDbForTesting(makeFakeDb());
  useUIStore.setState({
    presets: basePresets.map((p) => ({ ...p })),
    presetsLoading: false,
    presetsPersistent: true,
  });
});

describe('PromptPresetsPage list rendering', () => {
  it('renders title and content for each preset (Req 2.1)', () => {
    render(<PromptPresetsPage />);
    expect(screen.getByText('翻译助手')).toBeInTheDocument();
    expect(screen.getByText('请把下面的内容翻译成英文：')).toBeInTheDocument();
    expect(screen.getByText('代码审查')).toBeInTheDocument();
    expect(screen.getByText('请审查以下代码并指出潜在问题：')).toBeInTheDocument();
  });

  it('renders presets in the store order (Req 2.3)', () => {
    render(<PromptPresetsPage />);
    const titles = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(titles).toEqual(['翻译助手', '代码审查']);
  });

  it('shows the empty state when there are no presets (Req 2.2)', () => {
    useUIStore.setState({ presets: [] });
    render(<PromptPresetsPage />);
    expect(screen.getByText('还没有预设，点击新建一条')).toBeInTheDocument();
  });
});

describe('PromptPresetsPage create form', () => {
  it('exposes the form controls and enforces title/content maxLength (Req 3.1/3.8/3.9)', () => {
    render(<PromptPresetsPage />);
    fireEvent.click(screen.getByRole('button', { name: '新建预设' }));

    const titleInput = screen.getByLabelText('预设标题') as HTMLInputElement;
    const contentInput = screen.getByLabelText('预设内容') as HTMLTextAreaElement;
    expect(titleInput).toBeInTheDocument();
    expect(contentInput).toBeInTheDocument();
    expect(titleInput.maxLength).toBe(TITLE_MAX_LENGTH);
    expect(contentInput.maxLength).toBe(CONTENT_MAX_LENGTH);
  });

  it('creates a preset and reflects it in the list (Req 3.5)', async () => {
    render(<PromptPresetsPage />);
    fireEvent.click(screen.getByRole('button', { name: '新建预设' }));

    fireEvent.change(screen.getByLabelText('预设标题'), { target: { value: '摘要生成' } });
    fireEvent.change(screen.getByLabelText('预设内容'), { target: { value: '请用三句话总结：' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));

    await waitFor(() => expect(screen.getByText('摘要生成')).toBeInTheDocument());
    expect(screen.getByText('请用三句话总结：')).toBeInTheDocument();
  });

  it('disables submit and shows prompts when fields are blank (Req 3.6/3.7)', async () => {
    render(<PromptPresetsPage />);
    fireEvent.click(screen.getByRole('button', { name: '新建预设' }));

    const submit = screen.getByRole('button', { name: '创建' }) as HTMLButtonElement;
    // Both fields empty -> submit disabled.
    expect(submit.disabled).toBe(true);

    // Whitespace-only entries keep submit disabled and surface prompts.
    fireEvent.change(screen.getByLabelText('预设标题'), { target: { value: '   ' } });
    fireEvent.change(screen.getByLabelText('预设内容'), { target: { value: '   ' } });
    expect(submit.disabled).toBe(true);

    fireEvent.click(submit);
    expect(await screen.findByText('请填写标题')).toBeInTheDocument();
    expect(screen.getByText('请填写内容')).toBeInTheDocument();
    // No new preset created.
    expect(useUIStore.getState().presets.length).toBe(2);
  });
});

describe('PromptPresetsPage edit form', () => {
  it('edits a preset and reflects the updated title/content (Req 4.5)', async () => {
    render(<PromptPresetsPage />);
    fireEvent.click(screen.getByRole('button', { name: '编辑翻译助手' }));

    const titleInput = screen.getByLabelText('预设标题') as HTMLInputElement;
    const contentInput = screen.getByLabelText('预设内容') as HTMLTextAreaElement;
    expect(titleInput.value).toBe('翻译助手');
    expect(contentInput.value).toBe('请把下面的内容翻译成英文：');

    fireEvent.change(titleInput, { target: { value: '中英互译' } });
    fireEvent.change(contentInput, { target: { value: '请在中英文之间互译：' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(screen.getByText('中英互译')).toBeInTheDocument());
    expect(screen.getByText('请在中英文之间互译：')).toBeInTheDocument();
    expect(screen.queryByText('翻译助手')).not.toBeInTheDocument();
  });

  it('disables submit and shows prompts when edited fields are blank (Req 4.3/4.4)', async () => {
    render(<PromptPresetsPage />);
    fireEvent.click(screen.getByRole('button', { name: '编辑翻译助手' }));

    fireEvent.change(screen.getByLabelText('预设标题'), { target: { value: '  ' } });
    fireEvent.change(screen.getByLabelText('预设内容'), { target: { value: '  ' } });

    const submit = screen.getByRole('button', { name: '保存' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.click(submit);
    expect(await screen.findByText('请填写标题')).toBeInTheDocument();
    expect(screen.getByText('请填写内容')).toBeInTheDocument();
    // Preset unchanged.
    expect(useUIStore.getState().presets.find((p) => p.id === 'p1')?.title).toBe('翻译助手');
  });
});

describe('PromptPresetsPage delete', () => {
  it('shows two-step confirm and deletes only after confirmation (Req 5.1/5.4)', async () => {
    render(<PromptPresetsPage />);
    fireEvent.click(screen.getByRole('button', { name: '删除翻译助手' }));
    // Confirm controls appear; nothing deleted yet (Req 5.1).
    expect(screen.getByText('确认删除?')).toBeInTheDocument();
    expect(useUIStore.getState().presets.length).toBe(2);

    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    await waitFor(() => expect(screen.queryByText('翻译助手')).not.toBeInTheDocument());
    expect(useUIStore.getState().presets.find((p) => p.id === 'p1')).toBeUndefined();
  });

  it('keeps the preset when the confirm is cancelled (Req 5.3)', () => {
    render(<PromptPresetsPage />);
    fireEvent.click(screen.getByRole('button', { name: '删除翻译助手' }));
    fireEvent.click(screen.getByRole('button', { name: '取消删除' }));
    expect(screen.getByText('翻译助手')).toBeInTheDocument();
    expect(useUIStore.getState().presets.length).toBe(2);
  });
});

describe('PromptPresetsPage fallback notice', () => {
  it('shows the non-persistent notice when presetsPersistent is false (Req 8.2)', () => {
    useUIStore.setState({ presetsPersistent: false });
    render(<PromptPresetsPage />);
    expect(screen.getByText('预设无法保存')).toBeInTheDocument();
  });

  it('does not show the notice when presetsPersistent is true (Req 8.2)', () => {
    render(<PromptPresetsPage />);
    expect(screen.queryByText('预设无法保存')).not.toBeInTheDocument();
  });
});
