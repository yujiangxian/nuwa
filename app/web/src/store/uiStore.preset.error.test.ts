import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useUIStore, setPresetDbForTesting, type PromptPreset } from '@/store/uiStore';
import type { PresetDb } from '@/lib/promptPresetDb';
import { useToastStore } from '@/store/toastStore';

/**
 * Error / degradation unit tests for the Preset_Store actions (task 4.5).
 * Each case injects a Preset_DB stub that rejects at a specific stage and
 * asserts the documented fallback behaviour (Requirements 8.1–8.4).
 */

/** Build a Preset_DB stub whose methods resolve unless overridden. */
function createStubPresetDb(overrides: Partial<PresetDb> = {}): PresetDb {
  return {
    init: async () => {},
    getAllPresets: async () => [],
    savePreset: async () => {},
    deletePreset: async () => {},
    ...overrides,
  };
}

/** Reset the store's preset slice and the toast queue to a clean state. */
function resetStore(): void {
  useUIStore.setState({
    presets: [],
    presetsLoading: true,
    presetsPersistent: true,
  });
  useToastStore.setState({ toasts: [] });
}

beforeEach(resetStore);
afterEach(resetStore);

describe('Preset_Store error handling', () => {
  it('init 失败 → 进入 Memory_Fallback_Mode（presetsPersistent=false、presets=[]、提示「预设无法保存」）', async () => {
    // Requirements: 8.1, 8.2
    const db = createStubPresetDb({
      init: async () => {
        throw new Error('indexeddb unavailable');
      },
    });
    setPresetDbForTesting(db);

    await useUIStore.getState().loadPresets();

    const s = useUIStore.getState();
    expect(s.presetsPersistent).toBe(false);
    expect(s.presets).toEqual([]);
    expect(s.presetsLoading).toBe(false);
    expect(useToastStore.getState().toasts.some((t) => t.message === '预设无法保存')).toBe(true);
  });

  it('Memory_Fallback_Mode 下写操作不触碰持久层且不报「保存失败」', async () => {
    // Requirements: 8.1, 8.2 —— 降级后仍可在内存中维护 presets
    let saveCalled = false;
    const db = createStubPresetDb({
      init: async () => {
        throw new Error('indexeddb unavailable');
      },
      savePreset: async () => {
        saveCalled = true;
      },
    });
    setPresetDbForTesting(db);

    await useUIStore.getState().loadPresets();
    await useUIStore.getState().createPreset('标题', '内容');

    const s = useUIStore.getState();
    // 内存中维护新建的预设。
    expect(s.presets.length).toBe(1);
    expect(s.presets[0].title).toBe('标题');
    expect(s.presets[0].content).toBe('内容');
    // 降级模式下不走持久化路径，也不会触发「保存失败」提示。
    expect(saveCalled).toBe(false);
    expect(useToastStore.getState().toasts.some((t) => t.message === '保存失败')).toBe(false);
  });

  it('读取失败（init 成功但 getAllPresets reject）→ 以空 presets 继续运行（保持 presetsPersistent=true）', async () => {
    // Requirements: 8.3
    const db = createStubPresetDb({
      init: async () => {},
      getAllPresets: async () => {
        throw new Error('read failed');
      },
    });
    setPresetDbForTesting(db);

    await useUIStore.getState().loadPresets();

    const s = useUIStore.getState();
    expect(s.presetsPersistent).toBe(true); // init 成功，仍处于持久模式
    expect(s.presets).toEqual([]); // 读取失败按空集合继续
    expect(s.presetsLoading).toBe(false);
  });

  it('写入失败（savePreset reject，新建）→ 保留内存中的 presets 状态并提示「保存失败」', async () => {
    // Requirements: 8.4
    const db = createStubPresetDb({
      savePreset: async () => {
        throw new Error('write failed');
      },
    });
    setPresetDbForTesting(db);
    useUIStore.setState({ presets: [], presetsPersistent: true, presetsLoading: false });

    await useUIStore.getState().createPreset('我的标题', '我的内容');

    const s = useUIStore.getState();
    // 内存状态保留：新建的预设仍在 presets 中。
    expect(s.presets.length).toBe(1);
    expect(s.presets[0].title).toBe('我的标题');
    expect(s.presets[0].content).toBe('我的内容');
    expect(useToastStore.getState().toasts.some((t) => t.message === '保存失败')).toBe(true);
  });

  it('写入失败（savePreset reject，编辑）→ 保留内存中更新后的 presets 状态并提示「保存失败」', async () => {
    // Requirements: 8.4
    const db = createStubPresetDb({
      savePreset: async () => {
        throw new Error('write failed');
      },
    });
    setPresetDbForTesting(db);
    const existing: PromptPreset = { id: 'p1', title: '旧标题', content: '旧内容' };
    useUIStore.setState({ presets: [existing], presetsPersistent: true, presetsLoading: false });

    await useUIStore.getState().updatePreset('p1', '新标题', '新内容');

    const s = useUIStore.getState();
    // 内存中保留更新后的字段（id 不变）。
    const updated = s.presets.find((p) => p.id === 'p1');
    expect(updated).toBeDefined();
    expect(updated!.title).toBe('新标题');
    expect(updated!.content).toBe('新内容');
    expect(useToastStore.getState().toasts.some((t) => t.message === '保存失败')).toBe(true);
  });

  it('写入失败（deletePreset reject）→ 保留内存中已移除该项的 presets 状态并提示「保存失败」', async () => {
    // Requirements: 8.4
    const db = createStubPresetDb({
      deletePreset: async () => {
        throw new Error('write failed');
      },
    });
    setPresetDbForTesting(db);
    const a: PromptPreset = { id: 'a', title: '甲', content: '甲内容' };
    const b: PromptPreset = { id: 'b', title: '乙', content: '乙内容' };
    useUIStore.setState({ presets: [a, b], presetsPersistent: true, presetsLoading: false });

    await useUIStore.getState().deletePreset('a');

    const s = useUIStore.getState();
    // 内存状态保留删除结果：'a' 已移除、'b' 保留（UI 不回退）。
    expect(s.presets.find((p) => p.id === 'a')).toBeUndefined();
    expect(s.presets.find((p) => p.id === 'b')).toEqual(b);
    expect(useToastStore.getState().toasts.some((t) => t.message === '保存失败')).toBe(true);
  });
});
