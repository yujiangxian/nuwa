// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { Cpu } from 'lucide-react';
import { formatSize } from '@/lib/modelFormat';
import type { GpuInfo } from '@/lib/modelTypes';

export default function GpuBar({ gpuInfo }: { gpuInfo: GpuInfo | null }) {
  if (!gpuInfo) return null;
  const usageColor = gpuInfo.usage_percent > 90 ? '#FF6B6B' : gpuInfo.usage_percent > 75 ? '#FB923C' : '#52B788';
  return (
    <div className="mb-5 p-3.5 rounded-xl" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Cpu size={14} style={{ color: 'var(--text-muted)' }} />
          <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>GPU 显存</span>
          <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{gpuInfo.name}</span>
          {gpuInfo.backend && (
            <span
              className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded"
              style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }}
            >
              {gpuInfo.backend}
            </span>
          )}
        </div>
        <span className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
          已用 {formatSize(gpuInfo.used_vram_mb)} / 总量 {formatSize(gpuInfo.total_vram_mb)}
        </span>
      </div>
      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)' }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(gpuInfo.usage_percent, 100)}%`, background: usageColor, opacity: 0.7 }} />
      </div>
      <div className="flex items-center justify-between mt-1.5">
        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>可用 {formatSize(gpuInfo.free_vram_mb)}</span>
        <span className="text-[10px] font-medium" style={{ color: usageColor }}>{gpuInfo.usage_percent.toFixed(1)}%</span>
      </div>
    </div>
  );
}
