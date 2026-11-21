import { Suspense, lazy, useEffect, useState } from 'react';
import { HistoryView } from '../modules/history';
import { TelegramView } from '../modules/telegram';
import { TranslateView } from '../modules/translate';
import { AccountButton, AccountDialog } from '../modules/account';
import { accountApi, api, type AppConfig, type Me } from '../shared/api';
import { SITE, applySiteSettings } from '../shared/content';
import { Header, type NavTab } from './Header';

// The dashboard (drag and drop, virtual lists) is only downloaded by people who open /admin.
const AdminView = lazy(() => import('../modules/admin').then((m) => ({ default: m.AdminView })));

const IS_ADMIN = window.location.pathname.replace(/\/+$/, '') === '/admin';

const SIGNIN_NOTICE: Record<string, string> = {
  ok: 'You are signed in.',
  expired: 'That sign-in link has expired or was already used. Ask for a new one.',
  failed: 'Signing in with Google did not work. Please try again.',
  unavailable: 'That way of signing in is not available.',
};

export default function App() {
  return IS_ADMIN ? (
    <div className="selection:bg-amber-400 selection:text-slate-950">
      <Suspense fallback={null}>
        <AdminView />
      </Suspense>
    </div>
  ) : (
    <Site />
  );
}

function Site() {
  const [tab, setTab] = useState<NavTab>('translate');
  const [jobId, setJobId] = useState<string | null>(() => new URLSearchParams(window.location.search).get('job'));
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [configError, setConfigError] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  // Coming back from an email link or Google: ?signin=ok|expired|failed|unavailable.
  const [signinNotice, setSigninNotice] = useState<string | null>(() => {
    const result = new URLSearchParams(window.location.search).get('signin');
    return result ? SIGNIN_NOTICE[result] ?? null : null;
  });
  const [accountOpen, setAccountOpen] = useState(Boolean(signinNotice));
  const refreshMe = () => accountApi.me().then(setMe, () => {});

  useEffect(() => {
    refreshMe();
    const url = new URL(window.location.href);
    if (url.searchParams.has('signin')) {
      url.searchParams.delete('signin');
      window.history.replaceState(null, '', url);
    }
  }, []);

  useEffect(() => {
    api
      .config()
      .then((c) => {
        applySiteSettings(c.site); // before setConfig, so the re-render shows the saved name, logo and texts
        setConfig(c);
      })
      .catch(() => setConfigError(true));
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
      <Header tab={tab} onTab={setTab} account={
          <AccountButton
            me={me}
            onOpen={() => {
              refreshMe(); // the balance may have changed since (a job finished or was refunded)
              setAccountOpen(true);
            }}
          />
        } />
      {accountOpen && me && (
        <AccountDialog
          me={me}
          notice={signinNotice}
          onChange={setMe}
          onClose={() => {
            setAccountOpen(false);
            setSigninNotice(null);
          }}
        />
      )}
      <main className="flex-1 w-full max-w-4xl mx-auto px-4 py-8">
        {configError && (
          <div className="mb-6 p-3 text-sm rounded-xl border border-rose-800 bg-rose-950/60 text-rose-200">
            The service is not reachable right now. If you run this site, check that <code>VITE_API_BASE</code> points
            at your Worker.
          </div>
        )}
        {/* Stays mounted so an upload in progress survives switching tabs. */}
        <div className={tab === 'translate' ? '' : 'hidden'}>
          <TranslateView config={config} jobId={jobId} onJob={setJobId} onCreditsChanged={refreshMe} />
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
        {SITE.brand.footer}
      </footer>
    </div>
  );
}
