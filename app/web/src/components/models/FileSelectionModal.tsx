import { Check, File, X } from 'lucide-react';
import { formatBytes } from '@/lib/modelFormat';
import type { PresetModel } from '@/lib/modelTypes';

type RepoFile = { path: string; size: number; size_text: string; is_lfs: boolean };

type Props = {
  show: boolean; preset: PresetModel | null;
  repoFiles: RepoFile[]; selectedFiles: Set<string>; loadingFiles: boolean;
  onClose: () => void; onToggleAll: () => void; onToggleFile: (p: string) => void;
  onConfirm: () => void;
};

export default function FileSelectionModal({ show, preset, repoFiles, selectedFiles, loadingFiles, onClose, onToggleAll, onToggleFile, onConfirm }: Props) {
  if (!show || !preset) return null;
  const selectedSize = repoFiles.filter(f => selectedFiles.has(f.path)).reduce((s, f) => s + f.size, 0);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}>
      <div className="glass rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col" style={{ border: '1px solid var(--border)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
        <div className="flex items-center justify-between px-5 py-4 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
          <div><h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{preset.name}</h3><p className="text-[11px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>选择要下载的文件</p></div>
          <button onClick={onClose} className="flex items-center justify-center" style={{ width: 28, height: 28, borderRadius: 8, color: 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer' }}><X size={16} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {loadingFiles ? (
            <div className="text-center py-8"><div className="w-6 h-6 rounded-full border-2 border-t-transparent mx-auto mb-3" style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent', animation: 'spin 1s linear infinite' }} /><p className="text-xs" style={{ color: 'var(--text-secondary)' }}>获取文件列表...</p></div>
          ) : repoFiles.length === 0 ? (
            <div className="text-center py-8"><p className="text-xs" style={{ color: 'var(--text-muted)' }}>仓库中没有可下载的文件</p></div>
          ) : (<>
            <div className="flex items-center gap-2 mb-3 p-2 rounded-lg cursor-pointer" style={{ background: 'rgba(255,255,255,0.03)' }} onClick={onToggleAll}>
              <div className="w-4 h-4 rounded flex items-center justify-center" style={{ border: `1.5px solid ${selectedFiles.size === repoFiles.length ? 'var(--primary)' : 'var(--text-muted)'}`, background: selectedFiles.size === repoFiles.length ? 'var(--primary)' : 'transparent' }}>{selectedFiles.size === repoFiles.length && <Check size={10} style={{ color: 'var(--bg)' }} />}</div>
              <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>全选 ({selectedFiles.size}/{repoFiles.length})</span>
            </div>
            <div className="space-y-1">{repoFiles.map(file => {
              const sel = selectedFiles.has(file.path);
              return <div key={file.path} className="flex items-center gap-2.5 p-2 rounded-lg cursor-pointer transition-all" style={{ background: sel ? 'rgba(72,202,228,0.06)' : 'transparent' }} onClick={() => onToggleFile(file.path)}>
                <div className="w-4 h-4 rounded flex items-center justify-center shrink-0" style={{ border: `1.5px solid ${sel ? 'var(--primary)' : 'var(--text-muted)'}`, background: sel ? 'var(--primary)' : 'transparent' }}>{sel && <Check size={10} style={{ color: 'var(--bg)' }} />}</div>
                <File size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} /><span className="text-xs flex-1 truncate" style={{ color: sel ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{file.path}</span><span className="text-[10px] shrink-0" style={{ color: 'var(--text-muted)' }}>{file.size_text}</span>
              </div>;
            })}</div>
          </>)}
        </div>
        <div className="flex items-center justify-between px-5 py-4 shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>已选: {selectedFiles.size} 个文件 · {formatBytes(selectedSize)}</span>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="text-xs px-3 py-1.5 rounded-lg cursor-pointer transition-all" style={{ color: 'var(--text-secondary)', background: 'transparent', border: '1px solid var(--border)' }}>取消</button>
            <button onClick={onConfirm} disabled={selectedFiles.size === 0 || loadingFiles} className="text-xs px-4 py-1.5 rounded-lg cursor-pointer transition-all font-medium" style={{ color: 'var(--bg)', background: selectedFiles.size === 0 ? 'var(--text-muted)' : 'var(--primary)', border: 'none', opacity: selectedFiles.size === 0 ? 0.5 : 1 }}>确认下载</button>
          </div>
        </div>
      </div>
    </div>
  );
}
