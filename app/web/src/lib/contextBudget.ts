/**
 * context-window-management：Context_Budget 纯函数层。
 *
 * 依据 Context_Length、System_Prompt、对话消息与 Reserved_Response_Tokens 计算
 * Used_Tokens / Remaining_Tokens / Usage_Ratio / Usage_State。纯函数、确定性。
 */

import type { ChatMessage } from '@/store/uiStore';
import type { ChatGenParams } from '@/lib/generationParams';
import { estimateText, estimateMessages } from '@/lib/tokenEstimate';

/** Reserved_Response_Tokens 不可由 Num_Predict 确定时采用的缺省预留值（tokens）。 */
export const DEFAULT_RESERVED_TOKENS = 512;

/** 判定 warning 的占用比例阈值。 */
export const WARNING_THRESHOLD = 0.8;

export type UsageState = 'normal' | 'warning' | 'over';

export interface ContextBudget {
  /** 已占用 token 数 = System_Prompt + 全部对话消息。 */
  usedTokens: number;
  /** 为模型回复预留的 token 数。 */
  reservedTokens: number;
  /** 剩余可用 token 数 = contextLength - used - reserved（可为负）。 */
  remainingTokens: number;
  /** 占用比例 = clamp((used + reserved) / contextLength, 0, 1)。 */
  usageRatio: number;
  /** 占用等级。 */
  usageState: UsageState;
  /** 解析所得上下文长度（正整数）。 */
  contextLength: number;
  /** contextLength 是否为估算（默认值）。 */
  isEstimated: boolean;
}

function clamp(v: number, min: number, max: number): number {
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

/**
 * 由 Num_Predict 解析 Reserved_Response_Tokens：
 * numPredict 为 Active 且其值为正整数时取该值，否则（Inactive、-1、非正、非整）取默认值。
 */
export function resolveReservedTokens(params: ChatGenParams): number {
  const np = params?.numPredict;
  if (np && np.active && Number.isInteger(np.value) && np.value > 0) {
    return np.value;
  }
  return DEFAULT_RESERVED_TOKENS;
}

/**
 * 计算 Context_Budget。systemPrompt 缺省按空串处理。
 * Usage_State 顺序判定：
 *   1. used + reserved > contextLength → 'over'
 *   2. 否则 usageRatio >= WARNING_THRESHOLD → 'warning'
 *   3. 否则 → 'normal'
 */
export function computeBudget(input: {
  contextLength: number;
  isEstimated: boolean;
  systemPrompt: string;
  messages: ChatMessage[];
  reservedTokens: number;
}): ContextBudget {
  const { contextLength, isEstimated, systemPrompt, messages, reservedTokens } = input;

  const usedTokens = estimateText(systemPrompt ?? '') + estimateMessages(messages);
  const remainingTokens = contextLength - usedTokens - reservedTokens;
  const usageRatio = clamp((usedTokens + reservedTokens) / contextLength, 0, 1);

  let usageState: UsageState;
  if (usedTokens + reservedTokens > contextLength) {
    usageState = 'over';
  } else if (usageRatio >= WARNING_THRESHOLD) {
    usageState = 'warning';
  } else {
    usageState = 'normal';
  }

  return {
    usedTokens,
    reservedTokens,
    remainingTokens,
    usageRatio,
    usageState,
    contextLength,
    isEstimated,
  };
}
