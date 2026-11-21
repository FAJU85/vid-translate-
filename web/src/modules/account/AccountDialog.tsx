import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Bot, CheckCircle2, Loader2, LogOut, Mail, X } from 'lucide-react';
import { ApiError, accountApi, type LedgerEntry, type Me } from '../../shared/api';
import { BUCKET_LABEL, creditsText, timeText } from './format';

const POLL_MS = 2000;
const POLL_FOR_MS = 5 * 60 * 1000;

/** Google's "G", drawn inline (no external image). */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="w-4 h-4" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.6 13.3l7.9 6.1C12.4 13.7 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.3 5.7c4.3-3.9 7-9.7 7-17.1z" />
      <path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C.9 16.6 0 20.2 0 24s.9 7.4 2.6 10.7l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.3-5.7c-2 1.4-4.7 2.3-8.6 2.3-6.3 0-11.6-4.2-13.5-10l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
    </svg>
  );
}

/** Sign in (or link another way of signing in), see the balance and its history, sign out. */
export function AccountDialog({ me, onChange, onClose, notice }: {
  me: Me;
  onChange: (me: Me) => void;
  onClose: () => void;
  notice?: string | null;
}) {
  const [waitingTelegram, setWaitingTelegram] = useState(false);
  const [email, setEmail] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<LedgerEntry[] | null>(null);
  const stopPolling = useRef<() => void>(() => {});
  const account = me.account;

  useEffect(() => () => stopPolling.current(), []);
  useEffect(() => {
    if (me.credits_enabled) accountApi.history().then(setHistory, () => setHistory([]));
  }, [me.credits_enabled, account?.id]);

  async function telegram() {
    setError(null);
    // Opened before awaiting, so the browser treats it as the click's own window (no popup block).
    const tab = window.open('about:blank', '_blank');
    try {
      const { code, url } = await accountApi.telegramStart();
      if (tab) tab.location.href = url;
      else window.location.href = url;
      setWaitingTelegram(true);
      const started = Date.now();
      let stopped = false;
      stopPolling.current = () => (stopped = true);
      while (!stopped && Date.now() - started < POLL_FOR_MS) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        const res = await accountApi.telegramCheck(code).catch(() => null);
        if (res?.status === 'signed_in') {
          const { status: _s, ...next } = res;
          onChange(next);
          break;
        }
      }
    } catch (err) {
      tab?.close();
      setError(err instanceof ApiError ? err.message : 'Could not start Telegram sign-in.');
    } finally {
      setWaitingTelegram(false);
    }
  }

  async function sendEmail(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await accountApi.email(email);
      setEmailSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the email.');
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await accountApi.logout().catch(() => {});
    onChange(await accountApi.me());
  }

  const methods = (
    <div className="space-y-2">
      {me.sign_in.telegram && !account?.linked.telegram && (
        <button
          onClick={telegram}
          disabled={waitingTelegram}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#2AABEE] hover:bg-[#229ED9] text-white font-semibold disabled:opacity-70"
        >
          {waitingTelegram ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bot className="w-4 h-4" />}
          {waitingTelegram ? 'Press Start in Telegram…' : account ? 'Link Telegram' : 'Continue with Telegram'}
        </button>
      )}
      {waitingTelegram && (
        <p className="text-xs text-slate-400 text-center">
          Telegram opened in a new tab. Press <b>Start</b> there, then come back: this page signs you in by itself.
        </p>
      )}
      {me.sign_in.google && !account?.linked.google && (
        <a
          href={accountApi.googleUrl()}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-white hover:bg-slate-100 text-slate-900 font-semibold"
        >
          <GoogleMark /> {account ? 'Link Google' : 'Continue with Google'}
        </a>
      )}
      {me.sign_in.email && !account?.linked.email && (
        emailSent ? (
          <p className="flex items-start gap-2 p-3 rounded-lg border border-emerald-800 bg-emerald-950/50 text-sm text-emerald-200">
            <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> Check your inbox: we sent a sign-in link to {email}. It works for 15 minutes.
          </p>
        ) : (
          <form onSubmit={sendEmail} className="flex gap-2">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="flex-1 min-w-0 px-3 py-2 text-sm rounded-lg bg-slate-950 border border-slate-700 text-white focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
            <button disabled={busy} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-600 text-sm text-slate-100 hover:bg-slate-800 disabled:opacity-60">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />} {account ? 'Link' : 'Email me a link'}
            </button>
          </form>
        )
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4 bg-black/60" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={account ? 'Your account' : 'Sign in'}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-5 space-y-4 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-white">{account ? account.name || account.email || 'Your account' : 'Sign in'}</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {account
                ? [account.linked.telegram && 'Telegram', account.linked.google && 'Google', account.linked.email && account.email].filter(Boolean).join(' · ')
                : 'One account for the website and the Telegram bot.'}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800">
            <X className="w-4 h-4" />
          </button>
        </div>

        {notice && <p className="p-3 rounded-lg border border-slate-700 bg-slate-950 text-sm text-slate-200">{notice}</p>}
        {error && <p className="p-3 rounded-lg border border-rose-800 bg-rose-950/60 text-sm text-rose-200">{error}</p>}

        {me.credits_enabled && me.balance && (
          <section className="p-4 rounded-xl border border-slate-800 bg-slate-950">
            <div className="text-2xl font-bold text-white tabular-nums">{creditsText(me.balance.total_seconds)} credits</div>
            <div className="text-xs text-slate-400">{timeText(me.balance.total_seconds)} of translation · 1 credit = 1 minute (dubbing: 2)</div>
            {me.balance.buckets.some((b) => b.seconds > 0) && (
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                {me.balance.buckets
                  .filter((b) => b.seconds > 0)
                  .map((b) => (
                    <div key={b.bucket} className="contents">
                      <dt className="text-slate-400">{BUCKET_LABEL[b.bucket]}</dt>
                      <dd className="text-right text-slate-200 tabular-nums">
                        {creditsText(b.seconds)}
                        {b.expires_at && <span className="text-slate-500"> · until {new Date(b.expires_at * 1000).toLocaleDateString()}</span>}
                      </dd>
                    </div>
                  ))}
              </dl>
            )}
          </section>
        )}

        {account ? (
          <>
            {(me.sign_in.telegram && !account.linked.telegram) || (me.sign_in.google && !account.linked.google) || (me.sign_in.email && !account.linked.email) ? (
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Add another way to sign in</h3>
                {methods}
              </section>
            ) : null}
          </>
        ) : (
          <section className="space-y-3">
            {me.sign_in.telegram || me.sign_in.google || me.sign_in.email ? methods : <p className="text-sm text-slate-400">Signing in is not available yet.</p>}
            <p className="text-xs text-slate-500">
              Without an account, your translations and credits stay in this browser only.
            </p>
          </section>
        )}

        {me.credits_enabled && history && history.length > 0 && (
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Usage</h3>
            <ul className="divide-y divide-slate-800 text-sm">
              {history.slice(0, 30).map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="min-w-0 truncate text-slate-300">
                    {h.kind === 'reserve' ? 'Translation' : h.kind === 'refund' ? 'Refunded' : h.kind === 'grant' ? 'Credits added' : 'Credits removed'}
                    {h.detail && <span className="text-slate-500"> · {h.detail}</span>}
                  </span>
                  <span className={`shrink-0 tabular-nums ${h.seconds >= 0 ? 'text-emerald-400' : 'text-slate-300'}`}>
                    {h.seconds >= 0 ? '+' : '−'}
                    {creditsText(Math.abs(h.seconds))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {account && (
          <button onClick={signOut} className="flex items-center gap-2 text-sm text-slate-400 hover:text-white">
            <LogOut className="w-4 h-4" /> Sign out
          </button>
        )}
      </div>
    </div>
  );
}
