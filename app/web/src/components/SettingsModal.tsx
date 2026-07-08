import { useUIStore } from '@/store/uiStore';
import { useToastStore } from '@/store/toastStore';
import { useI18n } from '@/hooks/useI18n';
import { LOCALE_LABELS, SUPPORTED_LOCALES } from '@/lib/i18n';
import { apiClient } from '@/api/client';
import { X, Moon, Sun, Monitor, FolderOpen, Download, Trash2 } from 'lucide-react';

export default function SettingsModal() {
  const isOpen = useUIStore((s) => s.isSettingsOpen);
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen);
  const settings = useUIStore((s) => s.settings);
  const updateSetting = useUIStore((s) => s.updateSetting);
  const addToast = useToastStore((s) => s.addToast);
  const { t } = useI18n();

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(16px)', animation: 'fadeIn 0.3s ease' }}
      onClick={(e) => { if (e.target === e.currentTarget) setSettingsOpen(false); }}
    >
      <div
        className="w-full max-w-sm mx-5 overflow-hidden"
        style={{
          background: 'linear-gradient(180deg, rgba(255,255,255,0.03) 0%, var(--surface) 100%)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 32px 80px rgba(0,0,0,0.5)',
          border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: 20,
          maxHeight: '82vh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{t('settings.title')}</h2>
          <button
            className="flex items-center justify-center"
            style={{ width: 36, height: 36, borderRadius: 10, color: 'var(--text-secondary)', background: 'transparent', border: 'none', cursor: 'pointer', transition: 'all 0.2s ease' }}
            onClick={() => setSettingsOpen(false)}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-hover)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)'; }}
          >
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Theme */}
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-[0.08em] mb-3 block" style={{ color: 'var(--text-muted)' }}>{t('settings.appearance')}</label>
            <div className="flex gap-3">
              {[
                { value: 'dark' as const, icon: Moon, label: t('settings.theme.dark') },
                { value: 'light' as const, icon: Sun, label: t('settings.theme.light') },
                { value: 'system' as const, icon: Monitor, label: t('settings.theme.system') },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => updateSetting('theme', opt.value)}
                  className="flex-1 rounded-xl p-3 text-center border transition-all cursor-pointer"
                  style={{
                    background: settings.theme === opt.value ? 'rgba(72,202,228,0.08)' : 'var(--surface)',
                    borderColor: settings.theme === opt.value ? 'rgba(72,202,228,0.3)' : 'transparent',
                  }}
                >
                  <opt.icon size={26} style={{ color: settings.theme === opt.value ? 'var(--primary)' : 'var(--text-secondary)', margin: '0 auto' }} />
                  <div className="text-xs mt-1.5 font-medium" style={{ color: settings.theme === opt.value ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{opt.label}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Backend */}
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-[0.08em] mb-2 block" style={{ color: 'var(--text-muted)' }}>{t('settings.backendUrl')}</label>
            <input
              type="text"
              value={settings.backendUrl}
              onChange={(e) => updateSetting('backendUrl', e.target.value)}
              className="w-full rounded-xl px-4 py-2.5 text-sm outline-none"
              style={{ background: 'var(--surface)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
            />
          </div>

          {/* Models Dir */}
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-[0.08em] mb-2 block" style={{ color: 'var(--text-muted)' }}>{t('settings.modelsDir')}</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={settings.modelsDir}
                onChange={(e) => updateSetting('modelsDir', e.target.value)}
                className="flex-1 rounded-xl px-4 py-2.5 text-sm outline-none"
                style={{ background: 'var(--surface)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
              />
              <button
                title="保存模型目录到服务端配置"
                onClick={async () => {
                  try {
                    const resp = await apiClient.get('/api/config');
                    const cfg = (resp as any).data;
                    await apiClient.post('/api/config', { ...cfg, models_dir: settings.modelsDir });
                    addToast({ message: '模型目录已保存，请重启服务生效', type: 'success' });
                  } catch {
                    addToast({ message: '保存失败，请检查后端连接', type: 'error' });
                  }
                }}
                className="flex items-center justify-center"
                style={{ width: 38, height: 38, borderRadius: 10, color: 'var(--text-secondary)', background: 'transparent', border: 'none', cursor: 'pointer', transition: 'all 0.2s ease' }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-hover)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)'; }}
              >
                <FolderOpen size={18} />
              </button>
            </div>
          </div>

          <div className="h-px" style={{ background: 'var(--border)' }} />

          {/* Language */}
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-[0.08em] mb-2 block" style={{ color: 'var(--text-muted)' }}>{t('settings.language')}</label>
            <select
              value={settings.language}
              onChange={(e) => updateSetting('language', e.target.value)}
              className="w-full rounded-xl px-4 py-2.5 text-sm cursor-pointer outline-none"
              style={{
                appearance: 'none', WebkitAppearance: 'none',
                background: 'var(--surface)', color: 'var(--text-primary)', border: '1px solid var(--border)',
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%236A9EAD' stroke-width='2.5'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
                backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center',
              }}
            >
              {SUPPORTED_LOCALES.map((code) => (
                <option key={code}>{LOCALE_LABELS[code]}</option>
              ))}
            </select>
          </div>

          {/* Auto Play */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{t('settings.autoPlay.title')}</div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{t('settings.autoPlay.desc')}</div>
            </div>
            <button
              onClick={() => updateSetting('autoPlay', !settings.autoPlay)}
              className="relative inline-flex items-center cursor-pointer"
              style={{ width: 44, height: 24, borderRadius: 12, background: settings.autoPlay ? 'var(--primary)' : 'rgba(255,255,255,0.08)', transition: 'background 0.2s ease', border: 'none' }}
            >
              <span
                className="absolute top-0.5 rounded-full transition-transform"
                style={{
                  width: 20, height: 20,
                  background: 'white',
                  left: settings.autoPlay ? 22 : 2,
                  transition: 'left 0.2s ease',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                }}
              />
            </button>
          </div>

          {/* Keyboard Shortcuts */}
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-[0.08em] mb-3 block" style={{ color: 'var(--text-muted)' }}>快捷键</label>
            <div className="space-y-2">
              {[
                { key: 'Ctrl+K', desc: '命令面板' },
                { key: 'Ctrl+N', desc: '新建对话' },
                { key: 'Enter', desc: '发送消息' },
                { key: 'Shift+Enter', desc: '换行' },
                { key: 'Escape', desc: '停止生成 / 清空输入' },
              ].map((shortcut) => (
                <div key={shortcut.key} className="flex items-center justify-between rounded-lg px-3 py-2" style={{ background: 'var(--surface)' }}>
                  <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{shortcut.desc}</span>
                  <kbd className="text-[11px] font-mono px-2 py-0.5 rounded" style={{ color: 'var(--primary)', background: 'rgba(72,202,228,0.08)', border: '1px solid rgba(72,202,228,0.15)' }}>
                    {shortcut.key}
                  </kbd>
                </div>
              ))}
            </div>
          </div>

          <div className="h-px" style={{ background: 'var(--border)' }} />

          {/* Data management */}
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-[0.08em] mb-3 block" style={{ color: 'var(--text-muted)' }}>数据管理</label>
            <div className="space-y-2">
              <button
                onClick={async () => {
                  try {
                    const store = useUIStore.getState();
                    const sessions = await store.collectExportSessions('all');
                    const bundle = {
                      exportedAt: new Date().toISOString(),
                      version: 'nuwa-v0.3.0',
                      sessions,
                      characters: store.characters,
                      presets: store.presets,
                      settings: store.settings,
                    };
                    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json;charset=utf-8' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `nuwa-backup-${new Date().toISOString().slice(0, 10)}.json`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                    addToast({ message: '数据已导出（音频文件不可跨机器迁移，需重新合成）', type: 'success', duration: 6000 });
                  } catch {
                    addToast({ message: '导出失败', type: 'error' });
                  }
                }}
                className="flex items-center gap-2 w-full rounded-lg px-4 py-2.5 text-sm font-medium cursor-pointer transition-all"
                style={{ background: 'rgba(72,202,228,0.08)', color: 'var(--primary)', border: '1px solid rgba(72,202,228,0.15)' }}
              >
                <Download size={16} />
                导出全部数据
              </button>
              <button
                onClick={async () => {
                  if (!window.confirm('确定要清除所有本地数据和服务器临时文件吗？此操作不可撤销，应用将重新加载。')) return;
                  // Also clean server-side output files
                  try { await apiClient.post('/api/system/cleanup'); } catch { /* ignore */ }
                  indexedDB.deleteDatabase('nuwa-chat');
                  localStorage.clear();
                  window.location.reload();
                }}
                className="flex items-center gap-2 w-full rounded-lg px-4 py-2.5 text-sm font-medium cursor-pointer transition-all"
                style={{ background: 'rgba(255,107,107,0.08)', color: '#FF6B6B', border: '1px solid rgba(255,107,107,0.15)' }}
              >
                <Trash2 size={16} />
                清除本地数据
              </button>
            </div>
          </div>

          <div className="text-center pt-1">
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>女娲 Nuwa v0.2.0 · Build 20250505</p>
          </div>
        </div>
      </div>
    </div>
  );
}
