import { useEffect, useState, type FormEvent } from 'react';
import { BarChart3, ExternalLink, KanbanSquare, Loader2, Lock, LogOut, Settings, Users } from 'lucide-react';
import { ApiError, adminApi, api } from '../../shared/api';
import { SITE, applySiteSettings } from '../../shared/content';
import { JobsWorkspace } from './jobs/JobsWorkspace';
import { AccountsPanel } from './AccountsPanel';
import { InsightsPanel } from './InsightsPanel';
import { SettingsPanel } from './SettingsPanel';

const PASSWORD_KEY = 'tarjim_admin_password';

type Workspace = 'jobs' | 'accounts' | 'insights' | 'settings';
const WORKSPACES: { id: Workspace; label: string; icon: typeof Settings }[] = [
  { id: 'jobs', label: 'Jobs', icon: KanbanSquare },
  { id: 'accounts', label: 'Accounts', icon: Users },
  { id: 'insights', label: 'Insights', icon: BarChart3 },
  { id: 'settings', label: 'Settings', icon: Settings },
];

function readPassword(): string {
  try {
    return sessionStorage.getItem(PASSWORD_KEY) ?? '';
  } catch {
    return '';
  }
}

const workspaceFromHash = (): Workspace => {
  const hash = window.location.hash.slice(1);
  return hash === 'settings' || hash === 'insights' || hash === 'accounts' ? hash : 'jobs';
};

/** The /admin dashboard: sign in with ADMIN_PASSWORD, then the jobs board and the settings. */
export function AdminView() {
  const [password, setPassword] = useState(readPassword);
  const [unlocked, setUnlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workspace, setWorkspaceState] = useState<Workspace>(workspaceFromHash);

  const setWorkspace = (w: Workspace) => {
    setWorkspaceState(w);
    window.history.replaceState(null, '', w === 'jobs' ? window.location.pathname : `#${w}`);
  };

  async function signIn(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await adminApi.login(password);
      setUnlocked(true);
      try {
        sessionStorage.setItem(PASSWORD_KEY, password); // only for this browser tab
      } catch {
        /* private mode: just ask again next time */
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  }

  // Signed in earlier in this tab: go straight in.
  useEffect(() => {
    api.config().then((c) => applySiteSettings(c.site), () => {});
    if (password) signIn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function signOut() {
    try {
      sessionStorage.removeItem(PASSWORD_KEY);
    } catch {
      /* nothing stored */
    }
    setPassword('');
    setUnlocked(false);
  }

  if (!unlocked) {
    return (
      <div className="min-h-screen px-4 py-16">
        <form onSubmit={signIn} className="max-w-sm mx-auto p-6 rounded-2xl border border-slate-800 bg-slate-900 space-y-4">
          <h1 className="flex items-center gap-2 text-xl font-bold text-white">
            <Lock className="w-5 h-5 text-amber-400" /> Admin
          </h1>
          <label className="block">
            <span className="block text-sm font-medium text-slate-200 mb-1.5">Admin password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              className="w-full px-3 py-2.5 text-sm bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          </label>
          {error && <p className="p-3 text-sm rounded-xl border border-rose-800 bg-rose-950/60 text-rose-200">{error}</p>}
          <button disabled={busy || !password} className="w-full py-2.5 rounded-lg bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-slate-950 font-bold">
            {busy ? <Loader2 className="inline w-4 h-4 animate-spin" /> : 'Sign in'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="h-dvh flex flex-col md:flex-row overflow-hidden">
      {/* Slim persistent sidebar (a top strip on phones). */}
      <nav
        aria-label="Workspaces"
        className="shrink-0 flex md:flex-col items-center gap-1 px-2 py-2 md:py-3 md:w-16 border-b md:border-b-0 md:border-r border-slate-800 bg-slate-950"
      >
        <a href="/" title={`${SITE.brand.name}: open the website`} className="w-9 h-9 md:mb-3 rounded-xl bg-amber-400 text-slate-950 font-black flex items-center justify-center">
          {SITE.brand.mark}
        </a>
        {WORKSPACES.map((w) => (
          <button
            key={w.id}
            onClick={() => setWorkspace(w.id)}
            aria-current={workspace === w.id ? 'page' : undefined}
            title={w.label}
            className={`flex md:flex-col items-center gap-1.5 md:gap-0.5 px-3 md:px-0 md:w-12 h-9 md:h-12 justify-center rounded-xl text-xs ${
              workspace === w.id ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-900'
            }`}
          >
            <w.icon className="w-4 h-4" />
            <span className="md:text-[10px]">{w.label}</span>
          </button>
        ))}
        <span className="flex-1" />
        <a href="/" target="_blank" rel="noreferrer" title="Open the website" className="hidden md:flex w-10 h-10 items-center justify-center rounded-xl text-slate-500 hover:text-white hover:bg-slate-900">
          <ExternalLink className="w-4 h-4" />
        </a>
        <button onClick={signOut} title="Sign out" aria-label="Sign out" className="w-10 h-9 md:h-10 flex items-center justify-center rounded-xl text-slate-500 hover:text-white hover:bg-slate-900">
          <LogOut className="w-4 h-4" />
        </button>
      </nav>

      <main className="flex-1 min-w-0 min-h-0 overflow-hidden">
        {workspace === 'jobs' ? (
          <JobsWorkspace password={password} onSettings={() => setWorkspace('settings')} />
        ) : workspace === 'accounts' ? (
          <div className="h-full overflow-y-auto">
            <AccountsPanel password={password} />
          </div>
        ) : workspace === 'insights' ? (
          <div className="h-full overflow-y-auto">
            <InsightsPanel password={password} />
          </div>
        ) : (
          <div className="h-full overflow-y-auto">
            <SettingsPanel password={password} />
          </div>
        )}
      </main>
    </div>
  );
}
