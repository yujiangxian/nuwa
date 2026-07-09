// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { Box, Database, Layers } from 'lucide-react';
import { formatSize } from '@/lib/modelFormat';
import { totalInstalledSizeMb } from '@/lib/systemResource';
import type { InstalledModel } from '@/lib/modelTypes';

export default function StatsBar({ models }: { models: InstalledModel[] }) {
  const totalSize = totalInstalledSizeMb(models);
  const typeCounts = models.reduce((acc, m) => { acc[m.model_type] = (acc[m.model_type] || 0) + 1; return acc; }, {} as Record<string, number>);
  const typeCount = Object.keys(typeCounts).length;
  return (
    <div className="flex items-center gap-4 mb-5 p-3 rounded-xl" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)' }}>
      <div className="flex items-center gap-2">
        <Box size={14} style={{ color: 'var(--text-muted)' }} />
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}><span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{models.length}</span> 个模型</span>
      </div>
      <div className="w-px h-4" style={{ background: 'var(--border)' }} />
      <div className="flex items-center gap-2">
        <Database size={14} style={{ color: 'var(--text-muted)' }} />
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}><span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{formatSize(totalSize)}</span></span>
      </div>
      <div className="w-px h-4" style={{ background: 'var(--border)' }} />
      <div className="flex items-center gap-2">
        <Layers size={14} style={{ color: 'var(--text-muted)' }} />
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}><span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{typeCount}</span> 个分类</span>
      </div>
    </div>
  );
}
