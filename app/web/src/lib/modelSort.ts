/**
 * model-management：模型排序纯函数层。
 *
 * 从 ModelsPage 内联排序比较器抽取，行为逐位保持：
 * - 已安装模型：recent（last_used 降序，缺失记 0，tie 按 name 升序）/ name / size。
 * - 预设：installed（已下载优先，同组 name 升序）/ size / name。
 *
 * 纯函数：返回新数组，不修改入参。
 */

import type { InstalledModel, PresetModel, ModelMetaMap } from '@/lib/modelTypes';

export type InstalledSortBy = 'recent' | 'name' | 'size_desc' | 'size_asc';
export type PresetSortBy = 'installed' | 'size_desc' | 'size_asc' | 'name';

/**
 * 已安装模型排序（返回新数组）。
 * - 'name'：按 name 升序（localeCompare）。
 * - 'size_desc'/'size_asc'：按 size_mb 降/升序。
 * - 'recent'：按 meta.last_used 降序（缺失记 0）；相等时按 name 升序兜底。
 */
export function sortInstalled(
  models: InstalledModel[],
  sortBy: InstalledSortBy,
  meta: ModelMetaMap,
): InstalledModel[] {
  return [...models].sort((a, b) => {
    if (sortBy === 'recent') {
      const ta = meta[a.id]?.last_used || 0;
      const tb = meta[b.id]?.last_used || 0;
      if (ta !== tb) return tb - ta;
      return a.name.localeCompare(b.name);
    }
    if (sortBy === 'size_desc') return b.size_mb - a.size_mb;
    if (sortBy === 'size_asc') return a.size_mb - b.size_mb;
    return a.name.localeCompare(b.name);
  });
}

/**
 * 预设排序（返回新数组）。
 * - 'installed'：is_downloaded 为真者排前；同一安装状态内 name 升序。
 * - 'size_desc'/'size_asc'：按 size_mb 降/升序。
 * - 'name'：按 name 升序。
 */
export function sortPresets(presets: PresetModel[], sortBy: PresetSortBy): PresetModel[] {
  return [...presets].sort((a, b) => {
    if (sortBy === 'installed') {
      if (a.is_downloaded && !b.is_downloaded) return -1;
      if (!a.is_downloaded && b.is_downloaded) return 1;
      return a.name.localeCompare(b.name);
    }
    if (sortBy === 'size_desc') return b.size_mb - a.size_mb;
    if (sortBy === 'size_asc') return a.size_mb - b.size_mb;
    return a.name.localeCompare(b.name);
  });
}
