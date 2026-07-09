// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

/**
 * model-management：已安装模型删除资格纯函数层。
 *
 * 从 ModelsPage（ModelCard 的 isOllama 判定与删除控件可见性）抽取：
 * Ollama 模型不可删除，其余可删除。
 *
 * 纯函数：不做 I/O。
 */

import type { InstalledModel } from '@/lib/modelTypes';

/** 是否为 Ollama 管理的模型（source === 'ollama'）。 */
export function isOllamaModel(model: InstalledModel): boolean {
  return model.source === 'ollama';
}

/** 删除资格：当且仅当不是 Ollama_Model 时可删除。 */
export function canDeleteModel(model: InstalledModel): boolean {
  return !isOllamaModel(model);
}
