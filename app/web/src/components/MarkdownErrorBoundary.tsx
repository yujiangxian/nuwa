// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: markdown-message-rendering
// 每条消息独立的 Markdown 渲染错误边界（Req 8.1, 8.2, 8.3）。
//
// 与全局 ErrorBoundary 不同：全局边界会导航回首页并刷新整页；
// 本边界仅就地把单条消息回退为保留换行/空白的原始 Markdown_Source，
// 不影响聊天页面其余部分的交互。
//
// 设计参考：.kiro/specs/markdown-message-rendering/design.md
//   「Components and Interfaces · 4. MarkdownErrorBoundary」
import { Component, type ReactNode } from 'react';

interface Props {
  /** Markdown_Source：消息原始文本，回退态下原样展示。 */
  source: string;
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export default class MarkdownErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error('MarkdownErrorBoundary caught:', error);
  }

  componentDidUpdate(prevProps: Props) {
    // source 变化时（流式逐字更新）重置错误态，让后续帧有机会重新渲染，
    // 避免一次瞬时不完整状态导致整条消息永久回退（流式重试，Req 3.2/8）。
    if (this.state.hasError && prevProps.source !== this.props.source) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      // 回退：保留换行与空白的原始 Markdown_Source（Req 8.1, 8.3）。
      return (
        <p
          className="text-sm leading-relaxed"
          style={{ whiteSpace: 'pre-wrap', color: 'var(--text-primary)' }}
        >
          {this.props.source}
        </p>
      );
    }
    return this.props.children;
  }
}
