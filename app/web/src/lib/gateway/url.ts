// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

/** AI 网关 URL 纯函数。 */

/** 去掉首尾空白与末尾斜杠。 */
export function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

/**
 * Anthropic Messages 端点。兼容两种填法：
 * `https://api.anthropic.com` 与 `https://api.anthropic.com/v1`。
 */
export function anthropicMessagesUrl(base: string): string {
  const b = normalizeBaseUrl(base);
  return b.endsWith('/v1') ? `${b}/messages` : `${b}/v1/messages`;
}

/** Anthropic 模型列表端点（连通性探测用），同样兼容 /v1 后缀。 */
export function anthropicModelsUrl(base: string): string {
  const b = normalizeBaseUrl(base);
  return b.endsWith('/v1') ? `${b}/models` : `${b}/v1/models`;
}
