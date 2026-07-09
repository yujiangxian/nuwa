// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { memo } from 'react';
import { Cpu, Check, Database, Globe, Zap, Download, AlertTriangle } from 'lucide-react';
import { formatSize } from '@/lib/modelFormat';
import type { PresetModel } from '@/lib/modelTypes';

type PresetCardCfg = { label: string; icon: typeof Cpu; color: string; bg: string; glow: string };

function PresetCard({ preset, cfg, onDownload }: { preset: PresetModel; cfg: PresetCardCfg; onDownload: (p: PresetModel) => void }) {
  const Icon = cfg.icon;
  const sizeText = formatSize(preset.size_mb);
  return (
    <div className="glass rounded-2xl p-5 glow-edge transition-all relative overflow-hidden group"
      style={{ border: preset.is_downloaded ? `1px solid ${cfg.color}20` : '1px solid var(--border)', animation: 'slideInUp 0.35s ease' }}>
      {preset.is_downloaded && <div className="absolute left-0 top-3 bottom-3 w-[3px] rounded-full" style={{ background: cfg.color }} />}
      <div className={`flex items-start gap-4 ${preset.is_downloaded ? 'pl-2' : ''}`}>
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-105"
          style={{ background: `linear-gradient(135deg, ${cfg.color}15, ${cfg.color}05)`, border: `1px solid ${cfg.color}10`, boxShadow: `0 0 20px ${cfg.color}10` }}>
          <Icon size={26} style={{ color: cfg.color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <h3 className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{preset.name}</h3>
            <span className="text-[10px] px-1.5 py-0.5 rounded-md font-medium" style={{ background: cfg.bg, color: cfg.color }}>{cfg.label}</span>
            {preset.is_downloaded && <span className="text-[10px] px-1.5 py-0.5 rounded-md font-medium flex items-center gap-1" style={{ background: 'rgba(82,183,136,0.10)', color: '#52B788' }}><Check size={9} /> 已下载</span>}
          </div>
          <p className="text-xs mb-2.5 leading-relaxed line-clamp-2" style={{ color: 'var(--text-secondary)' }}>{preset.description}</p>
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <span className="text-[10px] px-2 py-0.5 rounded-md font-medium flex items-center gap-1" style={{ background: 'rgba(255,255,255,0.03)', color: 'var(--text-muted)' }}><Database size={10} /> {sizeText}</span>
            <span className="text-[10px] px-2 py-0.5 rounded-md font-medium flex items-center gap-1" style={{ background: 'rgba(255,255,255,0.03)', color: 'var(--text-muted)' }}><Globe size={10} /> {preset.source}</span>
            {preset.size_mb > 5000 && <span className="text-[10px] px-1.5 py-0.5 rounded-md font-medium flex items-center gap-1" style={{ background: 'rgba(251,146,60,0.08)', color: '#FB923C' }}><Zap size={9} /> 大模型</span>}
            {preset.size_mb < 100 && <span className="text-[10px] px-1.5 py-0.5 rounded-md font-medium flex items-center gap-1" style={{ background: 'rgba(52,211,153,0.08)', color: '#34D399' }}><Zap size={9} /> 轻量</span>}
          </div>
          {preset.note && (
            <div className="flex items-start gap-1.5 mb-3 p-2.5 rounded-xl" style={{ background: 'rgba(212,175,55,0.03)', border: '1px solid rgba(212,175,55,0.10)' }}>
              <AlertTriangle size={12} style={{ color: '#D4AF37', flexShrink: 0, marginTop: 1 }} />
              <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{preset.note}</p>
            </div>
          )}
          <div className="flex items-center gap-2">
            {preset.is_downloaded
              ? <span className="text-[10px] px-2 py-1 rounded-md font-medium flex items-center gap-1" style={{ background: 'rgba(82,183,136,0.08)', color: '#52B788' }}><Check size={10} /> 已下载</span>
              : <button onClick={() => onDownload(preset)} className="flex items-center gap-1.5 text-xs px-3.5 py-2 rounded-xl cursor-pointer transition-all font-medium"
                  style={{ color: 'var(--primary)', background: 'rgba(72,202,228,0.06)', border: '1px solid rgba(72,202,228,0.12)' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(72,202,228,0.12)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(72,202,228,0.06)'; }}><Download size={14} /> 下载</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(PresetCard);
