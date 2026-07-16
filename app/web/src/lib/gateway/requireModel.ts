// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

/** 外部 Agent 必须显式填写模型 ID，禁止静默伪造默认名。 */
export function requireExternalModel(model: string | undefined | null): string {
  const trimmed = typeof model === 'string' ? model.trim() : '';
  if (!trimmed) {
    throw new Error('请填写模型 ID');
  }
  return trimmed;
}

/** probe 用：空模型返回失败结果而非抛错。 */
export function probeRequireModel(model: string | undefined | null): string | null {
  const trimmed = typeof model === 'string' ? model.trim() : '';
  return trimmed || null;
}
