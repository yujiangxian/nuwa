// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

/// 结构化错误提取 — 替代全项目中 `catch (err: any)` 模式。

/** Axios 错误或标准 Error 的结构化接口。 */
export interface ErrorDetail {
  message?: string;
  name?: string;
  code?: string;
  response?: {
    data?: {
      error?: string;
    };
    status?: number;
  };
}

/** 从 unknown 错误中提取人类可读消息。 */
export function errorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object') {
    const e = err as ErrorDetail;
    return e?.response?.data?.error || e?.message || fallback;
  }
  return fallback;
}
