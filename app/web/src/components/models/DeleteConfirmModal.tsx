// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { AlertTriangle } from 'lucide-react';
import type { InstalledModel } from '@/lib/modelTypes';

type Props = {
  show: boolean; model: InstalledModel | null; isDeleting: boolean;
  onConfirm: () => void; onCancel: () => void;
};

export default function DeleteConfirmModal({ show, model, isDeleting, onConfirm, onCancel }: Props) {
  if (!show || !model) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}>
      <div className="glass rounded-2xl w-full max-w-sm flex flex-col" style={{ border: '1px solid var(--border)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
        <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(255,107,107,0.08)' }}><AlertTriangle size={18} style={{ color: '#FF6B6B' }} /></div>
          <div><h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>确认删除</h3><p className="text-[11px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>此操作不可撤销</p></div>
        </div>
        <div className="px-5 py-4">
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>确定要删除模型 <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>「{model.name}」</span> 吗？</p>
          <p className="text-[11px] mt-2 font-mono" style={{ color: 'var(--text-muted)' }}>{model.path}</p>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4" style={{ borderTop: '1px solid var(--border)' }}>
          <button onClick={onCancel} className="text-xs px-3 py-1.5 rounded-lg cursor-pointer transition-all" style={{ color: 'var(--text-secondary)', background: 'transparent', border: '1px solid var(--border)' }}>取消</button>
          <button onClick={onConfirm} disabled={isDeleting} className="text-xs px-4 py-1.5 rounded-lg cursor-pointer transition-all font-medium" style={{ color: 'var(--bg)', background: isDeleting ? 'var(--text-muted)' : '#FF6B6B', border: 'none', opacity: isDeleting ? 0.5 : 1 }}>{isDeleting ? '删除中...' : '确认删除'}</button>
        </div>
      </div>
    </div>
  );
}
