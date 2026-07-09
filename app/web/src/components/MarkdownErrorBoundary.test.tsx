// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: markdown-message-rendering, Property 9: 渲染失败回退保留原文与空白
//
// 任务 3.2 属性测试：当 Markdown 渲染失败（Render_Failure）触发回退时，
// 回退渲染出的可见文本应等于原始 Markdown_Source，且换行与空白被保留
// （white-space: pre-wrap）。
//
// Validates: Requirements 8.3
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import fc from 'fast-check';
import MarkdownErrorBoundary from './MarkdownErrorBoundary';

/**
 * 会在渲染期抛错的子组件，用于触发 MarkdownErrorBoundary 的回退态。
 * 返回值不可达，仅为满足组件类型签名。
 */
function ThrowingChild(): React.ReactElement {
  throw new Error('render failure');
}

describe('MarkdownErrorBoundary - Property 9 渲染失败回退保留原文与空白', () => {
  // React 错误边界捕获错误时会向 console.error 打印噪声，测试期静默以保持输出整洁。
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('回退文本等于原始 source 且保留换行/空白（white-space: pre-wrap）', () => {
    fc.assert(
      fc.property(
        // 生成含换行、空格、制表符等空白的随机源文本（混合普通文本片段与空白片段）。
        fc
          .array(
            fc.oneof(
              fc.string(),
              fc.constantFrom('\n', '\n\n', '  ', '\t', ' \n ', '   ')
            ),
            { minLength: 1, maxLength: 12 }
          )
          .map((parts) => parts.join('')),
        (source) => {
          const { container, unmount } = render(
            <MarkdownErrorBoundary source={source}>
              <ThrowingChild />
            </MarkdownErrorBoundary>
          );

          try {
            // 回退后整体可见文本等于原始 Markdown_Source（含换行/空白原样保留）。
            expect(container.textContent).toBe(source);

            // 回退节点为保留空白的 <p>，white-space 为 pre-wrap。
            const p = container.querySelector('p');
            expect(p).not.toBeNull();
            expect(p?.style.whiteSpace).toBe('pre-wrap');
          } finally {
            // fast-check 多轮迭代须手动卸载，避免 DOM 累积影响后续断言。
            unmount();
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
