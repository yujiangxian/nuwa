// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

/**
 * context-window-management：Context_Resolver 纯函数层。
 *
 * 解析 Active_Model 的 Context_Length。由于当前 InstalledModel 元数据未携带上下文
 * 长度字段，本函数接受一个「候选上下文长度」（可选数值），无法获知时回退到
 * Default_Context_Length 并标记为估算值（Is_Estimated）。
 *
 * 纯函数：仅做数值校验，无 I/O。
 */

/** 当 Active_Model 的 Context_Length 无法获知时采用的缺省值（tokens）。 */
export const DEFAULT_CONTEXT_LENGTH = 4096;

export interface ContextLengthResolution {
  /** 解析后的上下文长度，恒为正整数。 */
  contextLength: number;
  /** true 表示当前所用 contextLength 来自默认值（估算）而非模型已知值。 */
  isEstimated: boolean;
}

/**
 * 解析 Active_Model 的 Context_Length。
 * - candidate 为正整数 → { contextLength: candidate, isEstimated: false }
 * - 否则（undefined / null / NaN / Infinity / 0 / 负数 / 小数）
 *   → { contextLength: DEFAULT_CONTEXT_LENGTH, isEstimated: true }
 *
 * 返回的 contextLength 恒大于 0。
 */
export function resolveContextLength(
  candidate: number | null | undefined,
): ContextLengthResolution {
  if (typeof candidate === 'number' && Number.isInteger(candidate) && candidate > 0) {
    return { contextLength: candidate, isEstimated: false };
  }
  return { contextLength: DEFAULT_CONTEXT_LENGTH, isEstimated: true };
}
