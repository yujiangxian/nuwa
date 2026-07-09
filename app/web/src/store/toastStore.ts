// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { create } from 'zustand';

export interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
  duration?: number;
}

interface ToastState {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
}

const MAX_TOASTS = 5;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  addToast: (toast) => {
    const id = Date.now().toString() + Math.random().toString(36).slice(2, 6);
    set((s) => {
      const updated = [...s.toasts, { ...toast, id }];
      // Enforce max visible count: remove oldest when exceeding limit
      if (updated.length > MAX_TOASTS) {
        return { toasts: updated.slice(updated.length - MAX_TOASTS) };
      }
      return { toasts: updated };
    });
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, toast.duration ?? 3000);
  },
  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
