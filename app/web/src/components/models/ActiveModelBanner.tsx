import { Check, Sparkles } from 'lucide-react';
import { typeConfig } from '@/lib/modelTypeConfig';
import { formatSize } from '@/lib/modelFormat';
import type { InstalledModel } from '@/lib/modelTypes';

export default function ActiveModelBanner({ models, currentModels }: { models: InstalledModel[]; currentModels: Record<string, string> }) {
  const activeItems = Object.entries(currentModels)
    .map(([type, currentId]) => {
      const cfg = typeConfig[type] || typeConfig.other;
      return { type, label: cfg.label, currentId, color: cfg.color, icon: cfg.icon };
    })
    .filter(item => item.currentId);
  if (activeItems.length === 0) return null;
  const gridCols = activeItems.length >= 4 ? 'md:grid-cols-4' : activeItems.length === 3 ? 'md:grid-cols-3' : activeItems.length === 2 ? 'md:grid-cols-2' : 'md:grid-cols-1';
  return (
    <div className="mb-6" style={{ animation: 'fadeIn 0.4s ease' }}>
      <div className="flex items-center gap-2 mb-3"><Sparkles size={14} style={{ color: '#D4AF37' }} /><span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>当前活跃模型</span></div>
      <div className={`grid grid-cols-1 ${gridCols} gap-3`}>
        {activeItems.map(item => {
          const model = models.find(m => m.id === item.currentId);
          if (!model) return null;
          const Icon = item.icon;
          return (
            <div key={item.type} className="glass rounded-2xl p-4 glow-edge transition-all relative overflow-hidden"
              style={{ border: `1px solid ${item.color}18`, background: `linear-gradient(135deg, ${item.color}06, transparent)` }}>
              <div className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full" style={{ background: item.color }} />
              <div className="flex items-center gap-3 pl-2">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${item.color}12`, border: `1px solid ${item.color}15` }}><Icon size={20} style={{ color: item.color }} /></div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2"><span className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{model.name}</span><span className="text-[10px] px-1.5 py-0.5 rounded-md font-medium flex items-center gap-1 shrink-0" style={{ background: `${item.color}12`, color: item.color }}><Check size={9} /> 使用中</span></div>
                  <p className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--text-secondary)' }}>{item.label} · {formatSize(model.size_mb)} · {model.quant.toUpperCase()}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
