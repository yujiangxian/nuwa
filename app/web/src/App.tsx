// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { useEffect, lazy, Suspense } from 'react';
import { useUIStore } from '@/store/uiStore';
import { useThemeEffect } from '@/hooks/useThemeEffect';
import { useLangEffect } from '@/hooks/useLangEffect';
import { useKeybindings } from '@/hooks/useKeybindings';
import HomePage from '@/components/HomePage';
import PromptPresetsPage from '@/components/PromptPresetsPage';
import AgentsPage from '@/components/AgentsPage';
import SettingsModal from '@/components/SettingsModal';
import CommandPalette from '@/components/CommandPalette';
import ToastContainer from '@/components/ToastContainer';
import { Loader2 } from 'lucide-react';

const ChatPage = lazy(() => import('@/components/ChatPage'));
const VoiceStudioPage = lazy(() => import('@/components/VoiceStudioPage'));
const TranscribePage = lazy(() => import('@/components/TranscribePage'));
const ModelsPage = lazy(() => import('@/components/ModelsPage'));
const PlaygroundPage = lazy(() => import('@/components/PlaygroundPage'));

const PageLoader = () => (
  <div className="flex items-center justify-center h-full" style={{ color: 'var(--text-muted)' }}>
    <Loader2 size={24} className="animate-spin" />
  </div>
);

function App() {
  useThemeEffect();
  useLangEffect();
  useKeybindings();

  const currentPage = useUIStore((s) => s.currentPage);
  const setPage = useUIStore((s) => s.setPage);
  const loadSessions = useUIStore((s) => s.loadSessions);
  const loadAgents = useUIStore((s) => s.loadAgents);
  const loadPresets = useUIStore((s) => s.loadPresets);

  useEffect(() => {
    void loadSessions();
    void loadAgents();
    void loadPresets();
  }, [loadSessions, loadAgents, loadPresets]);

  useEffect(() => {
    const pathToPage: Record<string, string> = {
      '/': 'home',
      '/chat': 'chat',
      '/voice': 'voice',
      '/transcribe': 'transcribe',
      '/models': 'models',
      '/presets': 'presets',
      '/agents': 'agents',
      '/playground': 'playground',
    };
    // Legacy URLs → agents
    if (window.location.pathname === '/workflow' || window.location.pathname === '/characters') {
      setPage('agents');
      window.history.replaceState({}, '', '/agents');
      return;
    }
    const path = window.location.pathname;
    const pageFromUrl = pathToPage[path];
    if (pageFromUrl && pageFromUrl !== currentPage) {
      setPage(pageFromUrl as Parameters<typeof setPage>[0]);
    }

    const onPop = () => {
      const p = pathToPage[window.location.pathname];
      if (p) setPage(p as Parameters<typeof setPage>[0]);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const targetPath =
      currentPage === 'home' ? '/' :
      currentPage === 'chat' ? '/chat' :
      currentPage === 'voice' ? '/voice' :
      currentPage === 'transcribe' ? '/transcribe' :
      currentPage === 'models' ? '/models' :
      currentPage === 'presets' ? '/presets' :
      currentPage === 'agents' ? '/agents' :
      currentPage === 'playground' ? '/playground' : '/';
    if (window.location.pathname !== targetPath) {
      window.history.pushState({}, '', targetPath);
    }
  }, [currentPage]);

  const renderPage = () => {
    switch (currentPage) {
      case 'home': return <HomePage />;
      case 'chat': return <Suspense fallback={<PageLoader />}><ChatPage /></Suspense>;
      case 'voice': return <Suspense fallback={<PageLoader />}><VoiceStudioPage /></Suspense>;
      case 'transcribe': return <Suspense fallback={<PageLoader />}><TranscribePage /></Suspense>;
      case 'models': return <Suspense fallback={<PageLoader />}><ModelsPage /></Suspense>;
      case 'presets': return <PromptPresetsPage />;
      case 'agents': return <AgentsPage />;
      case 'playground': return <Suspense fallback={<PageLoader />}><PlaygroundPage /></Suspense>;
      default: return <HomePage />;
    }
  };

  return (
    <div className="h-screen w-screen overflow-hidden relative" style={{ zIndex: 10 }}>
      <div className="h-full w-full" style={{ transition: 'opacity 0.2s ease, transform 0.2s ease' }}>
        {renderPage()}
      </div>
      <SettingsModal />
      <CommandPalette />
      <ToastContainer />
    </div>
  );
}

export default App;
