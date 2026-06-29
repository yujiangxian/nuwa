import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUIStore } from '@/store/uiStore';
import { useLangEffect } from './useLangEffect';

/**
 * 集成测试：useLangEffect（Req 6.1–6.2）。
 * 验证初次挂载后 <html lang> 同步为当前 LocaleCode，且 settings.language 变更后更新。
 */

beforeEach(() => {
  useUIStore.setState((s) => ({ settings: { ...s.settings, language: '简体中文' } }));
  document.documentElement.removeAttribute('lang');
});

describe('useLangEffect', () => {
  it('Req 6.1: 初次挂载后将 <html lang> 设为当前 LocaleCode', () => {
    act(() => {
      useUIStore.setState((s) => ({ settings: { ...s.settings, language: 'English' } }));
    });
    renderHook(() => useLangEffect());
    expect(document.documentElement.lang).toBe('en');
  });

  it('Req 6.2: settings.language 变更后更新 <html lang>', () => {
    renderHook(() => useLangEffect());
    expect(document.documentElement.lang).toBe('zh-CN');

    act(() => {
      useUIStore.getState().updateSetting('language', '日本語');
    });
    expect(document.documentElement.lang).toBe('ja');

    act(() => {
      useUIStore.getState().updateSetting('language', 'English');
    });
    expect(document.documentElement.lang).toBe('en');
  });

  it('Req 6.2: 未知 language 回退默认 LocaleCode', () => {
    renderHook(() => useLangEffect());
    act(() => {
      useUIStore.getState().updateSetting('language', 'unknown-xyz');
    });
    expect(document.documentElement.lang).toBe('zh-CN');
  });
});
