// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: command-palette — Keybinding_Engine 集成测试（任务 6.2，Req 1.1, 1.4, 1.6, 6.1-6.5）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useKeybindings } from './useKeybindings';
import { useUIStore } from '@/store/uiStore';

function Host() {
  useKeybindings();
  return <input data-testid="editable" />;
}

/** 在 document 上派发一个可取消的 keydown 事件，返回是否被 preventDefault。 */
function dispatchKey(init: KeyboardEventInit): boolean {
  const event = new KeyboardEvent('keydown', { cancelable: true, bubbles: true, ...init });
  document.dispatchEvent(event);
  return event.defaultPrevented;
}

describe('useKeybindings', () => {
  beforeEach(() => {
    useUIStore.setState({ paletteOpen: false, isSettingsOpen: false });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('挂载注册 keydown 监听器、卸载移除（Req 6.1, 6.5）', () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const { unmount } = render(<Host />);
    expect(addSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
    const handler = addSpy.mock.calls.find((c) => c[0] === 'keydown')?.[1];
    unmount();
    expect(removeSpy).toHaveBeenCalledWith('keydown', handler);
  });

  it('mod+k 切换面板开关并 preventDefault（Req 1.1, 1.4, 1.6）', () => {
    render(<Host />);
    // jsdom 平台判定为 'other' → mod = ctrl。
    const prevented1 = dispatchKey({ key: 'k', ctrlKey: true });
    expect(useUIStore.getState().paletteOpen).toBe(true);
    expect(prevented1).toBe(true);

    const prevented2 = dispatchKey({ key: 'k', ctrlKey: true });
    expect(useUIStore.getState().paletteOpen).toBe(false);
    expect(prevented2).toBe(true);
  });

  it('Editable_Target 守卫：聚焦 input 时裸 k 不触发、mod+k 仍触发（Req 6.3）', () => {
    const { getByTestId } = render(<Host />);
    const input = getByTestId('editable') as HTMLInputElement;
    input.focus();
    expect(document.activeElement).toBe(input);

    // 裸 'k'：可编辑控件聚焦且无 ctrl/meta → 不触发。
    dispatchKey({ key: 'k' });
    expect(useUIStore.getState().paletteOpen).toBe(false);

    // 'ctrl+k'：含 ctrl 修饰 → 仍触发。
    dispatchKey({ key: 'k', ctrlKey: true });
    expect(useUIStore.getState().paletteOpen).toBe(true);
  });

  it('Escape 关闭最上层模态：面板优先于设置（Req 1.2, 6.4）', () => {
    render(<Host />);
    // 面板与设置同时打开 → Escape 先关面板。
    useUIStore.setState({ paletteOpen: true, isSettingsOpen: true });
    dispatchKey({ key: 'Escape' });
    expect(useUIStore.getState().paletteOpen).toBe(false);
    expect(useUIStore.getState().isSettingsOpen).toBe(true);

    // 再次 Escape → 关设置。
    dispatchKey({ key: 'Escape' });
    expect(useUIStore.getState().isSettingsOpen).toBe(false);
  });
});
