// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

/**
 * model-management：容量格式化纯函数层。
 *
 * 从 ModelsPage 内联的 formatSize/formatBytes 抽取，保持精确字符串契约
 * （阈值与小数位逐位一致），被磁盘条、GPU 条、模型卡片共用。
 *
 * 纯函数：不做 I/O。
 */

/**
 * MB 大小格式化：
 * - mb > 1024：`${(mb/1024).toFixed(1)} GB`
 * - 100 <= mb <= 1024：`${mb.toFixed(0)} MB`
 * - mb < 100：`${mb.toFixed(1)} MB`
 */
export function formatSize(mb: number): string {
  if (mb > 1024) return `${(mb / 1024).toFixed(1)} GB`;
  if (mb >= 100) return `${mb.toFixed(0)} MB`;
  return `${mb.toFixed(1)} MB`;
}

/**
 * 字节格式化：
 * - >= 1073741824（1024^3）：GB（1 位小数）
 * - >= 1048576（1024^2）：MB（1 位小数）
 * - >= 1024：KB（1 位小数）
 * - 否则：`${bytes} B`
 */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}
