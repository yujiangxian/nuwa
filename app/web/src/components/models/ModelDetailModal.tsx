import { File, FolderOpen, X } from 'lucide-react';
import { formatBytes } from '@/lib/modelFormat';
import ModelNotesEditor from './ModelNotesEditor';
import type { InstalledModel } from '@/lib/modelTypes';

type ModelFile = { name: string; path: string; size: number; is_dir: boolean };

type Props = {
  show: boolean; model: InstalledModel | null; files: ModelFile[]; loading: boolean;
  notes: string; onSaveNotes: (id: string, notes: string) => void; onClose: () => void;
};

export default function ModelDetailModal({ show, model, files, loading, notes, onSaveNotes, onClose }: Props) {
  if (!show || !model) return null;
  const fileCount = files.filter(f => !f.is_dir).length;
  const totalSize = files.filter(f => !f.is_dir).reduce((s, f) => s + f.size, 0);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}>
      <div className="glass rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col" style={{ border: '1px solid var(--border)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
        <div className="flex items-center justify-between px-5 py-4 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
          <div><h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{model.name}</h3><p className="text-[11px] mt-0.5 font-mono" style={{ color: 'var(--text-muted)' }}>{model.id}</p></div>
          <button onClick={onClose} className="flex items-center justify-center" style={{ width: 28, height: 28, borderRadius: 8, color: 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer' }}><X size={16} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-3">
          <ModelNotesEditor modelId={model.id} initialNotes={notes} onSave={onSaveNotes} />
          {loading ? (
            <div className="text-center py-8"><div className="w-6 h-6 rounded-full border-2 border-t-transparent mx-auto mb-3" style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent', animation: 'spin 1s linear infinite' }} /><p className="text-xs" style={{ color: 'var(--text-secondary)' }}>加载文件列表...</p></div>
          ) : files.length === 0 ? (
            <div className="text-center py-8"><p className="text-xs" style={{ color: 'var(--text-muted)' }}>暂无文件信息</p></div>
          ) : (
            <div className="space-y-1">{files.map((f, idx) => <div key={idx} className="flex items-center gap-2.5 p-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.02)' }}>{f.is_dir ? <FolderOpen size={14} style={{ color: '#D4AF37', flexShrink: 0 }} /> : <File size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />}<span className="text-xs flex-1 truncate font-mono" style={{ color: 'var(--text-secondary)' }}>{f.path}</span>{!f.is_dir && <span className="text-[10px] shrink-0" style={{ color: 'var(--text-muted)' }}>{formatBytes(f.size)}</span>}</div>)}</div>
          )}
        </div>
        <div className="flex items-center justify-between px-5 py-3 shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{fileCount} 个文件 · 共 {formatBytes(totalSize)}</span>
          <button onClick={onClose} className="text-xs px-3 py-1.5 rounded-lg cursor-pointer transition-all" style={{ color: 'var(--text-secondary)', background: 'transparent', border: '1px solid var(--border)' }}>关闭</button>
        </div>
      </div>
    </div>
  );
}
