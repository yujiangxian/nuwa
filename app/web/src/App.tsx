// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { useEffect, lazy, Suspense } from 'react';
import { useUIStore } from '@/store/uiStore';
import { useThemeEffect } from '@/hooks/useThemeEffect';
import { useLangEffect } from '@/hooks/useLangEffect';
import { useKeybindings } from '@/hooks/useKeybindings';
import HomePage from '@/components/HomePage';
import CharactersPage from '@/components/CharactersPage';
import PromptPresetsPage from '@/components/PromptPresetsPage';
import SettingsModal from '@/components/SettingsModal';
import CommandPalette from '@/components/CommandPalette';
import ToastContainer from '@/components/ToastContainer';
import { Loader2 } from 'lucide-react';

const ChatPage = lazy(() => import('@/components/ChatPage'));
const VoiceStudioPage = lazy(() => import('@/components/VoiceStudioPage'));
const TranscribePage = lazy(() => import('@/components/TranscribePage'));
const ModelsPage = lazy(() => import('@/components/ModelsPage'));
const WorkflowPage = lazy(() => import('@/components/WorkflowPage'));
const PlaygroundPage = lazy(() => import('@/components/PlaygroundPage'));

const PageLoader = () => (
  <div className="flex items-center justify-center h-full" style={{ color: 'var(--text-muted)' }}>
    <Loader2 size={24} className="animate-spin" />
  </div>
);

function App() {
  // 运行期主题副作用：应用 settings.theme 并在 system 模式跟随系统偏好（Req 2.1/3.4）。
  useThemeEffect();
  // 运行期语言副作用：将 <html lang> 同步为当前 LocaleCode（Req 6.1/6.2）。
  useLangEffect();
  // 全局键盘快捷键引擎：mod+k 唤起/关闭命令面板、Escape 关闭最上层模态（command-palette Req 6）。
  useKeybindings();

  const currentPage = useUIStore((s) => s.currentPage);
  const setPage = useUIStore((s) => s.setPage);
  const loadSessions = useUIStore((s) => s.loadSessions);
  const loadCharacters = useUIStore((s) => s.loadCharacters);
  const loadPresets = useUIStore((s) => s.loadPresets);

  // 启动初始化：挂载时触发一次会话恢复、角色恢复与预设恢复（init -> 恢复 / 种子 / 降级）。
  useEffect(() => {
    void loadSessions();
    void loadCharacters();
    void loadPresets();
  }, [loadSessions, loadCharacters, loadPresets]);

  // Sync URL <-> state bidirectionally
  useEffect(() => {
    const pathToPage: Record<string, string> = {
      '/': 'home',
      '/chat': 'chat',
      '/voice': 'voice',
      '/transcribe': 'transcribe',
      '/models': 'models',
      '/characters': 'characters',
      '/presets': 'presets',
      '/workflow': 'workflow',
      '/playground': 'playground',
    };
    // Init from URL on mount
    const path = window.location.pathname;
    const pageFromUrl = pathToPage[path];
    if (pageFromUrl && pageFromUrl !== currentPage) {
      setPage(pageFromUrl as any);
    }

    // Listen browser back/forward
    const onPop = () => {
      const p = pathToPage[window.location.pathname];
      if (p) setPage(p as any);
    };
    window.addEventListener('popstate', onPop);

    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Update URL when page changes (with transition)
  useEffect(() => {
    const targetPath =
      currentPage === 'home' ? '/' :
      currentPage === 'chat' ? '/chat' :
      currentPage === 'voice' ? '/voice' :
      currentPage === 'transcribe' ? '/transcribe' :
      currentPage === 'models' ? '/models' :
      currentPage === 'characters' ? '/characters' :
      currentPage === 'presets' ? '/presets' :
      currentPage === 'workflow' ? '/workflow' :
      currentPage === 'playground' ? '/playground' : '/';
    if (window.location.pathname !== targetPath) {
      window.history.pushState({}, '', targetPath);
    }
  }, [currentPage]);

  // Page transition animation
  const renderPage = () => {
    switch (currentPage) {
      case 'home': return <HomePage />;
      case 'chat': return <Suspense fallback={<PageLoader />}><ChatPage /></Suspense>;
      case 'voice': return <Suspense fallback={<PageLoader />}><VoiceStudioPage /></Suspense>;
      case 'transcribe': return <Suspense fallback={<PageLoader />}><TranscribePage /></Suspense>;
      case 'models': return <Suspense fallback={<PageLoader />}><ModelsPage /></Suspense>;
      case 'characters': return <CharactersPage />;
      case 'presets': return <PromptPresetsPage />;
      case 'workflow': return <Suspense fallback={<PageLoader />}><WorkflowPage /></Suspense>;
      case 'playground': return <Suspense fallback={<PageLoader />}><PlaygroundPage /></Suspense>;
      default: return <HomePage />;
    }
  };

  return (
    <div className="h-screen w-screen overflow-hidden relative" style={{ zIndex: 10 }}>
      <div
        className="h-full w-full"
        style={{
          transition: 'opacity 0.2s ease, transform 0.2s ease',
        }}
      >
        {renderPage()}
      </div>
      <SettingsModal />
      <CommandPalette />
      <ToastContainer />
    </div>
  );
}

export default App;
