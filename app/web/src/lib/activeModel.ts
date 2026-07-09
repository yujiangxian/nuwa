// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

/**
 * model-management：活跃模型解析纯函数层。
 *
 * 从 ModelsPage 内联的 currentModels 合并表达式抽取，统一规则：
 * - 优先 current_models[type]，兼容旧字段 current_asr/tts/llm_model；
 * - 排除 null/undefined/空字符串；
 * - 每个 Model_Type 至多对应一个模型 id。
 *
 * 纯函数：不做 I/O。
 */

import { MODEL_TYPES } from '@/lib/modelTypes';
import type {
  ModelConfigView,
  ActiveModelMap,
  ModelType,
  InstalledModel,
} from '@/lib/modelTypes';

/** 旧字段（current_*_model）到 Model_Type 的映射。 */
const LEGACY_FIELD: Partial<Record<ModelType, keyof ModelConfigView>> = {
  asr: 'current_asr_model',
  tts: 'current_tts_model',
  llm: 'current_llm_model',
};

/** 判定值是否为有效模型 id（非空字符串）。 */
function isValidId(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/**
 * 从 config 解析 Active_Model_Map。
 * - 对每个 Model_Type，先取 current_models[type]，否则取旧字段；
 * - 排除 null/undefined/空字符串；
 * - undefined config 返回空映射；
 * - 结果为 Record<ModelType, modelId>，每类型至多一个 id（Record 语义保证）。
 */
export function parseActiveModelMap(config: ModelConfigView | undefined): ActiveModelMap {
  const result: ActiveModelMap = {};
  if (!config) return result;

  const currentMap = config.current_models ?? {};
  for (const type of MODEL_TYPES) {
    const fromMap = currentMap[type];
    if (isValidId(fromMap)) {
      result[type] = fromMap;
      continue;
    }
    const legacyKey = LEGACY_FIELD[type];
    if (legacyKey) {
      const fromLegacy = config[legacyKey];
      if (isValidId(fromLegacy)) {
        result[type] = fromLegacy;
      }
    }
  }
  return result;
}

/**
 * 给定已加载模型列表，解析某类型应渲染为活跃卡片的模型 id：
 * 当且仅当该类型选中的 id 存在于 models 中时返回该 id，否则返回 null。
 */
export function resolveActiveModelId(
  activeMap: ActiveModelMap,
  modelType: string,
  models: InstalledModel[],
): string | null {
  const id = activeMap[modelType as ModelType];
  if (!isValidId(id)) return null;
  return models.some((m) => m.id === id) ? id : null;
}
