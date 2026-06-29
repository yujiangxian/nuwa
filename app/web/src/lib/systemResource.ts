/**
 * model-management：系统资源纯函数层。
 *
 * 从 ModelsPage（StatsBar/DiskBar/GpuBar）内联逻辑抽取，行为逐位保持：
 * - 已安装模型 size_mb 总和。
 * - 占用百分比分级（>90 high / >75 medium / 其余 normal）。
 *
 * 纯函数：不做 I/O。
 */

import type { InstalledModel, UsageLevel } from '@/lib/modelTypes';

/** 已安装模型 size_mb 之和；空列表返回 0。 */
export function totalInstalledSizeMb(models: InstalledModel[]): number {
  return models.reduce((sum, m) => sum + m.size_mb, 0);
}

/**
 * 占用百分比分级（与 DiskBar/GpuBar 的颜色阈值一致）：
 * - percent > 90：'high'
 * - 75 < percent <= 90：'medium'
 * - percent <= 75：'normal'
 */
export function usageLevel(percent: number): UsageLevel {
  if (percent > 90) return 'high';
  if (percent > 75) return 'medium';
  return 'normal';
}
