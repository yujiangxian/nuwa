import { useUIStore } from '@/store/uiStore';
import { useI18n } from '@/hooks/useI18n';
import { MessageSquare, Music, Mic, Monitor, Settings, AudioWaveform, Users, MessageSquareText, Workflow } from 'lucide-react';

const features = [
  { id: 'chat' as const, titleKey: 'home.feature.chat.title', descKey: 'home.feature.chat.desc', icon: MessageSquare, color: '#48CAE4', bg: 'rgba(72,202,228,0.08)', border: 'rgba(72,202,228,0.15)' },
  { id: 'characters' as const, titleKey: 'home.feature.characters.title', descKey: 'home.feature.characters.desc', icon: Users, color: '#9B5DE5', bg: 'rgba(155,93,229,0.08)', border: 'rgba(155,93,229,0.15)' },
  { id: 'presets' as const, titleKey: 'home.feature.presets.title', descKey: 'home.feature.presets.desc', icon: MessageSquareText, color: '#F4A261', bg: 'rgba(244,162,97,0.08)', border: 'rgba(244,162,97,0.15)' },
  { id: 'voice' as const, titleKey: 'home.feature.voice.title', descKey: 'home.feature.voice.desc', icon: Music, color: '#FF6B9D', bg: 'rgba(255,107,157,0.08)', border: 'rgba(255,107,157,0.15)' },
  { id: 'transcribe' as const, titleKey: 'home.feature.transcribe.title', descKey: 'home.feature.transcribe.desc', icon: Mic, color: '#52B788', bg: 'rgba(82,183,136,0.08)', border: 'rgba(82,183,136,0.15)' },
  { id: 'models' as const, titleKey: 'home.feature.models.title', descKey: 'home.feature.models.desc', icon: Monitor, color: '#D4AF37', bg: 'rgba(212,175,55,0.08)', border: 'rgba(212,175,55,0.15)' },
  { id: 'workflow' as const, title: '工作流编排', desc: '可视化搭建并单步执行多智能体工作流', icon: Workflow, color: '#48E5C2', bg: 'rgba(72,229,194,0.08)', border: 'rgba(72,229,194,0.15)' },
];

export default function HomePage() {
  const setPage = useUIStore((s) => s.setPage);
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen);
  const { t } = useI18n();

  return (
    <div className="flex flex-col h-full relative" style={{ zIndex: 10 }}>
      <header className="relative z-20 flex items-center justify-between px-6 py-4 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, var(--primary), var(--primary-dim))', boxShadow: '0 0 16px var(--primary-glow)' }}>
            <AudioWaveform size={18} style={{ color: 'var(--bg)' }} />
          </div>
          <span className="text-lg font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>女娲</span>
        </div>
        <button
          className="flex items-center justify-center"
          style={{ width: 36, height: 36, borderRadius: 10, color: 'var(--text-secondary)', background: 'transparent', border: 'none', cursor: 'pointer', transition: 'all 0.2s ease' }}
          onClick={() => setSettingsOpen(true)}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-hover)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)'; }}
        >
          <Settings size={22} />
        </button>
      </header>

      <div className="flex-1 flex flex-col items-center justify-center px-6 relative">
        <div className="text-center mb-10">
          <h1 className="text-2xl font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>女娲 Nuwa</h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{t('home.subtitle')}</p>
        </div>

        <div className="grid grid-cols-2 gap-4 w-full max-w-md">
          {features.map((f) => (
            <button
              key={f.id}
              onClick={() => setPage(f.id)}
              className="glass glow-edge rounded-2xl p-6 text-left cursor-pointer transition-all"
              style={{
                border: `1px solid ${f.border}`,
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.filter = 'brightness(1.15)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.filter = 'brightness(1)'; }}
            >
              <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-4" style={{ background: f.bg, border: `1px solid ${f.border}` }}>
                <f.icon size={24} style={{ color: f.color }} />
              </div>
              <h3 className="text-base font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>{'title' in f ? f.title : t(f.titleKey)}</h3>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{'desc' in f ? f.desc : t(f.descKey)}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
