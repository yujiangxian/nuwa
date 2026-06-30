/// 提示词预设独立 store — 从 uiStore 拆分。

import { create } from 'zustand';
import { createPresetDb, type PresetDb } from '@/lib/promptPresetDb';
import { validatePreset, generatePresetId, buildInsertedText, INPUT_MAX_LENGTH } from '@/lib/promptPreset';
import { useToastStore } from '@/store/toastStore';
import { useUIStore } from '@/store/uiStore';
import type { PromptPreset } from './types';

function toastSaveFailed(): void {
  useToastStore.getState().addToast({ message: '预设保存失败', type: 'error' });
}

let presetDb: PresetDb = createPresetDb();

export function setPresetDbForTesting(db: PresetDb): void {
  presetDb = db;
}

interface PresetState {
  presets: PromptPreset[];
  presetsLoading: boolean;
  presetsPersistent: boolean;
  loadPresets: () => Promise<void>;
  createPreset: (rawTitle: string, rawContent: string) => Promise<void>;
  updatePreset: (id: string, rawTitle: string, rawContent: string) => Promise<void>;
  deletePreset: (id: string) => Promise<void>;
  insertPresetIntoInput: (id: string) => boolean;
}

export const usePresetStore = create<PresetState>((set, get) => ({
  presets: [],
  presetsLoading: true,
  presetsPersistent: true,

  loadPresets: async () => {
    set({ presetsLoading: true });
    try {
      await presetDb.init();
    } catch {
      set({ presets: [], presetsPersistent: false, presetsLoading: false });
      useToastStore.getState().addToast({ message: '预设无法保存', type: 'warning' });
      return;
    }
    let stored: PromptPreset[] = [];
    try { stored = await presetDb.getAllPresets(); } catch { /* read failed */ }
    if (stored.length === 0) {
      set({ presets: [], presetsLoading: false });
      return;
    }
    set({ presets: stored, presetsLoading: false });
  },

  createPreset: async (rawTitle, rawContent) => {
    const validation = validatePreset(rawTitle, rawContent);
    if (!validation.ok) return;
    const newPreset: PromptPreset = {
      id: generatePresetId(get().presets),
      title: validation.title,
      content: validation.content,
    };
    set((s) => ({ presets: [...s.presets, newPreset] }));
    if (get().presetsPersistent) {
      try { await presetDb.savePreset(newPreset); } catch { toastSaveFailed(); }
    }
  },

  updatePreset: async (id, rawTitle, rawContent) => {
    const validation = validatePreset(rawTitle, rawContent);
    if (!validation.ok) return;
    set((s) => ({
      presets: s.presets.map((p) =>
        p.id === id ? { ...p, title: validation.title, content: validation.content } : p
      ),
    }));
    if (get().presetsPersistent) {
      const updated = get().presets.find((p) => p.id === id);
      if (updated) {
        try { await presetDb.savePreset(updated); } catch { toastSaveFailed(); }
      }
    }
  },

  deletePreset: async (id) => {
    set((s) => ({ presets: s.presets.filter((p) => p.id !== id) }));
    if (get().presetsPersistent) {
      try { await presetDb.deletePreset(id); } catch { toastSaveFailed(); }
    }
  },

  insertPresetIntoInput: (id) => {
    const { inputText, setInputText } = useUIStore.getState();
    const preset = get().presets.find((p) => p.id === id);
    if (!preset) return false;
    const result = buildInsertedText(inputText, preset.content, INPUT_MAX_LENGTH);
    if (!result.ok) {
      useToastStore.getState().addToast({ message: '内容超出长度上限，无法插入', type: 'warning' });
      return false;
    }
    setInputText(result.text);
    return true;
  },
}));
