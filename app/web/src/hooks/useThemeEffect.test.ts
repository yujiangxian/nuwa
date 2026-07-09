// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { act } from 'react';
import { installMockMatchMedia, type MockMediaQueryList } from '@/test/setup';
import { useUIStore } from '@/store/uiStore';
import { useThemeEffect } from './useThemeEffect';

function setTheme(theme: 'dark' | 'light' | 'system'): void {
  act(() => {
    useUIStore.getState().updateSetting('theme', theme);
  });
}

describe('useThemeEffect', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  afterEach(() => {
    // 还原到默认主题，避免测试间状态泄漏。
    useUIStore.getState().updateSetting('theme', 'dark');
    vi.restoreAllMocks();
  });

  it('初次挂载即写入正确 data-theme（light）', () => {
    installMockMatchMedia({ prefersDark: true });
    useUIStore.setState((s) => ({ settings: { ...s.settings, theme: 'light' } }));
    renderHook(() => useThemeEffect());
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it("theme 'dark' → 'light' 同步更新（不刷新页面）", () => {
    installMockMatchMedia({ prefersDark: true });
    useUIStore.setState((s) => ({ settings: { ...s.settings, theme: 'dark' } }));
    renderHook(() => useThemeEffect());
    expect(document.documentElement.dataset.theme).toBe('dark');

    setTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it("theme 'system' 时 change 事件跟随系统偏好更新", () => {
    const mql = installMockMatchMedia({ prefersDark: false });
    useUIStore.setState((s) => ({ settings: { ...s.settings, theme: 'system' } }));
    renderHook(() => useThemeEffect());
    // 初始系统偏好浅色 → light
    expect(document.documentElement.dataset.theme).toBe('light');

    // 系统切换为偏好深色 → dark
    act(() => mql.dispatch(true));
    expect(document.documentElement.dataset.theme).toBe('dark');

    // 系统切回浅色 → light
    act(() => mql.dispatch(false));
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it("'system' → 'dark' 后 change 不再改变且 removeEventListener 被调用", () => {
    const mql: MockMediaQueryList = installMockMatchMedia({ prefersDark: false });
    useUIStore.setState((s) => ({ settings: { ...s.settings, theme: 'system' } }));
    renderHook(() => useThemeEffect());
    expect(document.documentElement.dataset.theme).toBe('light');

    // 切到锁定 dark：应移除监听。
    setTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(mql.removeEventListener).toHaveBeenCalled();

    // 再触发系统变化，锁定主题不应受影响。
    act(() => mql.dispatch(true));
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('matchMedia 缺失时不抛错并回退默认（system → light）', () => {
    // 不安装 matchMedia mock；删除可能存在的实现。
    // @ts-expect-error 故意移除以模拟缺失
    delete window.matchMedia;
    useUIStore.setState((s) => ({ settings: { ...s.settings, theme: 'system' } }));
    expect(() => renderHook(() => useThemeEffect())).not.toThrow();
    // getSystemPrefersDark 回退 false → system 解析为 light
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
