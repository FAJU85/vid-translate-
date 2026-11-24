import { useEffect, useState, type FormEvent } from 'react';
import { Loader2, Send, Trash2, X } from 'lucide-react';
import { ApiError, REPORT_REASONS, socialApi, type Comment, type ReportKind, type ReportReason } from '../../shared/api';

const panel = 'absolute inset-x-0 bottom-0 z-10 max-h-[70%] flex flex-col rounded-t-2xl bg-slate-950/95 backdrop-blur border-t border-slate-800 text-slate-100';

/**
 * A video's comments, over the bottom of its card: read them, write one (signed in with an
 * @handle), delete yours (or any on your own video), and report one.
 */
export function CommentsSheet({ videoId, signedIn, onSignIn, onClose, onCount, onReport }: {
  videoId: string;
  signedIn: boolean;
  onSignIn: () => void;
  onClose: () => void;
  onCount: (delta: number) => void;
  onReport: (id: number) => void;
}) {
  const [items, setItems] = useState<Comment[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const load = (before: string | null) => {
    setLoading(true);
    setError(null);
    socialApi
      .comments(videoId, before)
      .then((r) => {
        setItems((prev) => (before ? [...prev, ...r.items] : r.items));
        setNext(r.next);
      })
      .catch(() => setError('The comments could not be loaded.'))
      .finally(() => setLoading(false));
  };
  useEffect(() => load(null), [videoId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await socialApi.comment(videoId, text);
      setText('');
      onCount(1);
      load(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The comment could not be posted.');
    } finally {
      setBusy(false);
    }
  }
  async function remove(c: Comment) {
    if (!window.confirm('Delete this comment?')) return;
    try {
      await socialApi.deleteComment(c.id);
      setItems((list) => list.filter((x) => x.id !== c.id));
      onCount(-1);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The comment could not be deleted.');
    }
  }

  return (
    <div className={panel} role="dialog" aria-label="Comments" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
        <span className="font-semibold text-sm">Comments</span>
        <button onClick={onClose} aria-label="Close comments" className="p-1 text-slate-400 hover:text-white">
          <X className="w-5 h-5" />
        </button>
      </div>
      <ul className="flex-1 overflow-y-auto px-4 divide-y divide-slate-800/70">
        {items.map((c) => (
          <li key={c.id} className="py-2.5 text-sm">
            <div className="flex flex-wrap items-center gap-x-3 text-xs text-slate-400">
              <a href={`/@${c.author.handle}`} className="font-semibold text-slate-200 hover:underline">
                @{c.author.handle}
              </a>
              <span>{new Date(c.created_at * 1000).toLocaleDateString()}</span>
              <button onClick={() => onReport(c.id)} className="hover:text-white">
                Report
              </button>
              {c.can_delete && (
                <button onClick={() => remove(c)} aria-label="Delete comment" className="hover:text-rose-300">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <p className="mt-0.5 whitespace-pre-wrap break-words">{c.text}</p>
          </li>
        ))}
        {!loading && !error && items.length === 0 && <li className="py-8 text-center text-sm text-slate-400">No comments yet.</li>}
        {loading && (
          <li className="py-4 flex justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
          </li>
        )}
        {!loading && next && (
          <li className="py-2 text-center">
            <button onClick={() => load(next)} className="text-xs text-slate-300 hover:text-white">
              More comments
            </button>
          </li>
        )}
      </ul>
      {error && <p className="px-4 pb-1 text-xs text-rose-300">{error}</p>}
      {signedIn ? (
        <form onSubmit={send} className="flex gap-2 p-3 border-t border-slate-800">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={500}
            placeholder="Add a comment"
            className="flex-1 px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm focus:outline-none focus:border-amber-400/60"
          />
          <button disabled={busy || !text.trim()} aria-label="Post comment" className="px-3 rounded-lg bg-amber-400 text-slate-950 disabled:opacity-50">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </form>
      ) : (
        <button onClick={onSignIn} className="m-3 py-2 rounded-lg bg-amber-400 text-sm font-semibold text-slate-950">
          Sign in to comment
        </button>
      )}
    </div>
  );
}

/** Report a video, a comment or a profile: a reason and optional details, sent for the admin to review. */
export function ReportSheet({ kind, target, onClose }: { kind: ReportKind; target: string; onClose: () => void }) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'sent' | 'failed'>('idle');

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!reason) return;
    setState('busy');
    try {
      await socialApi.report({ kind, target, reason, details });
      setState('sent');
    } catch {
      setState('failed');
    }
  }

  return (
    <div className={panel} role="dialog" aria-label={`Report this ${kind}`} onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
        <span className="font-semibold text-sm">Report this {kind}</span>
        <button onClick={onClose} aria-label="Close" className="p-1 text-slate-400 hover:text-white">
          <X className="w-5 h-5" />
        </button>
      </div>
      {state === 'sent' ? (
        <div className="p-6 text-center text-sm space-y-3">
          <p>Thank you. The report was sent and will be reviewed.</p>
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-700">
            Close
          </button>
        </div>
      ) : (
        <form onSubmit={send} className="p-4 space-y-1.5 overflow-y-auto text-sm">
          {REPORT_REASONS.map((r) => (
            <label key={r.value} className="flex items-center gap-2 py-1">
              <input type="radio" name="reason" checked={reason === r.value} onChange={() => setReason(r.value)} /> {r.label}
            </label>
          ))}
          <textarea
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            rows={2}
            maxLength={1000}
            placeholder="Details (optional; for copyright: what you own and how to reach you)"
            className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 focus:outline-none focus:border-amber-400/60"
          />
          {state === 'failed' && <p className="text-xs text-rose-300">The report could not be sent. Try again later.</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-slate-400 hover:text-white">
              Cancel
            </button>
            <button disabled={!reason || state === 'busy'} className="px-4 py-2 rounded-lg bg-amber-400 font-semibold text-slate-950 disabled:opacity-50">
              {state === 'busy' ? 'Sending…' : 'Send report'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
