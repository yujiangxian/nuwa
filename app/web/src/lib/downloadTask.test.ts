// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  clampProgress,
  isActive,
  isDone,
  canCancel,
  canRetry,
  canDelete,
  countActiveTasks,
  clampCompletedFiles,
} from '@/lib/downloadTask';
import { ACTIVE_STATUS_SET, DONE_STATUS_SET } from '@/lib/modelTypes';
import type { DownloadTask, DownloadStatus } from '@/lib/modelTypes';

const NUM_RUNS = 200;

const ALL_STATUSES: DownloadStatus[] = [
  'pending',
  'running',
  'completed',
  'partial_failed',
  'failed',
  'cancelled',
];
const statusArb = fc.constantFrom<DownloadStatus>(...ALL_STATUSES);

function taskWith(status: DownloadStatus): DownloadTask {
  return {
    id: 'x',
    mode: 'single',
    status,
    progress: 0,
    speed_mbps: 0,
    total_files: 0,
    completed_files: 0,
    url: '',
    dest: '',
    error: null,
  };
}

const taskArb: fc.Arbitrary<DownloadTask> = statusArb.map(taskWith);

describe('downloadTask', () => {
  // Feature: model-management, Property 7: 下载进度钳制到 [0,100]
  // Validates: Requirements 4.3
  it('clampProgress output lies in [0,100] and is identity within range', () => {
    fc.assert(
      fc.property(fc.double({ min: -1000, max: 1000, noNaN: true }), (p) => {
        const v = clampProgress(p);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
        if (p >= 0 && p <= 100) expect(v).toBe(p);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: model-management, Property 8: 下载任务状态分类与操作资格一致
  // Validates: Requirements 4.4, 4.5, 4.6, 4.7
  it('isActive/isDone partition all statuses; eligibility rules hold', () => {
    fc.assert(
      fc.property(statusArb, (status) => {
        // 互斥且并集为全集
        expect(isActive(status) !== isDone(status)).toBe(true);
        const task = taskWith(status);
        expect(canCancel(task)).toBe(ACTIVE_STATUS_SET.has(status));
        expect(canDelete(task)).toBe(DONE_STATUS_SET.has(status));
        expect(canRetry(task)).toBe(status === 'failed' || status === 'partial_failed');
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: model-management, Property 9: 活跃任务计数等于活跃任务个数
  // Validates: Requirements 4.8
  it('countActiveTasks equals number of pending/running tasks', () => {
    fc.assert(
      fc.property(fc.array(taskArb, { maxLength: 40 }), (tasks) => {
        const expected = tasks.filter((t) => ACTIVE_STATUS_SET.has(t.status)).length;
        expect(countActiveTasks(tasks)).toBe(expected);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: model-management, Property 10: 批量任务完成文件数不超过总文件数
  // Validates: Requirements 4.11
  it('clampCompletedFiles stays within [0, total] when total > 0', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -10, max: 1000 }),
        fc.integer({ min: 1, max: 1000 }),
        (completed, total) => {
          const v = clampCompletedFiles(completed, total);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(total);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // 单元边界用例
  it('clampProgress handles out-of-range and non-finite inputs', () => {
    expect(clampProgress(-5)).toBe(0);
    expect(clampProgress(150)).toBe(100);
    expect(clampProgress(NaN)).toBe(0);
    expect(clampProgress(Infinity)).toBe(100);
    expect(clampProgress(-Infinity)).toBe(0);
    expect(clampProgress(42.5)).toBe(42.5);
  });

  it('clampCompletedFiles handles completed > total and completed < 0', () => {
    expect(clampCompletedFiles(12, 10)).toBe(10);
    expect(clampCompletedFiles(-3, 10)).toBe(0);
    expect(clampCompletedFiles(5, 10)).toBe(5);
    // total <= 0: 只钳下界
    expect(clampCompletedFiles(7, 0)).toBe(7);
    expect(clampCompletedFiles(-1, 0)).toBe(0);
  });

  it('isActive and isDone are mutually exclusive across all statuses', () => {
    for (const s of ALL_STATUSES) {
      expect(isActive(s) || isDone(s)).toBe(true);
      expect(isActive(s) && isDone(s)).toBe(false);
    }
  });
});
