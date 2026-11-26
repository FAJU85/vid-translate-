import { useEffect, useState } from 'react';
import { ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { ApiError, REPORT_REASONS, adminApi, type BlockedAccount, type ModerationAction, type ReportGroup } from '../../shared/api';

const reasonLabel = (r: string) => REPORT_REASONS.find((x) => x.value === r)?.label ?? r;
const btn = 'px-2.5 py-1.5 rounded-lg border text-xs disabled:opacity-50';

/**
 * Reports workspace: what people reported (videos, comments, profiles), the most reported first,
 * with what to do about each: dismiss, hide or remove it, or block the account behind it. Blocked
 * accounts disappear from the feed and their profile, and cannot like, follow or comment.
 */
export function ModerationPanel({ password }: { password: string }) {
  const [reports, setReports] = useState<ReportGroup[]>([]);
  const [blocked, setBlocked] = useState<BlockedAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    adminApi
      .moderation(password)
      .then((r) => {
        setReports(r.reports);
        setBlocked(r.blocked);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load the reports.'))
      .finally(() => setLoading(false));
  };
  useEffect(load, [password]);

  async function act(g: ReportGroup, action: ModerationAction) {
    // Nothing of a person's is deleted: a video or photo is taken down (hidden, kept for its owner), who is told.
    const what =
      action === 'remove'
        ? g.kind === 'video'
          ? 'Take this video down? It is hidden from everyone but its owner, who is told.'
          : g.kind === 'profile'
            ? 'Take this profile photo down? It is hidden from everyone but its owner, who is told.'
            : 'Remove this comment? Its author is told.'
        : action === 'block'
          ? `Block @${g.preview.owner ?? 'this account'}?`
          : null;
    if (what && !window.confirm(what)) return;
    const reason = action === 'block' ? window.prompt('Why (kept with the block, for you)?', reasonLabel(g.reasons.split(',')[0])) : undefined;
    if (reason === null) return; // cancelled
    setBusy(`${g.kind}:${g.target}`);
    try {
      await adminApi.moderate(password, { action, kind: g.kind, target: g.target, reason });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not work.');
    } finally {
      setBusy(null);
    }
  }
  async function unblock(b: BlockedAccount) {
    setBusy(`unblock:${b.account_id}`);
    try {
      await adminApi.moderate(password, { action: 'unblock', account_id: b.account_id });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not work.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Reports</h1>
          <p className="text-sm text-slate-400">What people reported. Remove copyright takedowns here (the video, its picture and its page go).</p>
        </div>
        <button onClick={load} aria-label="Refresh" className="p-2 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        </button>
      </div>
      {error && <p className="p-3 text-sm rounded-xl border border-rose-800 bg-rose-950/60 text-rose-200">{error}</p>}

      {!loading && reports.length === 0 && !error && (
        <p className="p-8 text-center text-sm text-slate-400 rounded-2xl border border-slate-800 bg-slate-900">No open reports.</p>
      )}
      <ul className="space-y-3">
        {reports.map((g) => {
          const p = g.preview;
          const key = `${g.kind}:${g.target}`;
          return (
            <li key={key} className="p-4 rounded-2xl border border-slate-800 bg-slate-900 space-y-3">
              <div className="flex gap-3">
                {p.thumb && <img src={p.thumb} alt="" className="w-16 h-24 object-cover rounded-lg bg-slate-950 shrink-0" />}
                {p.photo && <img src={p.photo} alt="" className="w-16 h-16 object-cover rounded-full bg-slate-950 shrink-0" />}
                <div className="min-w-0 flex-1 text-sm space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2 py-0.5 rounded-md bg-slate-800 text-xs uppercase tracking-wide text-slate-300">{g.kind}</span>
                    <span className="px-2 py-0.5 rounded-md bg-rose-500/15 text-xs text-rose-300">
                      {g.reports} report{g.reports === 1 ? '' : 's'}
                    </span>
                    {p.owner && <span className="text-slate-300">@{p.owner}</span>}
                    {p.status === 'hidden' && <span className="text-xs text-slate-500">(hidden)</span>}
                    {p.photo_hidden && <span className="text-xs text-slate-500">(photo taken down)</span>}
                  </div>
                  {p.gone ? (
                    <p className="text-slate-500">Already deleted.</p>
                  ) : (
                    <p className="text-white break-words">{p.title ?? p.text ?? p.name ?? p.bio ?? (g.kind === 'video' ? 'Untitled video' : '')}</p>
                  )}
                  <p className="text-xs text-slate-400">{g.reasons.split(',').map(reasonLabel).join(' · ')}</p>
                  {g.details && <p className="text-xs text-slate-300 whitespace-pre-wrap break-words border-l-2 border-slate-700 pl-2">{g.details}</p>}
                  {p.url && (
                    <a href={p.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-amber-300 hover:underline">
                      <ExternalLink className="w-3 h-3" /> Open
                    </a>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button disabled={busy === key} onClick={() => act(g, 'dismiss')} className={`${btn} border-slate-700 text-slate-200 hover:bg-slate-800`}>
                  Dismiss
                </button>
                {g.kind === 'comment' && !p.gone && p.status !== 'hidden' && (
                  <button disabled={busy === key} onClick={() => act(g, 'hide')} className={`${btn} border-slate-700 text-slate-200 hover:bg-slate-800`}>
                    Hide comment
                  </button>
                )}
                {g.kind !== 'profile' && !p.gone && (
                  <button disabled={busy === key} onClick={() => act(g, 'remove')} className={`${btn} border-rose-800 text-rose-200 hover:bg-rose-950`}>
                    {g.kind === 'video' ? 'Take video down' : 'Remove comment'}
                  </button>
                )}
                {g.kind === 'profile' && p.photo && (
                  <button disabled={busy === key} onClick={() => act(g, 'remove')} className={`${btn} border-rose-800 text-rose-200 hover:bg-rose-950`}>
                    Take photo down
                  </button>
                )}
                {p.account_id && (
                  <button disabled={busy === key} onClick={() => act(g, 'block')} className={`${btn} border-rose-800 text-rose-200 hover:bg-rose-950`}>
                    Block account
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <section className="p-5 rounded-2xl border border-slate-800 bg-slate-900 space-y-3">
        <h2 className="font-semibold text-white">Blocked accounts</h2>
        {blocked.length === 0 ? (
          <p className="text-sm text-slate-400">None.</p>
        ) : (
          <ul className="divide-y divide-slate-800 text-sm">
            {blocked.map((b) => (
              <li key={b.account_id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                <span>
                  <span className="text-white">{b.handle ? `@${b.handle}` : b.account_id}</span>
                  {b.reason && <span className="text-slate-400"> · {b.reason}</span>}
                  <span className="text-slate-500"> · {new Date(b.created_at * 1000).toLocaleDateString()}</span>
                </span>
                <button disabled={busy === `unblock:${b.account_id}`} onClick={() => unblock(b)} className={`${btn} border-slate-700 text-slate-200 hover:bg-slate-800`}>
                  Unblock
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
