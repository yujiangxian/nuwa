// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

/// 应用设置独立 store — 从 uiStore 拆分。
/// 管理 theme、language、autoPlay、backendUrl、modelsDir 五个字段，
/// 持久化到 localStorage 键 `nuwa_settings`。

import { create } from 'zustand';
import { setApiBaseUrl } from '@/api/client';
import type { AppSettings } from './types';

const LEGACY_DEFAULT_BACKEND_URL = 'http://localhost:9880';

const DEFAULT_SETTINGS: AppSettings = {
  backendUrl: 'http://localhost:8080',
  modelsDir: './models',
  theme: 'dark',
  autoPlay: true,
  language: '简体中文',
};

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem('nuwa_settings');
    if (raw) {
      const parsed = JSON.parse(raw);
      // Validate types before merging
      if (typeof parsed !== 'object' || parsed === null) {
        console.warn('nuwa_settings is not an object, resetting to defaults');
        return { ...DEFAULT_SETTINGS };
      }
      const merged = { ...DEFAULT_SETTINGS };
      if (typeof parsed.backendUrl === 'string') merged.backendUrl = parsed.backendUrl;
      if (typeof parsed.modelsDir === 'string') merged.modelsDir = parsed.modelsDir;
      if (typeof parsed.theme === 'string') merged.theme = parsed.theme as AppSettings['theme'];
      if (typeof parsed.autoPlay === 'boolean') merged.autoPlay = parsed.autoPlay;
      if (typeof parsed.language === 'string') merged.language = parsed.language;
      if (merged.backendUrl === LEGACY_DEFAULT_BACKEND_URL) {
        merged.backendUrl = DEFAULT_SETTINGS.backendUrl;
        saveSettings(merged);
      }
      return merged;
    }
  } catch { /* localStorage 不可用时静默降级 */ }
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(s: AppSettings): void {
  try {
    localStorage.setItem('nuwa_settings', JSON.stringify(s));
  } catch {
    console.warn('Failed to save settings to localStorage (quota exceeded?)');
  }
}

interface SettingsState {
  settings: AppSettings;
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: loadSettings(),
  updateSetting: (key, value) => {
    const next = { ...get().settings, [key]: value };
    saveSettings(next);
    set({ settings: next });
    if (key === 'backendUrl') setApiBaseUrl(String(value));
  },
}));

// Wire axios / apiUrl to persisted settings at module load.
setApiBaseUrl(useSettingsStore.getState().settings.backendUrl);
