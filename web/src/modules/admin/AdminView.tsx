import { useEffect, useState, type FormEvent } from 'react';
import { BarChart3, BookOpenCheck, TrendingUp, ExternalLink, KanbanSquare, Megaphone, Loader2, Lock, LogOut, MessageSquareHeart, ScrollText, Settings, ToggleRight, ShieldAlert, Users } from 'lucide-react';
import { ADMIN_SIGNED_OUT, ApiError, adminApi, api } from '../../shared/api';
import { SITE, applySiteSettings } from '../../shared/content';
import { JobsWorkspace } from './jobs/JobsWorkspace';
import { AccountsPanel } from './AccountsPanel';
import { FeedbackPanel } from './FeedbackPanel';
import { AuditPanel } from './AuditPanel';
import { BannersPanel } from './BannersPanel';
import { FeaturesPanel } from './FeaturesPanel';
import { GrowthPanel } from './GrowthPanel';
import { InsightsPanel } from './InsightsPanel';
import { LearningPanel } from './LearningPanel';
import { ModerationPanel } from './ModerationPanel';
import { SettingsPanel } from './SettingsPanel';

const TOKEN_KEY = 'kavox_admin_token';

type Workspace = 'jobs' | 'growth' | 'banners' | 'accounts' | 'moderation' | 'feedback' | 'audit' | 'features' | 'insights' | 'learning' | 'settings';
const WORKSPACES: { id: Workspace; label: string; icon: typeof Settings }[] = [
  { id: 'jobs', label: 'Jobs', icon: KanbanSquare },
  { id: 'growth', label: 'Growth', icon: TrendingUp },
  { id: 'banners', label: 'Banners', icon: Megaphone },
  { id: 'accounts', label: 'Accounts', icon: Users },
  { id: 'moderation', label: 'Reports', icon: ShieldAlert },
  { id: 'feedback', label: 'Feedback', icon: MessageSquareHeart },
  { id: 'audit', label: 'Audit', icon: ScrollText },
  { id: 'features', label: 'Features', icon: ToggleRight },
  { id: 'insights', label: 'Insights', icon: BarChart3 },
  { id: 'learning', label: 'Learning', icon: BookOpenCheck },
  { id: 'settings', label: 'Settings', icon: Settings },
];

/** The sign-in token from /api/admin/login (12 hours), kept for this browser tab only. */
function readToken(): string {
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY) ?? '';
    const exp = Number(raw.split('.')[1] ?? 0);
    return exp * 1000 > Date.now() ? raw : '';
  } catch {
    return '';
  }
}

const workspaceFromHash = (): Workspace => {
  const hash = window.location.hash.slice(1);
  return hash === 'growth' || hash === 'banners' || hash === 'settings' || hash === 'insights' || hash === 'accounts' || hash === 'learning' || hash === 'audit' || hash === 'features' ? hash : 'jobs';
};

/**
 * The /admin dashboard: sign in with ADMIN_PASSWORD (and, when two-step sign-in is on, the
 * authenticator app's code), then the workspaces. The password is never kept: only a sign-in
 * token that ends after 12 hours.
 */
export function AdminView() {
  const [token, setToken] = useState(readToken);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needsCode, setNeedsCode] = useState(false);
  // Two-step sign-in is off (no ADMIN_TOTP_SECRET): say so until it is set.
  const [singleStep, setSingleStep] = useState(() => {
    try {
      return sessionStorage.getItem(TOKEN_KEY + ':1step') === '1';
    } catch {
      return false;
    }
  });
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
      const r = await adminApi.login(password, code);
      setToken(r.token);
      setSingleStep(!r.two_factor);
      setPassword('');
      setCode('');
      setUnlocked(true);
      try {
        sessionStorage.setItem(TOKEN_KEY, r.token); // only for this browser tab
        sessionStorage.setItem(TOKEN_KEY + ':1step', r.two_factor ? '0' : '1');
        sessionStorage.removeItem('tarjim_admin_password'); // kept by older versions
      } catch {
        /* private mode: just ask again next time */
      }
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'E_2FA_REQUIRED' || err.code === 'E_2FA_WRONG')) setNeedsCode(true);
      setError(err instanceof ApiError && err.code !== 'E_2FA_REQUIRED' ? err.message : err instanceof ApiError ? null : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  }

  // The server refused the token (it ended, or the password or two-step secret changed): sign in again.
  useEffect(() => {
    const ended = () => {
      signOut();
      setError('Your sign-in ended. Sign in again.');
    };
    window.addEventListener(ADMIN_SIGNED_OUT, ended);
    return () => window.removeEventListener(ADMIN_SIGNED_OUT, ended);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Signed in earlier in this tab (and the sign-in has not ended): go straight in.
  useEffect(() => {
    api.config().then((c) => applySiteSettings(c.site), () => {});
    if (token) adminApi.stats(token).then(() => setUnlocked(true), () => signOut());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function signOut() {
    try {
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      /* nothing stored */
    }
    setToken('');
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
          {needsCode && (
            <label className="block">
              <span className="block text-sm font-medium text-slate-200 mb-1.5">Code from your authenticator app</span>
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9 ]{6,7}"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoFocus
                placeholder="123 456"
                className="w-full px-3 py-2.5 text-lg tracking-widest bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </label>
          )}
          {error && <p className="p-3 text-sm rounded-xl border border-rose-800 bg-rose-950/60 text-rose-200">{error}</p>}
          <button disabled={busy || !password || (needsCode && code.replace(/\s/g, '').length !== 6)} className="w-full py-2.5 rounded-lg bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-slate-950 font-bold">
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
        className="shrink-0 flex md:flex-col items-center gap-1 px-2 py-2 md:py-3 md:w-16 overflow-x-auto md:overflow-visible [scrollbar-width:none] border-b md:border-b-0 md:border-r border-slate-800 bg-slate-950"
      >
        <a href="/" title={`${SITE.brand.name}: open the website`} className="w-9 h-9 md:mb-3 rounded-xl flex items-center justify-center overflow-hidden">
          {SITE.brand.logo ? (
            <img src={SITE.brand.logo} alt={SITE.brand.name} className="w-full h-full object-contain" />
          ) : (
            <span className="w-full h-full rounded-xl bg-amber-400 text-slate-950 font-black flex items-center justify-center">{(SITE.brand.mark || SITE.brand.name).slice(0, 1)}</span>
          )}
        </a>
        {WORKSPACES.map((w) => (
          <button
            key={w.id}
            onClick={() => setWorkspace(w.id)}
            aria-current={workspace === w.id ? 'page' : undefined}
            title={w.label}
            className={`shrink-0 flex md:flex-col items-center gap-1.5 md:gap-0.5 px-3 md:px-0 md:w-12 h-9 md:h-12 justify-center rounded-xl text-xs ${
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

      <main className="flex-1 min-w-0 min-h-0 overflow-hidden flex flex-col">
        {singleStep && (
          <p className="shrink-0 px-4 py-2 text-xs bg-amber-400/15 text-amber-200 border-b border-amber-400/30">
            Two-step sign-in is off.{' '}
            <button onClick={() => setWorkspace('features')} className="underline font-semibold">
              Turn it on in Features
            </button>{' '}
            (one scan with your phone).
          </p>
        )}
        <div className="flex-1 min-h-0">
        {workspace === 'jobs' ? (
          <JobsWorkspace password={token} onSettings={() => setWorkspace('settings')} />
        ) : workspace === 'accounts' ? (
          <div className="h-full overflow-y-auto">
            <AccountsPanel password={token} />
          </div>
        ) : workspace === 'moderation' ? (
          <div className="h-full overflow-y-auto">
            <ModerationPanel password={token} />
          </div>
        ) : workspace === 'feedback' ? (
          <div className="h-full overflow-y-auto">
            <FeedbackPanel password={token} />
          </div>
        ) : workspace === 'features' ? (
          <div className="h-full overflow-y-auto">
            <FeaturesPanel
              password={token}
              onToken={(t, twoStep) => {
                // Turning two-step sign-in on or off ends the old sign-in: keep the new one.
                setToken(t);
                setSingleStep(!twoStep);
                try {
                  sessionStorage.setItem(TOKEN_KEY, t);
                  sessionStorage.setItem(TOKEN_KEY + ':1step', twoStep ? '0' : '1');
                } catch {
                  /* only for this tab */
                }
              }}
            />
          </div>
        ) : workspace === 'audit' ? (
          <div className="h-full overflow-y-auto">
            <AuditPanel password={token} />
          </div>
        ) : workspace === 'learning' ? (
          <div className="h-full overflow-y-auto">
            <LearningPanel password={token} />
          </div>
        ) : workspace === 'banners' ? (
          <div className="h-full overflow-y-auto">
            <BannersPanel password={token} />
          </div>
        ) : workspace === 'growth' ? (
          <div className="h-full overflow-y-auto">
            <GrowthPanel password={token} />
          </div>
        ) : workspace === 'insights' ? (
          <div className="h-full overflow-y-auto">
            <InsightsPanel password={token} />
          </div>
        ) : (
          <div className="h-full overflow-y-auto">
            <SettingsPanel password={token} />
          </div>
        )}
        </div>
      </main>
    </div>
  );
}
