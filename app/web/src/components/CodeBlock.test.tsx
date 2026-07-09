// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: markdown-message-rendering
//
// 任务 4.2 单元测试：CodeBlock 复制按钮与语言标签。
//  - mock navigator.clipboard.writeText：点击复制调用 writeText 且参数为 rawCode；
//    成功后图标/文案切换为「已复制」；失败（reject）时 toast error（Req 6.1-6.4）；
//  - 有 language 时显示 Language_Label，无 language 时不显示（Req 5.3, 5.5）；
//  - <pre> 容器 overflow-x: auto（Req 5.1, 5.2）；
//  - 多代码块场景按钮数匹配（Req 6.1）。
//
// _Requirements: 5.1, 5.2, 5.3, 5.5, 6.1, 6.2, 6.3, 6.4_
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { installMockClipboard } from '@/test/setup';
import { useToastStore } from '@/store/toastStore';
import CodeBlock from './CodeBlock';

beforeEach(() => {
  // 重置 toast store，避免跨用例污染。
  useToastStore.setState({ toasts: [] });
});

describe('CodeBlock - 复制按钮与语言标签', () => {
  it('点击复制调用 writeText 且参数为 rawCode，成功后文案/图标切换为「已复制」并发 success toast（Req 6.1-6.3）', async () => {
    const writeText = installMockClipboard();
    const raw = "const a = 1;\nconsole.log(a);";

    render(
      <CodeBlock language="ts" rawCode={raw}>
        <span>highlighted</span>
      </CodeBlock>
    );

    const copyBtn = screen.getByRole('button', { name: /复制/ });
    fireEvent.click(copyBtn);

    // 复制参数为 rawCode 源码（不含语言标签/高亮标记）。
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(raw);
    });

    // 成功后文案切换为「已复制」。
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '已复制' })).toBeInTheDocument();
    });

    // 成功 toast。
    const toasts = useToastStore.getState().toasts;
    expect(toasts.some((t) => t.type === 'success' && t.message === '代码已复制')).toBe(true);
  });

  it('writeText reject 时发 error toast，且文案保持「复制」（Req 6.4）', async () => {
    const writeText = installMockClipboard();
    writeText.mockRejectedValueOnce(new Error('clipboard denied'));

    render(
      <CodeBlock language="js" rawCode="x">
        <span>x</span>
      </CodeBlock>
    );

    fireEvent.click(screen.getByRole('button', { name: /复制/ }));

    await waitFor(() => {
      const toasts = useToastStore.getState().toasts;
      expect(toasts.some((t) => t.type === 'error' && t.message === '复制失败')).toBe(true);
    });

    // 失败时不切换为已复制态。
    expect(screen.queryByRole('button', { name: '已复制' })).not.toBeInTheDocument();
  });

  it('有 language 时显示 Language_Label（Req 5.3）', () => {
    const { container } = render(
      <CodeBlock language="python" rawCode="print(1)">
        <span>print(1)</span>
      </CodeBlock>
    );

    expect(screen.getByText('python')).toBeInTheDocument();
    // code 元素带 language-x 类。
    expect(container.querySelector('code')?.className).toContain('language-python');
  });

  it('无 language 时不显示 Language_Label（Req 5.5）', () => {
    const { container } = render(
      <CodeBlock rawCode="plain text">
        <span>plain text</span>
      </CodeBlock>
    );

    // 工具条左侧标签 span 文本为空（不展示语言标识）。
    const label = container.querySelector('span.font-mono');
    expect(label).not.toBeNull();
    expect(label?.textContent).toBe('');
    // code 元素不含 language-* 类。
    expect(container.querySelector('code')?.className).not.toContain('language-');
  });

  it('<pre> 容器具水平滚动 overflow-x: auto（Req 5.1, 5.2）', () => {
    const { container } = render(
      <CodeBlock language="ts" rawCode="x">
        <span>x</span>
      </CodeBlock>
    );

    const pre = container.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre?.style.overflowX).toBe('auto');
  });

  it('多代码块场景复制按钮数与代码块数匹配（Req 6.1）', () => {
    render(
      <div>
        <CodeBlock language="ts" rawCode="a">
          <span>a</span>
        </CodeBlock>
        <CodeBlock language="js" rawCode="b">
          <span>b</span>
        </CodeBlock>
        <CodeBlock rawCode="c">
          <span>c</span>
        </CodeBlock>
      </div>
    );

    expect(screen.getAllByRole('button', { name: /复制/ })).toHaveLength(3);
  });
});
