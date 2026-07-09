// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUIStore } from '@/store/uiStore';
import { useI18n } from './useI18n';
import { resolveLocale, translate, LOCALE_LABELS } from '@/lib/i18n';

/**
 * 集成测试：useI18n（Req 4.1–4.3）。
 * 通过设置 settings.language 为各 Display_Label，断言解析出的 locale 与 t 的行为，
 * 并验证 settings.language 变更后 Hook 的响应式更新。
 */

beforeEach(() => {
  // 重置为默认语言，避免用例间相互影响。
  useUIStore.setState((s) => ({ settings: { ...s.settings, language: '简体中文' } }));
});

describe('useI18n', () => {
  it('Req 4.1/4.2: 由 settings.language 解析 locale 并提供绑定 t', () => {
    for (const label of Object.values(LOCALE_LABELS)) {
      act(() => {
        useUIStore.setState((s) => ({ settings: { ...s.settings, language: label } }));
      });
      const { result } = renderHook(() => useI18n());
      const expectedLocale = resolveLocale(label);
      expect(result.current.locale).toBe(expectedLocale);
      expect(result.current.t('settings.title')).toBe(translate(expectedLocale, 'settings.title'));
    }
  });

  it('Req 4.3: settings.language 变更后 locale/t 响应式更新', () => {
    const { result } = renderHook(() => useI18n());
    expect(result.current.locale).toBe('zh-CN');
    expect(result.current.t('settings.title')).toBe('设置');

    act(() => {
      useUIStore.getState().updateSetting('language', 'English');
    });
    expect(result.current.locale).toBe('en');
    expect(result.current.t('settings.title')).toBe('Settings');

    act(() => {
      useUIStore.getState().updateSetting('language', '日本語');
    });
    expect(result.current.locale).toBe('ja');
    expect(result.current.t('settings.title')).toBe('設定');
  });

  it('Req 2.3 接线：未知 language 回退默认语言', () => {
    act(() => {
      useUIStore.setState((s) => ({ settings: { ...s.settings, language: 'fr-FR' } }));
    });
    const { result } = renderHook(() => useI18n());
    expect(result.current.locale).toBe('zh-CN');
    expect(result.current.t('settings.title')).toBe('设置');
  });
});
