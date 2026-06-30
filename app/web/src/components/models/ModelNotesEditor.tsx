import { useState, useEffect } from 'react';
import { MessageSquare } from 'lucide-react';

type Props = { modelId: string; initialNotes: string; onSave: (id: string, notes: string) => void };

export default function ModelNotesEditor({ modelId, initialNotes, onSave }: Props) {
  const [notes, setNotes] = useState(initialNotes);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => { setNotes(initialNotes); }, [initialNotes, modelId]);

  const handleSave = async () => {
    setIsSaving(true);
    try { await onSave(modelId, notes); setIsEditing(false); }
    finally { setIsSaving(false); }
  };

  return (
    <div className="mb-4 p-3 rounded-xl" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-medium flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
          <MessageSquare size={12} /> 备注
        </span>
        {!isEditing ? (
          <button onClick={() => setIsEditing(true)} className="text-[10px] px-2 py-0.5 rounded-md cursor-pointer transition-all"
            style={{ color: 'var(--primary)', background: 'rgba(72,202,228,0.08)', border: '1px solid rgba(72,202,228,0.15)' }}>
            {initialNotes ? '编辑' : '添加'}
          </button>
        ) : (
          <div className="flex items-center gap-1.5">
            <button onClick={() => { setIsEditing(false); setNotes(initialNotes); }}
              className="text-[10px] px-2 py-0.5 rounded-md cursor-pointer transition-all"
              style={{ color: 'var(--text-muted)', background: 'transparent', border: '1px solid var(--border)' }}>取消</button>
            <button onClick={handleSave} disabled={isSaving} className="text-[10px] px-2 py-0.5 rounded-md cursor-pointer transition-all font-medium"
              style={{ color: 'var(--bg)', background: isSaving ? 'var(--text-muted)' : 'var(--primary)', border: 'none', opacity: isSaving ? 0.5 : 1 }}>
              {isSaving ? '保存中...' : '保存'}
            </button>
          </div>
        )}
      </div>
      {isEditing ? (
        <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="添加模型备注..." rows={3}
          className="w-full text-xs rounded-lg px-3 py-2 outline-none resize-none transition-all"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
          onFocus={e => { e.currentTarget.style.borderColor = 'var(--primary)'; }}
          onBlur={e => { e.currentTarget.style.borderColor = 'var(--border)'; }} />
      ) : initialNotes ? (
        <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{initialNotes}</p>
      ) : (
        <p className="text-xs italic" style={{ color: 'var(--text-muted)' }}>暂无备注</p>
      )}
    </div>
  );
}
