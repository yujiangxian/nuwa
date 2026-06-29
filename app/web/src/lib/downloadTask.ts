/**
 * model-management：下载任务纯函数层。
 *
 * 进度钳制、状态分类、操作资格、活跃计数、文件数钳制。状态判定全部由
 * ACTIVE_STATUS_SET / DONE_STATUS_SET 派生，保证一致、无遗漏、无重叠。
 *
 * 纯函数：不做 I/O。
 */

import { ACTIVE_STATUS_SET, DONE_STATUS_SET } from '@/lib/modelTypes';
import type { DownloadTask, DownloadStatus } from '@/lib/modelTypes';

/**
 * 展示进度钳制到 [0, 100] 闭区间。
 * 非有限输入（NaN/Infinity）回退：NaN→0，+Infinity→100，-Infinity→0。
 */
export function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) {
    return progress === Infinity ? 100 : 0;
  }
  if (progress < 0) return 0;
  if (progress > 100) return 100;
  return progress;
}

/** 状态是否属于 Active_Status_Set（pending/running）。 */
export function isActive(status: DownloadStatus): boolean {
  return ACTIVE_STATUS_SET.has(status);
}

/** 状态是否属于 Done_Status_Set（completed/partial_failed/failed/cancelled）。 */
export function isDone(status: DownloadStatus): boolean {
  return DONE_STATUS_SET.has(status);
}

/** 可取消：当且仅当状态属于 Active_Status_Set。 */
export function canCancel(task: DownloadTask): boolean {
  return isActive(task.status);
}

/** 可重试：当且仅当状态为 failed 或 partial_failed。 */
export function canRetry(task: DownloadTask): boolean {
  return task.status === 'failed' || task.status === 'partial_failed';
}

/** 可删除：当且仅当状态属于 Done_Status_Set。 */
export function canDelete(task: DownloadTask): boolean {
  return isDone(task.status);
}

/** 统计活跃任务（状态属于 Active_Status_Set）数量。 */
export function countActiveTasks(tasks: DownloadTask[]): number {
  return tasks.reduce((n, t) => (isActive(t.status) ? n + 1 : n), 0);
}

/**
 * 批量任务完成文件数钳制：total > 0 时把 completed 钳到 [0, total]；
 * total <= 0 时把 completed 钳到不小于 0。
 */
export function clampCompletedFiles(completed: number, total: number): number {
  const lo = completed < 0 ? 0 : completed;
  if (total > 0 && lo > total) return total;
  return lo;
}
