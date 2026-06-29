/**
 * model-management：模型筛选纯函数层。
 *
 * 从 ModelsPage 内联的 `filteredModels`/`filteredPresets` 抽取，行为逐位保持：
 * - 已安装模型按类型筛选（'all' 恒等）。
 * - 预设按关键词（不区分大小写，匹配 name/description/note）+ 类型筛选。
 *
 * 纯函数：不修改入参、不做 I/O。
 */

import type { InstalledModel, PresetModel, ModelTypeFilter } from '@/lib/modelTypes';

/**
 * 已安装模型按类型筛选。
 * - filter 为某具体 Model_Type：返回 `model_type` 等于该类型的子集。
 * - filter 为 'all'：返回与输入等长、逐元素相同的列表。
 */
export function filterInstalledByType(
  models: InstalledModel[],
  filter: ModelTypeFilter,
): InstalledModel[] {
  if (filter === 'all') return models.filter(() => true);
  return models.filter((m) => m.model_type === filter);
}

/**
 * 预设筛选：关键词 + 类型。
 * - query 不区分大小写匹配 `name`/`description`/`note`；空字符串不施加关键词约束。
 * - typeFilter 为某具体类型时按 `model_type` 过滤；为 'all' 时不按类型过滤。
 */
export function filterPresets(
  presets: PresetModel[],
  query: string,
  typeFilter: ModelTypeFilter,
): PresetModel[] {
  const q = query.toLowerCase();
  return presets.filter((p) => {
    const matchesSearch =
      !q ||
      p.name.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      (!!p.note && p.note.toLowerCase().includes(q));
    const matchesFilter = typeFilter === 'all' || p.model_type === typeFilter;
    return matchesSearch && matchesFilter;
  });
}
