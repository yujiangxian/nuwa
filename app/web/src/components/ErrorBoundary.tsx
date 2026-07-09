// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { Component, type ReactNode } from 'react';
import { useUIStore } from '@/store/uiStore';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  /**
   * Configurable error-reporting hook. Consumers can wire it to external services:
   *
   *   ErrorBoundary.onError = (err, info) => { Sentry.captureException(err); };
   *   ErrorBoundary.onError = (err, info) => { postToAnalytics(err.message); };
   *
   * Set it once at app bootstrap. Set to `null` to disable.
   */
  static onError: ((error: Error, errorInfo: React.ErrorInfo) => void) | null = null;

  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info);
    ErrorBoundary.onError?.(error, info);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    // Reset to home page
    try {
      const store = useUIStore.getState?.();
      if (store) store.setPage('home');
    } catch { /* ignore */ }
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-screen w-screen flex flex-col items-center justify-center relative" style={{ zIndex: 10, background: 'var(--bg)' }}>
          <div className="text-center px-6">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5" style={{ background: 'rgba(255,107,107,0.1)', border: '1px solid rgba(255,107,107,0.15)' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#FF6B6B" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>
            </div>
            <h1 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>页面出错了</h1>
            <p className="text-sm mb-6 max-w-xs mx-auto" style={{ color: 'var(--text-secondary)' }}>
              {this.state.error?.message || '未知错误，请尝试刷新页面'}
            </p>
            <button
              onClick={this.handleReset}
              className="px-5 py-2.5 rounded-xl text-sm font-medium cursor-pointer transition-all"
              style={{
                background: 'linear-gradient(135deg, var(--primary), var(--primary-dim))',
                color: 'var(--bg)',
                border: 'none',
                boxShadow: '0 0 20px var(--primary-glow)',
              }}
            >
              刷新页面
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
