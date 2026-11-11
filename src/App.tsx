import React, { useState, useEffect } from 'react';
import { Header, NavTab } from './components/Header';
import { WebChannelView } from './components/WebChannelView';
import { MyTranslationsView } from './components/MyTranslationsView';
import { TelegramBotView } from './components/TelegramBotView';
import { ArchitectureView } from './components/ArchitectureView';
import { AdminControlPanelView } from './components/AdminControlPanelView';
import { AuthProvider } from './context/AuthContext';
import { UserTranslationRecord } from './types/pipeline';

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('web');
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  useEffect(() => {
    // Check URL parameters for shared video or job ID
    const params = new URLSearchParams(window.location.search);
    const sharedJob = params.get('job') || params.get('share');
    if (sharedJob) {
      setSelectedJobId(sharedJob);
      setActiveTab('web');
    }
  }, []);

  const handleSelectTranslation = (item: UserTranslationRecord) => {
    setSelectedJobId(item.id);
    setActiveTab('web');
  };

  return (
    <AuthProvider>
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-amber-400 selection:text-slate-950">
        {/* Top Bar Navigation */}
        <Header
          activeTab={activeTab}
          onTabChange={(tab) => setActiveTab(tab)}
          onNewJobClick={() => {
            setSelectedJobId(null);
            setActiveTab('web');
          }}
        />

        {/* Main Viewport Content */}
        <main className="flex-1">
          {activeTab === 'web' && (
            <WebChannelView
              targetJobId={selectedJobId}
              onClearTargetJob={() => setSelectedJobId(null)}
            />
          )}
          {activeTab === 'my_translations' && (
            <MyTranslationsView
              onSelectTranslation={handleSelectTranslation}
              onNavigateToTranslator={() => {
                setSelectedJobId(null);
                setActiveTab('web');
              }}
            />
          )}
          {activeTab === 'telegram' && <TelegramBotView />}
          {activeTab === 'architecture' && <ArchitectureView />}
          {activeTab === 'admin' && <AdminControlPanelView />}
        </main>

        {/* Professional, Privacy-Safe Footer */}
        <footer className="border-t border-slate-900 py-6 px-6 text-center text-xs text-slate-500">
          <div className="flex flex-wrap items-center justify-center gap-2">
            <span>TarjimVideo Platform</span>
            <span aria-hidden="true">·</span>
            <span>Whisper ASR Speech-to-Text</span>
            <span aria-hidden="true">·</span>
            <span>Neural Arabic Translation (NMT)</span>
            <span aria-hidden="true">·</span>
            <span>Cloudflare &amp; Hugging Face Compute</span>
          </div>
        </footer>
      </div>
    </AuthProvider>
  );
}
