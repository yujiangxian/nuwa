import { memo, useMemo } from 'react';
import { Check, Clock, FileArchive, Info, Trash2 } from 'lucide-react';
import { typeConfig } from '@/lib/modelTypeConfig';
import { formatLastUsed } from '@/lib/modelMeta';
import { canDeleteModel } from '@/lib/installedModel';
import type { InstalledModel } from '@/lib/modelTypes';

type ModelCardProps = {
  model: InstalledModel;
  isCurrent: boolean;
  notes?: string;
  lastUsed?: number;
  onSetCurrent: (id: string) => void;
  onDelete: (model: InstalledModel) => void;
  onViewDetail: (model: InstalledModel) => void;
};

function ModelCard({ model, isCurrent, notes, lastUsed, onSetCurrent, onDelete, onViewDetail }: ModelCardProps) {
  const cfg = typeConfig[model.model_type] || typeConfig.other;
  const Icon = cfg.icon;
  const isOllama = !canDeleteModel(model);
  const lastUsedText = useMemo(() => lastUsed ? formatLastUsed(lastUsed) : null, [lastUsed]);

  return (
    <div className="glass rounded-2xl p-5 glow-edge transition-all group relative overflow-hidden"
      style={{ border: isCurrent ? `1px solid ${cfg.color}25` : '1px solid var(--border)', background: isCurrent ? `linear-gradient(135deg, ${cfg.bg}, transparent)` : undefined, animation: 'slideInUp 0.35s ease' }}>
      {isCurrent && <div className="absolute left-0 top-3 bottom-3 w-[3px] rounded-full" style={{ background: cfg.color }} />}
      <div className={`flex items-start gap-4 ${isCurrent ? 'pl-2' : ''}`}>
        <div onClick={() => onViewDetail(model)} className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-105 cursor-pointer"
          style={{ background: `linear-gradient(135deg, ${cfg.color}15, ${cfg.color}05)`, border: `1px solid ${cfg.color}10`, boxShadow: isCurrent ? `0 0 16px ${cfg.glow}` : 'none' }}>
          <Icon size={22} style={{ color: cfg.color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h3 className="text-sm font-semibold truncate cursor-pointer transition-colors hover:opacity-80" style={{ color: 'var(--text-primary)' }} onClick={() => onViewDetail(model)}>{model.name}</h3>
            {isCurrent && <span className="text-[10px] px-1.5 py-0.5 rounded-md font-medium flex items-center gap-1 shrink-0" style={{ background: `${cfg.color}12`, color: cfg.color }}><Check size={9} /> 当前</span>}
            {isOllama && <span className="text-[10px] px-1.5 py-0.5 rounded-md font-medium shrink-0" style={{ background: 'rgba(123,130,225,0.08)', color: '#7B82E1' }}>Ollama</span>}
            {lastUsedText && <span className="text-[10px] px-1.5 py-0.5 rounded-md font-medium shrink-0 flex items-center gap-1" style={{ background: 'rgba(212,175,55,0.06)', color: '#D4AF37' }}><Clock size={9} /> {lastUsedText}</span>}
          </div>
          <p className="text-[11px] mb-1 truncate" style={{ color: 'var(--text-secondary)' }}>{model.description}</p>
          {notes && <p className="text-[10px] mb-1 truncate italic" style={{ color: 'var(--text-muted)' }}>{notes}</p>}
          <p className="text-[10px] mb-2 truncate font-mono" style={{ color: 'var(--text-muted)' }}>{model.id}</p>
          {model.main_files.length > 0 && (
            <div className="flex items-center gap-1.5 mb-3"><FileArchive size={11} style={{ color: 'var(--text-muted)', flexShrink: 0 }} /><span className="text-[11px] truncate font-mono" style={{ color: 'var(--text-muted)' }}>{model.main_files[0]}{model.main_files.length > 1 && ` +${model.main_files.length - 1}`}</span></div>
          )}
          <div className="flex items-center gap-2">
            <span className="text-[10px] px-2 py-0.5 rounded-md font-medium" style={{ background: cfg.bg, color: cfg.color }}>{cfg.label}</span>
            <span className="text-[10px] px-2 py-0.5 rounded-md font-medium" style={{ background: 'rgba(255,255,255,0.03)', color: 'var(--text-muted)' }}>{model.quant.toUpperCase()}</span>
            <div className="ml-auto flex items-center gap-1">
              {!isCurrent && <button onClick={() => onSetCurrent(model.id)} className="text-[11px] px-3 py-1.5 rounded-lg cursor-pointer transition-all font-medium" style={{ color: cfg.color, background: `${cfg.color}08`, border: `1px solid ${cfg.color}15` }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = `${cfg.color}14`; }} onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = `${cfg.color}08`; }}>使用</button>}
              <button onClick={() => onViewDetail(model)} title="查看详情" className="flex items-center justify-center rounded-lg transition-all hover:bg-white/5 cursor-pointer" style={{ width: 28, height: 28, color: 'var(--text-muted)', background: 'transparent', border: 'none' }}><Info size={14} /></button>
              {!isOllama && <button onClick={() => onDelete(model)} title="删除模型" className="flex items-center justify-center rounded-lg transition-all hover:bg-red-500/10 cursor-pointer" style={{ width: 28, height: 28, color: 'var(--text-muted)', background: 'transparent', border: 'none' }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#FF6B6B'; }} onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)'; }}><Trash2 size={14} /></button>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(ModelCard);
