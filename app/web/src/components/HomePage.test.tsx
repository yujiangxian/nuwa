// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useUIStore } from '@/store/uiStore';
import HomePage from '@/components/HomePage';

/**
 * Component tests for the HomePage Agent entry (character management merged into Agent).
 */

beforeEach(() => {
  useUIStore.setState((s) => ({ currentPage: 'home', settings: { ...s.settings, language: '简体中文' } }));
});

describe('HomePage Agent entry', () => {
  it('renders the Agent entry', () => {
    render(<HomePage />);
    expect(screen.getByText('Agent')).toBeInTheDocument();
    expect(screen.getByText('定义本地 / 工作流 / 外部智能体；对话页选用')).toBeInTheDocument();
  });

  it('navigates to the agents page when clicked', () => {
    render(<HomePage />);
    fireEvent.click(screen.getByRole('button', { name: /Agent/ }));
    expect(useUIStore.getState().currentPage).toBe('agents');
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
