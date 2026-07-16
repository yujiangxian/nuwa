// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: command-palette — CommandPalette 组件测试（任务 7.2，Req 1.2, 1.3, 1.5, 4, 5, 8）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CommandPalette from './CommandPalette';
import { useUIStore } from '@/store/uiStore';

/** 重置面板与注入 mock 副作用 actions。 */
function setupStore() {
  const setPage = vi.fn();
  const setSettingsOpen = vi.fn();
  const updateSetting = vi.fn();
  const createSession = vi.fn(() => Promise.resolve());
  useUIStore.setState({
    paletteOpen: false,
    paletteQuery: '',
    highlightIndex: -1,
    currentAgentId: 'assistant',
    setPage,
    setSettingsOpen,
    updateSetting,
    createSession,
  });
  return { setPage, setSettingsOpen, updateSetting, createSession };
}

/** 在 act 中打开面板，确保 React 重渲染与 effect 刷新。 */
function openPalette() {
  act(() => {
    useUIStore.getState().openPalette();
  });
}

/** 在 act 中设置查询，确保重渲染与高亮规整 effect 刷新。 */
function setQuery(q: string) {
  act(() => {
    useUIStore.getState().setPaletteQuery(q);
  });
}

beforeEach(() => {
  setupStore();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('CommandPalette — 渲染', () => {
  it('paletteOpen=false 不渲染', () => {
    const { container } = render(<CommandPalette />);
    expect(container.firstChild).toBeNull();
  });

  it('paletteOpen=true 渲染搜索框 + 分组列表（Req 8.1, 8.6）', () => {
    render(<CommandPalette />);
    openPalette();
    expect(screen.getByLabelText('搜索命令')).toBeInTheDocument();
    expect(screen.getByText('导航')).toBeInTheDocument();
    expect(screen.getByText('外观')).toBeInTheDocument();
    expect(screen.getByText('会话')).toBeInTheDocument();
  });
});

describe('CommandPalette — 展示', () => {
  it('显示 title、带 combo 命令显示组合文本（Req 8.2, 8.3）', () => {
    render(<CommandPalette />);
    openPalette();
    expect(screen.getByText('前往 首页')).toBeInTheDocument();
    expect(screen.getByText('新建对话')).toBeInTheDocument();
    // 新建对话命令带 combo（jsdom 平台 'other' → ctrl+n）。
    expect(screen.getByText('ctrl+n')).toBeInTheDocument();
  });

  it('打开时高亮落到首项（Req 1.3）', () => {
    render(<CommandPalette />);
    openPalette();
    expect(useUIStore.getState().highlightIndex).toBe(0);
    const first = document.querySelector('[data-command-id="nav.home"]');
    expect(first?.getAttribute('data-active')).toBe('true');
  });

  it('无匹配显示空状态（Req 8.5）', () => {
    render(<CommandPalette />);
    openPalette();
    setQuery('zzzzzznotexist');
    expect(screen.getByText('无匹配命令')).toBeInTheDocument();
  });
});

describe('CommandPalette — 键盘交互', () => {
  it('输入过滤命令（Req 8.1）', async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);
    openPalette();
    const input = screen.getByLabelText('搜索命令');
    await user.type(input, 'home');
    expect(screen.getByText('前往 首页')).toBeInTheDocument();
    expect(screen.queryByText('前往 对话')).not.toBeInTheDocument();
  });

  it('ArrowDown/ArrowUp 移动并回绕（Req 4.1, 4.2）', () => {
    render(<CommandPalette />);
    openPalette();
    const input = screen.getByLabelText('搜索命令');
    expect(useUIStore.getState().highlightIndex).toBe(0);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(useUIStore.getState().highlightIndex).toBe(1);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(useUIStore.getState().highlightIndex).toBe(0);
    // 回绕：在首项向上 → 末尾。
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(useUIStore.getState().highlightIndex).toBeGreaterThan(0);
  });

  it('Enter 执行高亮项 run 并关闭（Req 4.4, 5.6）', () => {
    const { setPage } = setupStore();
    render(<CommandPalette />);
    openPalette();
    const input = screen.getByLabelText('搜索命令');
    // 高亮首项 nav.home。
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(setPage).toHaveBeenCalledWith('home');
    expect(useUIStore.getState().paletteOpen).toBe(false);
  });

  it('空结果 Enter 不执行且保持打开（Req 4.5）', () => {
    const { setPage } = setupStore();
    render(<CommandPalette />);
    openPalette();
    setQuery('zzzzznope');
    const input = screen.getByLabelText('搜索命令');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(setPage).not.toHaveBeenCalled();
    expect(useUIStore.getState().paletteOpen).toBe(true);
  });

  it('Escape 关闭（Req 1.2）', () => {
    render(<CommandPalette />);
    openPalette();
    const input = screen.getByLabelText('搜索命令');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(useUIStore.getState().paletteOpen).toBe(false);
  });

  it('遮罩外点击关闭（Req 1.5）', () => {
    render(<CommandPalette />);
    openPalette();
    const overlay = screen.getByRole('dialog');
    fireEvent.mouseDown(overlay);
    expect(useUIStore.getState().paletteOpen).toBe(false);
  });

  it('打开时 query 重置为空（Req 1.3）', () => {
    act(() => {
      useUIStore.setState({ paletteQuery: 'stale' });
    });
    render(<CommandPalette />);
    openPalette();
    expect(useUIStore.getState().paletteQuery).toBe('');
  });
});

describe('CommandPalette — 副作用接线（Req 5.1-5.5）', () => {
  it('打开设置命令 run 调用 setSettingsOpen(true)', () => {
    const { setSettingsOpen } = setupStore();
    render(<CommandPalette />);
    openPalette();
    fireEvent.click(document.querySelector('[data-command-id="settings.open"]')!);
    expect(setSettingsOpen).toHaveBeenCalledWith(true);
  });

  it('主题命令 run 调用 updateSetting("theme", ...)', () => {
    const { updateSetting } = setupStore();
    render(<CommandPalette />);
    openPalette();
    fireEvent.click(document.querySelector('[data-command-id="theme.light"]')!);
    expect(updateSetting).toHaveBeenCalledWith('theme', 'light');
  });

  it('语言命令 run 调用 updateSetting("language", ...)', () => {
    const { updateSetting } = setupStore();
    render(<CommandPalette />);
    openPalette();
    fireEvent.click(document.querySelector('[data-command-id="locale.en"]')!);
    expect(updateSetting).toHaveBeenCalledWith('language', 'English');
  });

  it('新建会话命令 run 调用 createSession + setPage("chat")', () => {
    const { createSession, setPage } = setupStore();
    render(<CommandPalette />);
    openPalette();
    fireEvent.click(document.querySelector('[data-command-id="session.new"]')!);
    expect(createSession).toHaveBeenCalledWith('assistant');
    expect(setPage).toHaveBeenCalledWith('chat');
  });
});
