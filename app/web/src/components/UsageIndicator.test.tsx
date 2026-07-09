// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import UsageIndicator from '@/components/UsageIndicator';
import type { ContextBudget } from '@/lib/contextBudget';

function makeBudget(overrides: Partial<ContextBudget> = {}): ContextBudget {
  return {
    usedTokens: 100,
    reservedTokens: 512,
    remainingTokens: 3484,
    usageRatio: 0.15,
    usageState: 'normal',
    contextLength: 4096,
    isEstimated: false,
    ...overrides,
  };
}

describe('UsageIndicator', () => {
  // Req 5.1：展示 used / contextLength 占比与进度条
  it('shows used/context tokens and a progressbar', () => {
    render(<UsageIndicator budget={makeBudget()} />);
    expect(screen.getByTestId('usage-tokens').textContent).toContain('100 / 4096');
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  // Req 5.2：三态对应不同 data-usage-state
  it('reflects usageState normal / warning / over', () => {
    const { rerender } = render(<UsageIndicator budget={makeBudget({ usageState: 'normal' })} />);
    expect(screen.getByTestId('usage-indicator').getAttribute('data-usage-state')).toBe('normal');

    rerender(<UsageIndicator budget={makeBudget({ usageState: 'warning', usageRatio: 0.85 })} />);
    expect(screen.getByTestId('usage-indicator').getAttribute('data-usage-state')).toBe('warning');

    rerender(<UsageIndicator budget={makeBudget({ usageState: 'over', usageRatio: 1 })} />);
    expect(screen.getByTestId('usage-indicator').getAttribute('data-usage-state')).toBe('over');
  });

  // Req 5.3：isEstimated 显示估算标记
  it('shows estimated badge when isEstimated', () => {
    const { rerender } = render(<UsageIndicator budget={makeBudget({ isEstimated: false })} />);
    expect(screen.queryByTestId('usage-estimated')).toBeNull();

    rerender(<UsageIndicator budget={makeBudget({ isEstimated: true })} />);
    expect(screen.getByTestId('usage-estimated')).toBeInTheDocument();
  });

  // Req 5.4：budget 变化后重渲染呈现更新值
  it('re-renders updated used/remaining on budget change', () => {
    const { rerender } = render(<UsageIndicator budget={makeBudget()} />);
    expect(screen.getByTestId('usage-remaining').textContent).toContain('3484');

    rerender(
      <UsageIndicator
        budget={makeBudget({ usedTokens: 2000, remainingTokens: 1584, usageRatio: 0.61 })}
      />,
    );
    expect(screen.getByTestId('usage-tokens').textContent).toContain('2000 / 4096');
    expect(screen.getByTestId('usage-remaining').textContent).toContain('1584');
  });
});
