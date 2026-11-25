import { useEffect, useState } from 'react';
import { Check, Loader2, RefreshCw, RotateCcw, Send, Trash2 } from 'lucide-react';
import { ApiError, adminApi, type FeedbackItem } from '../../shared/api';

const when = (sec: number) => new Date(sec * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const btn = 'inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs disabled:opacity-50';

/**
 * Feedback workspace: what people sent with "Send feedback" on the website or /feedback in the
 * bot, newest first. Mark each one done when handled (it moves to Done), or delete it.
 */
export function FeedbackPanel({ password }: { password: string }) {
  const [status, setStatus] = useState<'new' | 'done'>('new');
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [counts, setCounts] = useState({ new: 0, done: 0 });
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    adminApi
      .feedback(password, status)
      .then((r) => {
        setItems(r.items);
        setCounts(r.counts);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load the feedback.'))
      .finally(() => setLoading(false));
  };
  useEffect(load, [password, status]); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(item: FeedbackItem, action: 'done' | 'new' | 'delete') {
    if (action === 'delete' && !window.confirm('Delete this feedback for good?')) return;
    setBusy(item.id);
    try {
      await adminApi.judgeFeedback(password, item.id, action);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not work.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-white">Feedback</h1>
          <p className="text-sm text-slate-400">From “Send feedback” on the website and /feedback in the Telegram bot.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-slate-700 p-0.5 text-xs" role="group" aria-label="Show">
            {(['new', 'done'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatus(s)}
                aria-pressed={status === s}
                className={`px-2.5 py-1 rounded-md ${status === s ? 'bg-slate-100 text-slate-950 font-semibold' : 'text-slate-300 hover:text-white'}`}
              >
                {s === 'new' ? 'New' : 'Done'} ({counts[s]})
              </button>
            ))}
          </div>
          <button onClick={load} aria-label="Refresh" className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </button>
        </div>
      </div>
      {error && <p className="p-3 text-sm rounded-xl border border-rose-800 bg-rose-950/60 text-rose-200">{error}</p>}
      {!loading && !items.length && <p className="py-12 text-center text-sm text-slate-500">{status === 'new' ? 'No new feedback.' : 'Nothing marked done yet.'}</p>}
      <ul className="space-y-2">
        {items.map((f) => (
          <li key={f.id} className="p-4 rounded-xl border border-slate-800 bg-slate-900 space-y-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${f.source === 'telegram' ? 'bg-sky-400/15 text-sky-300' : 'bg-amber-400/15 text-amber-300'}`}>
                {f.source === 'telegram' && <Send className="w-3 h-3" />}
                {f.source === 'telegram' ? 'Telegram' : 'Website'}
              </span>
              <span>{when(f.created_at)}</span>
              {f.lang && <span>{f.lang === 'ar' ? 'Arabic' : 'English'}</span>}
              {f.page && <span className="font-mono truncate max-w-[14rem]">{f.page}</span>}
              <span>{f.account_id ? 'signed in' : 'guest'}</span>
            </div>
            <p dir="auto" className="text-sm text-slate-100 whitespace-pre-wrap break-words">
              {f.text}
            </p>
            <div className="flex gap-2">
              {f.status === 'new' ? (
                <button disabled={busy === f.id} onClick={() => act(f, 'done')} className={`${btn} border-emerald-700 text-emerald-300 hover:bg-emerald-950`}>
                  <Check className="w-3.5 h-3.5" /> Done
                </button>
              ) : (
                <button disabled={busy === f.id} onClick={() => act(f, 'new')} className={`${btn} border-slate-700 text-slate-300 hover:bg-slate-800`}>
                  <RotateCcw className="w-3.5 h-3.5" /> Back to new
                </button>
              )}
              <button disabled={busy === f.id} onClick={() => act(f, 'delete')} className={`${btn} border-rose-800 text-rose-300 hover:bg-rose-950`}>
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
