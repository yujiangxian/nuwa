import type { ContextBudget } from '@/lib/contextBudget';

interface UsageIndicatorProps {
  budget: ContextBudget;
}

/** Usage_State → 进度条 / 文本颜色映射。 */
const STATE_COLOR: Record<ContextBudget['usageState'], string> = {
  normal: 'var(--primary)',
  warning: '#D4AF37',
  over: '#FF6B6B',
};

/**
 * Usage_Indicator：在对话页展示当前上下文占用与上下文窗口的对比。
 * 无状态展示组件，全部数据来自 props.budget（由 ChatPage useMemo 派生）。
 */
export default function UsageIndicator({ budget }: UsageIndicatorProps) {
  const { usedTokens, contextLength, remainingTokens, usageRatio, usageState, isEstimated } =
    budget;
  const color = STATE_COLOR[usageState];
  const pct = Math.round(usageRatio * 100);

  return (
    <div
      data-testid="usage-indicator"
      data-usage-state={usageState}
      aria-label="上下文占用"
      className="flex items-center gap-2 px-4 md:px-8 py-1.5 text-[11px] shrink-0"
      style={{ color: 'var(--text-muted)' }}
    >
      <span className="shrink-0">上下文</span>
      <div
        className="relative h-1.5 flex-1 max-w-[160px] rounded-full overflow-hidden"
        style={{ background: 'var(--surface-hover)' }}
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span data-testid="usage-tokens" style={{ color }}>
        {isEstimated ? '~' : ''}
        {usedTokens} / {contextLength}
      </span>
      <span data-testid="usage-remaining" className="shrink-0">
        （剩余 {remainingTokens}）
      </span>
      {isEstimated && (
        <span
          data-testid="usage-estimated"
          title="该模型未提供上下文长度，当前为默认估算值"
          className="px-1.5 py-0.5 rounded shrink-0"
          style={{ background: 'rgba(212,175,55,0.12)', color: '#D4AF37' }}
        >
          估算
        </span>
      )}
    </div>
  );
}
