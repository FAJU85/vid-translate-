import { useEffect, useState } from 'react';
import { Check, Loader2, RefreshCw, Send, Trash2 } from 'lucide-react';
import { ApiError, adminApi, type FeedbackItem } from '../../shared/api';

const when = (sec: number) => new Date(sec * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const btn = 'inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs disabled:opacity-50';

/**
 * Feedback workspace: what people sent with "Send feedback" on the website or /feedback in the
 * bot, newest first. Once handled it is deleted: the Privacy Policy keeps feedback only until it
 * is handled (and at most a year).
 */
export function FeedbackPanel({ password }: { password: string }) {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    adminApi
      .feedback(password, 'new')
      .then((r) => {
        setItems(r.items);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load the feedback.'))
      .finally(() => setLoading(false));
  };
  useEffect(load, [password]); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(item: FeedbackItem, action: 'done' | 'delete') {
    if (!window.confirm(action === 'done' ? 'Handled? It is deleted now, as the Privacy Policy promises.' : 'Delete this feedback for good?')) return;
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
          <p className="text-sm text-slate-400">From “Send feedback” on the website and /feedback in the Telegram bot. Handled feedback is deleted (Privacy Policy).</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} aria-label="Refresh" className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </button>
        </div>
      </div>
      {error && <p className="p-3 text-sm rounded-xl border border-rose-800 bg-rose-950/60 text-rose-200">{error}</p>}
      {!loading && !items.length && <p className="py-12 text-center text-sm text-slate-500">No feedback waiting.</p>}
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
              <button disabled={busy === f.id} onClick={() => act(f, 'done')} className={`${btn} border-emerald-700 text-emerald-300 hover:bg-emerald-950`}>
                <Check className="w-3.5 h-3.5" /> Handled
              </button>
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
