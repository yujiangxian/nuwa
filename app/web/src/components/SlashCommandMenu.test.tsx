// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SlashCommandMenu from '@/components/SlashCommandMenu';
import type { CommandItem } from '@/lib/slashCommand';

/**
 * Component tests for SlashCommandMenu（展示层，Task 4.2）。
 * 覆盖：列表渲染与高亮（Req 4.1）、点击选中回调（Req 4.7）、悬停回调、空列表不渲染（Req 4.2）。
 */

const items: CommandItem[] = [
  { kind: 'builtin', commandKey: 'clear', title: '/clear', description: '清空当前输入' },
  { kind: 'preset', commandKey: 'greeting', title: 'Greeting', description: 'Hello', presetId: 'p1' },
];

describe('SlashCommandMenu', () => {
  it('渲染过滤后的命令并标记高亮项（Req 4.1）', () => {
    render(<SlashCommandMenu items={items} highlightIndex={1} onSelect={vi.fn()} onHover={vi.fn()} />);
    expect(screen.getByTestId('slash-command-menu')).toBeInTheDocument();
    expect(screen.getByTestId('slash-command-item-0')).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByTestId('slash-command-item-1')).toHaveAttribute('aria-selected', 'true');
  });

  it('点击某条命令调用 onSelect 并传入该项（Req 4.7）', () => {
    const onSelect = vi.fn();
    render(<SlashCommandMenu items={items} highlightIndex={0} onSelect={onSelect} onHover={vi.fn()} />);
    fireEvent.mouseDown(screen.getByTestId('slash-command-item-0'));
    expect(onSelect).toHaveBeenCalledWith(items[0]);
  });

  it('悬停某条命令调用 onHover 并传入其下标', () => {
    const onHover = vi.fn();
    render(<SlashCommandMenu items={items} highlightIndex={0} onSelect={vi.fn()} onHover={onHover} />);
    fireEvent.mouseEnter(screen.getByTestId('slash-command-item-1'));
    expect(onHover).toHaveBeenCalledWith(1);
  });

  it('空列表不渲染菜单（Req 4.2）', () => {
    render(<SlashCommandMenu items={[]} highlightIndex={-1} onSelect={vi.fn()} onHover={vi.fn()} />);
    expect(screen.queryByTestId('slash-command-menu')).not.toBeInTheDocument();
  });
});
