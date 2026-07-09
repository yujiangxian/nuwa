// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { useToastStore } from '@/store/toastStore';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';

const iconMap = {
  success: CheckCircle,
  error: AlertCircle,
  info: Info,
  warning: AlertTriangle,
};

const colorMap = {
  success: { bg: 'rgba(82,183,136,0.1)', border: 'rgba(82,183,136,0.2)', icon: '#52B788' },
  error: { bg: 'rgba(255,107,107,0.1)', border: 'rgba(255,107,107,0.2)', icon: '#FF6B6B' },
  info: { bg: 'rgba(72,202,228,0.1)', border: 'rgba(72,202,228,0.2)', icon: '#48CAE4' },
  warning: { bg: 'rgba(212,175,55,0.1)', border: 'rgba(212,175,55,0.2)', icon: '#D4AF37' },
};

export default function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2" style={{ maxWidth: 360 }} role="status" aria-live="polite">
      {toasts.map((toast) => {
        const Icon = iconMap[toast.type];
        const colors = colorMap[toast.type];
        return (
          <div
            key={toast.id}
            className="flex items-start gap-3 rounded-xl p-4 glass"
            style={{
              background: colors.bg,
              border: `1px solid ${colors.border}`,
              animation: 'slideInRight 0.3s ease, fadeIn 0.3s ease',
              boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
            }}
          >
            <Icon size={18} style={{ color: colors.icon, marginTop: 1, flexShrink: 0 }} />
            <span className="text-sm flex-1" style={{ color: 'var(--text-primary)' }}>{toast.message}</span>
            <button
              onClick={() => removeToast(toast.id)}
              className="flex items-center justify-center"
              style={{ width: 20, height: 20, borderRadius: 6, color: 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer', flexShrink: 0 }}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
