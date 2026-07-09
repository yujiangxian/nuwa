// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: markdown-message-rendering
//
// 任务 3.3 单元测试：错误隔离。
// 注入抛错子组件，断言：
//  - 回退态显示原始 Markdown_Source 文本（Req 8.1）；
//  - 错误边界外的兄弟元素仍正常渲染且可交互（Req 8.2）；
//  - 子组件不抛错时，children 正常渲染（不进入回退态）。
//
// _Requirements: 8.1, 8.2_
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MarkdownErrorBoundary from './MarkdownErrorBoundary';

/** 渲染期抛错的子组件，触发错误边界回退。 */
function ThrowingChild(): React.ReactElement {
  throw new Error('boom');
}

describe('MarkdownErrorBoundary - 错误隔离（Req 8.1, 8.2）', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('子组件抛错时回退显示原文，边界外兄弟元素仍正常渲染并可交互', () => {
    const onSiblingClick = vi.fn();

    render(
      <div>
        {/* 边界外的兄弟元素：渲染与交互都不应受边界内错误影响 */}
        <span data-testid="sibling">兄弟元素</span>
        <button data-testid="sibling-btn" onClick={onSiblingClick}>
          点我
        </button>

        <MarkdownErrorBoundary source={'# 标题\n保留\t空白'}>
          <ThrowingChild />
        </MarkdownErrorBoundary>
      </div>
    );

    // 回退显示原始 Markdown_Source（Req 8.1）。
    expect(screen.getByText('# 标题', { exact: false })).toBeInTheDocument();

    // 边界外兄弟元素仍正常渲染（Req 8.2）。
    expect(screen.getByTestId('sibling')).toHaveTextContent('兄弟元素');

    // 边界外兄弟元素仍可交互（Req 8.2）。
    fireEvent.click(screen.getByTestId('sibling-btn'));
    expect(onSiblingClick).toHaveBeenCalledTimes(1);
  });

  it('子组件未抛错时正常渲染 children，不进入回退态', () => {
    render(
      <MarkdownErrorBoundary source="原始源文本">
        <div data-testid="child-ok">正常内容</div>
      </MarkdownErrorBoundary>
    );

    expect(screen.getByTestId('child-ok')).toHaveTextContent('正常内容');
    // 未触发回退，不应渲染原始 source 文本作为兜底。
    expect(screen.queryByText('原始源文本')).not.toBeInTheDocument();
  });
});
