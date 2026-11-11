import { useEffect, useState } from 'react';
import { Header, type NavTab } from './components/Header';
import { HistoryView } from './components/HistoryView';
import { TelegramView } from './components/TelegramView';
import { TranslateView } from './components/TranslateView';
import { api, type AppConfig } from './lib/api';

export default function App() {
  const [tab, setTab] = useState<NavTab>('translate');
  const [jobId, setJobId] = useState<string | null>(() => new URLSearchParams(window.location.search).get('job'));
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [configError, setConfigError] = useState(false);

  useEffect(() => {
    api.config().then(setConfig).catch(() => setConfigError(true));
  }, []);

  // Keep the address bar shareable: ?job=<id> reopens the same result.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (jobId) url.searchParams.set('job', jobId);
    else url.searchParams.delete('job');
    window.history.replaceState(null, '', url);
  }, [jobId]);

  return (
    <div className="min-h-screen flex flex-col selection:bg-amber-400 selection:text-slate-950">
      <Header tab={tab} onTab={setTab} />
      <main className="flex-1 w-full max-w-4xl mx-auto px-4 py-8">
        {configError && (
          <div className="mb-6 p-3 text-sm rounded-xl border border-rose-800 bg-rose-950/60 text-rose-200">
            The service is not reachable right now. If you run this site, check that <code>VITE_API_BASE</code> points
            at your Worker.
          </div>
        )}
        {/* Stays mounted so an upload in progress survives switching tabs. */}
        <div className={tab === 'translate' ? '' : 'hidden'}>
          <TranslateView config={config} jobId={jobId} onJob={setJobId} />
        </div>
        {tab === 'history' && (
          <HistoryView
            config={config}
            onOpen={(id) => {
              setJobId(id);
              setTab('translate');
            }}
          />
        )}
        {tab === 'telegram' && <TelegramView config={config} />}
      </main>
      <footer className="border-t border-slate-900 py-5 px-4 text-center text-xs text-slate-500">
        TarjimVideo · Whisper speech recognition · neural machine translation
      </footer>
    </div>
  );
}
