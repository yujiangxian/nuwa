import { memo } from 'react';
import { AlertTriangle, Check, Gauge, RotateCcw, Trash2, X } from 'lucide-react';
import { statusConfig } from '@/lib/modelTypeConfig';
import { clampProgress } from '@/lib/downloadTask';
import type { DownloadTask } from '@/lib/modelTypes';

type Props = { task: DownloadTask; onCancel: (id: string) => void; onDelete: (id: string) => void; onRetry: (task: DownloadTask) => void };

function DownloadTaskCard({ task, onCancel, onDelete, onRetry }: Props) {
  const st = statusConfig[task.status] || statusConfig.pending;
  const StatusIcon = st.icon;
  const isBatch = task.mode === 'batch';
  const displayName = isBatch ? task.repo_id || task.dest_dir || '批量下载' : task.dest || task.url;
  const progressColor = task.status === 'failed' ? '#FF6B6B' : task.status === 'completed' ? '#52B788' : 'var(--primary)';
  const isActive = task.status === 'running' || task.status === 'pending';
  const isDone = task.status === 'completed' || task.status === 'failed' || task.status === 'partial_failed' || task.status === 'cancelled';
  let etaText = '';
  if (task.status === 'running' && task.speed_mbps > 0 && task.progress < 100) etaText = `${task.speed_mbps.toFixed(1)} MB/s`;

  return (
    <div className="glass rounded-2xl p-4 glow-edge transition-all" style={{ border: '1px solid var(--border)', animation: 'slideInUp 0.3s ease' }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: st.bg }}><StatusIcon size={16} style={{ color: st.color }} /></div>
          <div className="min-w-0">
            <span className="text-sm font-medium truncate block" style={{ color: 'var(--text-primary)' }}>{displayName}</span>
            {isBatch && <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{task.completed_files}/{task.total_files} 文件{task.current_file && ` · ${task.current_file}`}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <span className="text-[10px] px-2 py-1 rounded-md font-medium" style={{ background: st.bg, color: st.color }}>{st.label}</span>
          {task.status === 'failed' && <button onClick={() => onRetry(task)} title="重试" className="flex items-center justify-center rounded-lg transition-all hover:bg-white/5" style={{ width: 28, height: 28, color: 'var(--primary)', background: 'transparent', border: 'none', cursor: 'pointer' }}><RotateCcw size={14} /></button>}
          {isActive && <button onClick={() => onCancel(task.id)} title="取消" className="flex items-center justify-center rounded-lg transition-all hover:bg-white/5" style={{ width: 28, height: 28, color: 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer' }}><X size={14} /></button>}
          {isDone && <button onClick={() => onDelete(task.id)} title="删除" className="flex items-center justify-center rounded-lg transition-all hover:bg-white/5" style={{ width: 28, height: 28, color: 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer' }}><Trash2 size={14} /></button>}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)' }}>
          <div className="h-full rounded-full transition-all" style={{ width: `${clampProgress(task.progress)}%`, background: progressColor, boxShadow: isActive ? `0 0 8px ${progressColor}40` : 'none', transition: 'width 0.5s ease' }} />
        </div>
        <span className="text-[11px] font-mono shrink-0" style={{ color: 'var(--text-muted)', minWidth: 42, textAlign: 'right' }}>{task.progress.toFixed(1)}%</span>
      </div>
      <div className="flex items-center justify-between mt-2">
        <div className="flex items-center gap-3">
          {etaText && <span className="text-[11px] flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}><Gauge size={11} /> {etaText}</span>}
          {task.status === 'completed' && <span className="text-[11px] flex items-center gap-1" style={{ color: '#52B788' }}><Check size={11} /> 下载完成</span>}
        </div>
        {isBatch && task.total_files > 0 && <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>文件 {task.completed_files}/{task.total_files}</span>}
      </div>
      {task.error && (
        <div className="mt-2 p-2.5 rounded-xl flex items-start gap-2" style={{ background: 'rgba(255,107,107,0.05)', border: '1px solid rgba(255,107,107,0.12)' }}>
          <AlertTriangle size={12} style={{ color: '#FF6B6B', flexShrink: 0, marginTop: 1 }} /><p className="text-[11px] leading-relaxed" style={{ color: '#FF6B6B' }}>{task.error}</p>
        </div>
      )}
    </div>
  );
}

export default memo(DownloadTaskCard);
