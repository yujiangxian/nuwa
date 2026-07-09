// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { HardDrive } from 'lucide-react';
import { formatSize } from '@/lib/modelFormat';
import type { DiskInfo } from '@/lib/modelTypes';

export default function DiskBar({ diskInfo, modelsTotalSize }: { diskInfo: DiskInfo | null; modelsTotalSize: number }) {
  if (!diskInfo) return null;
  const usageColor = diskInfo.used_percent > 90 ? '#FF6B6B' : diskInfo.used_percent > 75 ? '#FB923C' : '#52B788';
  const totalGb = diskInfo.total_bytes / (1024 * 1024 * 1024);
  const usedGb = diskInfo.used_bytes / (1024 * 1024 * 1024);
  const freeGb = diskInfo.free_bytes / (1024 * 1024 * 1024);
  return (
    <div className="mb-5 p-3.5 rounded-xl" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <HardDrive size={14} style={{ color: 'var(--text-muted)' }} />
          <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>磁盘空间</span>
        </div>
        <span className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
          模型占用 {formatSize(modelsTotalSize)} / 可用 {formatSize(freeGb * 1024)}
        </span>
      </div>
      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)' }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(diskInfo.used_percent, 100)}%`, background: usageColor, opacity: 0.7 }} />
      </div>
      <div className="flex items-center justify-between mt-1.5">
        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>已用 {usedGb.toFixed(1)} GB / 总量 {totalGb.toFixed(1)} GB</span>
        <span className="text-[10px] font-medium" style={{ color: usageColor }}>{diskInfo.used_percent.toFixed(1)}%</span>
      </div>
    </div>
  );
}
