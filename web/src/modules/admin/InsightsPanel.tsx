import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { ApiError, adminApi, type SiteStats } from '../../shared/api';

function ago(sec: number | null): string {
  if (!sec) return '—';
  const d = Date.now() / 1000 - sec;
  if (d < 3600) return `${Math.max(1, Math.round(d / 60))} min ago`;
  if (d < 86400) return `${Math.round(d / 3600)} h ago`;
  return `${Math.round(d / 86400)} d ago`;
}

/** Status pill by success rate: the same colour tokens as the jobs board. */
function rateTone(rate: number): string {
  if (rate >= 0.9) return 'bg-status-done/15 text-status-done';
  if (rate >= 0.6) return 'bg-status-running/15 text-status-running';
  return 'bg-status-failed/15 text-status-failed';
}

/** R2's free storage; past it Cloudflare charges per GB a month. */
const FREE_BYTES = 10 * 1024 ** 3;
const gb = (b: number) => `${Number((b / 1024 ** 3).toFixed(b < 1024 ** 3 ? 2 : 1))} GB`;

/** Insights workspace: how link downloads are doing per site, so a site that breaks shows at once. */
export function InsightsPanel({ password }: { password: string }) {
  const [stats, setStats] = useState<SiteStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = () => {
    setLoading(true);
    adminApi
      .stats(password)
      .then((s) => {
        setStats(s);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load the numbers.'))
      .finally(() => setLoading(false));
  };
  useEffect(load, [password]);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Insights</h1>
          <p className="mt-1 text-sm text-slate-400">
            Video links by site over the last {stats?.days ?? 7} days. A site whose success rate drops has probably changed
            something; uploads and Telegram files are not counted.
          </p>
        </div>
        <button
          onClick={load}
          aria-label="Refresh"
          className="h-9 w-9 shrink-0 inline-flex items-center justify-center rounded-lg border border-slate-800 text-slate-400 hover:text-white"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        </button>
      </div>

      {error && <p className="p-3 text-sm rounded-xl border border-rose-800 bg-rose-950/60 text-rose-200">{error}</p>}

      {stats?.storage && (
        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <h2 className="font-semibold text-white">Stored videos</h2>
          <p className="mt-1 text-sm text-slate-400">
            {stats.storage.videos} {stats.storage.videos === 1 ? 'video' : 'videos'}, {gb(stats.storage.bytes)} of the {gb(FREE_BYTES)} free. Videos are never deleted by
            KAVOX, so this only grows; past 10 GB Cloudflare charges about $0.015 per GB a month.
          </p>
          <div className="mt-3 h-2 rounded-full bg-slate-800 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((stats.storage.bytes / FREE_BYTES) * 100)}>
            <div
              className={`h-full ${stats.storage.bytes > 0.8 * FREE_BYTES ? 'bg-status-failed' : 'bg-teal-400'}`}
              style={{ width: `${Math.min(100, (stats.storage.bytes / FREE_BYTES) * 100)}%` }}
            />
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-slate-800 bg-slate-900 overflow-hidden">
        <h2 className="px-5 pt-4 pb-3 font-semibold text-white">Link downloads by site</h2>
        {!stats ? (
          <div className="p-6 flex justify-center text-slate-500">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : stats.sites.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-slate-500">No video links in the last {stats.days} days.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wider text-slate-500 border-y border-slate-800">
                  <th className="px-5 py-2">Site</th>
                  <th className="px-3 py-2 text-right">Worked</th>
                  <th className="px-3 py-2 text-right">Failed</th>
                  <th className="px-3 py-2">Success</th>
                  <th className="px-3 py-2">Last success</th>
                  <th className="px-5 py-2">Last error</th>
                </tr>
              </thead>
              <tbody>
                {stats.sites.map((s) => {
                  const rate = s.done / Math.max(1, s.done + s.failed);
                  return (
                    <tr key={s.site} className="border-b border-slate-800/70 last:border-0 align-top">
                      <td className="px-5 py-2.5 font-medium text-slate-100">{s.site}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-300">{s.done}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-300">{s.failed}</td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold tabular-nums ${rateTone(rate)}`}>
                          {Math.round(rate * 100)}%
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-slate-400 whitespace-nowrap">{ago(s.last_done_at)}</td>
                      <td className="px-5 py-2.5 text-xs text-slate-400">
                        {s.last_error ? (
                          <span className="inline-flex gap-1.5">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-status-failed" />
                            <span className="break-words">
                              {s.last_error} <span className="text-slate-500">({ago(s.last_failed_at)})</span>
                            </span>
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
