// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useUIStore } from '@/store/uiStore';
import SettingsModal from '@/components/SettingsModal';
import { LOCALE_LABELS } from '@/lib/i18n';

/**
 * Component tests for SettingsModal multilingual labels (task 7.2).
 * Req 5.2: section labels use translation lookup.
 * Req 5.3/5.4: en/ja render localized labels.
 * 语言选择器选项展示 LOCALE_LABELS 值。
 */

beforeEach(() => {
  useUIStore.setState((s) => ({
    isSettingsOpen: true,
    settings: { ...s.settings, language: '简体中文' },
  }));
});

describe('SettingsModal 多语言区段标签', () => {
  it('Req 5.2: 默认 zh-CN 渲染中文区段标签', () => {
    render(<SettingsModal />);
    expect(screen.getByText('设置')).toBeInTheDocument();
    expect(screen.getByText('外观')).toBeInTheDocument();
    expect(screen.getByText('后端地址')).toBeInTheDocument();
    expect(screen.getByText('模型目录')).toBeInTheDocument();
    expect(screen.getByText('界面语言')).toBeInTheDocument();
    expect(screen.getByText('合成后自动播放')).toBeInTheDocument();
  });

  it('Req 5.3: language=English 渲染英文区段标签', () => {
    useUIStore.setState((s) => ({ settings: { ...s.settings, language: 'English' } }));
    render(<SettingsModal />);
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('Appearance')).toBeInTheDocument();
    expect(screen.getByText('Backend URL')).toBeInTheDocument();
    expect(screen.getByText('Models Directory')).toBeInTheDocument();
    expect(screen.getByText('Language')).toBeInTheDocument();
    expect(screen.getByText('Auto-play after synthesis')).toBeInTheDocument();
  });

  it('Req 5.4: language=日本語 渲染日文区段标签', () => {
    useUIStore.setState((s) => ({ settings: { ...s.settings, language: '日本語' } }));
    render(<SettingsModal />);
    expect(screen.getByText('設定')).toBeInTheDocument();
    expect(screen.getByText('外観')).toBeInTheDocument();
    expect(screen.getByText('バックエンド URL')).toBeInTheDocument();
    expect(screen.getByText('言語')).toBeInTheDocument();
  });

  it('语言选择器选项展示 LOCALE_LABELS 值', () => {
    render(<SettingsModal />);
    for (const label of Object.values(LOCALE_LABELS)) {
      expect(screen.getByRole('option', { name: label })).toBeInTheDocument();
    }
  });
});
