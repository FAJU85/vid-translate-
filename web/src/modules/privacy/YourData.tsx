import { useState, type FormEvent } from 'react';
import { AlertTriangle, Download, Loader2, ShieldCheck, Trash2 } from 'lucide-react';
import { ApiError, privacyApi, type Me } from '../../shared/api';
import { t } from '../../shared/i18n';

/**
 * "Your data" (PDPL rights): correct your name, download a copy of everything KAVOX keeps about
 * you, or delete it all for good. Signed out, it covers what this browser made.
 */
export function YourData({ me, onRenamed }: { me: Me | null; onRenamed?: () => void }) {
  const account = me?.account ?? null;
  const [name, setName] = useState(account?.name ?? '');
  const [busy, setBusy] = useState<'name' | 'export' | 'delete' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [understood, setUnderstood] = useState(false);

  async function rename(e: FormEvent) {
    e.preventDefault();
    setBusy('name');
    setError(null);
    try {
      await privacyApi.rename(name);
      setNote(t('Saved.'));
      onRenamed?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('That did not work.'));
    } finally {
      setBusy(null);
    }
  }
  async function download() {
    setBusy('export');
    setError(null);
    try {
      const blob = await privacyApi.export();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'kavox-my-data.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('That did not work.'));
    } finally {
      setBusy(null);
    }
  }
  async function erase() {
    setBusy('delete');
    setError(null);
    try {
      await privacyApi.erase();
      try {
        // A fresh, unrelated identity for this browser from now on.
        localStorage.removeItem('tarjim_client_id');
      } catch {
        /* nothing kept */
      }
      window.location.assign('/?deleted=1');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('That did not work.'));
      setBusy(null);
    }
  }

  return (
    <section className="p-5 rounded-2xl border border-slate-800 bg-slate-900 space-y-4" aria-labelledby="your-data">
      <div>
        <h2 id="your-data" className="flex items-center gap-1.5 font-semibold text-white">
          <ShieldCheck className="w-4 h-4 text-amber-400" /> {t('Your data')}
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          {account ? t('See, correct, download or delete what KAVOX keeps about you.') : t('Without an account, this covers the videos made in this browser.')}{' '}
          <a href="/privacy" target="_blank" rel="noreferrer" className="text-amber-300 underline underline-offset-2">
            {t('Privacy Policy')}
          </a>
        </p>
      </div>

      {account && (
        <form onSubmit={rename} className="flex flex-wrap items-end gap-2">
          <label className="flex-1 min-w-[12rem] space-y-1">
            <span className="block text-xs text-slate-400">{t('Your name')}</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              dir="auto"
              className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-sm text-white focus:outline-none focus:border-amber-400/60"
            />
          </label>
          <button disabled={busy !== null || name === (account.name ?? '')} className="px-3 py-2 rounded-lg border border-slate-700 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50">
            {busy === 'name' ? <Loader2 className="w-4 h-4 animate-spin" /> : t('Save')}
          </button>
        </form>
      )}
      {account?.email && <p className="text-xs text-slate-500">{t('Your email comes from how you sign in. To use another one, sign in with it.')}</p>}

      <button type="button" onClick={download} disabled={busy !== null} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-700 text-sm text-slate-100 hover:bg-slate-800 disabled:opacity-50">
        {busy === 'export' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} {t('Download my data')}
      </button>

      <div className="pt-3 border-t border-slate-800 space-y-3">
        {!confirming ? (
          <button type="button" onClick={() => setConfirming(true)} className="inline-flex items-center gap-2 text-sm text-rose-300 hover:text-rose-200">
            <Trash2 className="w-4 h-4" /> {account ? t('Delete my account') : t('Delete my data in this browser')}
          </button>
        ) : (
          <div className="p-4 rounded-xl border border-rose-800 bg-rose-950/40 space-y-3">
            <p className="flex items-start gap-2 text-sm text-rose-100">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              {account
                ? t('This permanently deletes your account, profile, videos and their files, comments, likes, follows, credits and feedback. Credits you bought are lost. It cannot be undone.')
                : t('This permanently deletes the videos and their files made in this browser, and its credits. It cannot be undone.')}
            </p>
            <label className="flex items-center gap-2 text-sm text-rose-100">
              <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} className="w-4 h-4 accent-rose-500" />
              {t('I understand this cannot be undone')}
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={erase}
                disabled={!understood || busy !== null}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busy === 'delete' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} {t('Delete everything')}
              </button>
              <button type="button" onClick={() => (setConfirming(false), setUnderstood(false))} className="px-4 py-2 rounded-lg text-sm text-slate-300 hover:text-white">
                {t('Cancel')}
              </button>
            </div>
          </div>
        )}
      </div>
      {note && <p className="text-sm text-emerald-300">{note}</p>}
      {error && <p className="text-sm text-rose-300">{error}</p>}
    </section>
  );
}
