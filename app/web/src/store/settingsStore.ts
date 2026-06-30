/// 应用设置独立 store — 从 uiStore 拆分。
/// 管理 theme、language、autoPlay、backendUrl、modelsDir 五个字段，
/// 持久化到 localStorage 键 `nuwa_settings`。

import { create } from 'zustand';
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
      const merged = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
      if (merged.backendUrl === LEGACY_DEFAULT_BACKEND_URL) {
        merged.backendUrl = DEFAULT_SETTINGS.backendUrl;
        saveSettings(merged);
      }
      return merged;
    }
  } catch { /* localStorage 不可用时静默降级 */ }
  return DEFAULT_SETTINGS;
}

function saveSettings(s: AppSettings): void {
  try {
    localStorage.setItem('nuwa_settings', JSON.stringify(s));
  } catch { /* localStorage 不可用时静默降级 */ }
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
  },
}));
