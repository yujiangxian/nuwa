// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useUIStore } from '@/store/uiStore';
import HomePage from '@/components/HomePage';

/**
 * Component tests for the HomePage character-management entry (task 6.6).
 * Req 8.1: a functional entry into Character_Manager exists.
 * Req 8.2: triggering it navigates to Character_Manager (/characters).
 */

beforeEach(() => {
  useUIStore.setState((s) => ({ currentPage: 'home', settings: { ...s.settings, language: '简体中文' } }));
});

describe('HomePage character-management entry', () => {
  it('renders the 角色管理 entry (Req 8.1)', () => {
    render(<HomePage />);
    expect(screen.getByText('角色管理')).toBeInTheDocument();
    expect(screen.getByText('创建与管理 AI 人设')).toBeInTheDocument();
  });

  it('navigates to the characters page when clicked (Req 8.2)', () => {
    render(<HomePage />);
    fireEvent.click(screen.getByRole('button', { name: /角色管理/ }));
    expect(useUIStore.getState().currentPage).toBe('characters');
  });
});

/**
 * Component tests for the prompt-preset-management HomePage entry (task 6.6).
 * Req 7.1: a functional entry into Preset_Manager exists on the Home_Page.
 * Req 7.2: triggering it navigates to Preset_Manager (/presets).
 */
describe('HomePage prompt-preset entry', () => {
  it('renders the 提示词 entry (Req 7.1)', () => {
    render(<HomePage />);
    expect(screen.getByText('提示词')).toBeInTheDocument();
    expect(screen.getByText('管理与复用常用提示词')).toBeInTheDocument();
  });

  it('navigates to the presets page when clicked (Req 7.2)', () => {
    render(<HomePage />);
    fireEvent.click(screen.getByRole('button', { name: /提示词/ }));
    expect(useUIStore.getState().currentPage).toBe('presets');
  });
});

/**
 * Multilingual rendering tests for HomePage feature cards (task 6.2).
 * Req 5.1: feature card titles/descriptions use translation lookup.
 * Req 5.3/5.4: en/ja render localized strings.
 * Req 5.5: missing key falls back without showing blanks.
 */
describe('HomePage 多语言渲染', () => {
  it('Req 5.1: 默认 zh-CN 渲染功能卡片中文标题与描述', () => {
    render(<HomePage />);
    expect(screen.getByText('智能对话')).toBeInTheDocument();
    expect(screen.getByText('与 AI 对话，用声音回复')).toBeInTheDocument();
    expect(screen.getByText('声音工坊')).toBeInTheDocument();
    expect(screen.getByText('多模型 AI 交互终端')).toBeInTheDocument();
  });

  it('Req 5.3: language=English 渲染英文文案', () => {
    useUIStore.setState((s) => ({ settings: { ...s.settings, language: 'English' } }));
    render(<HomePage />);
    expect(screen.getByText('Smart Chat')).toBeInTheDocument();
    expect(screen.getByText('Voice Studio')).toBeInTheDocument();
    expect(screen.getByText('Multi-model AI terminal')).toBeInTheDocument();
  });

  it('Req 5.4: language=日本語 渲染日文文案', () => {
    useUIStore.setState((s) => ({ settings: { ...s.settings, language: '日本語' } }));
    render(<HomePage />);
    expect(screen.getByText('スマートチャット')).toBeInTheDocument();
    expect(screen.getByText('ボイススタジオ')).toBeInTheDocument();
    expect(screen.getByText('マルチモデル AI ターミナル')).toBeInTheDocument();
  });

  it('Req 5.5: 未知 language 回退 zh-CN 文案，不空白', () => {
    useUIStore.setState((s) => ({ settings: { ...s.settings, language: 'unknown-locale' } }));
    render(<HomePage />);
    // 回退到 Default_Locale（zh-CN）文案，界面非空白。
    expect(screen.getByText('智能对话')).toBeInTheDocument();
  });
});
