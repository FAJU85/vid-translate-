import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { ApiError, adminApi, type RatingSummary, type SiteMethod } from '../../shared/api';

const VOICE: Record<string, string> = { female: 'Female', male: 'Male', classic: 'Classic (eSpeak NG)' };
const METHOD: Record<string, string> = {
  plain: 'Plain',
  chrome: 'Looks like Chrome',
  ipv4: 'IPv4 only',
  'chrome-ipv4': 'Chrome, IPv4 only',
};

const share = (up: number, down: number) => (up + down ? Math.round((up / (up + down)) * 100) : 0);

/**
 * What people think of the results (👍 / 👎 per language pair and per voice, worst first) and what
 * KAVOX learned about downloading from each site. Read-only: ratings point at where corrections
 * are needed; the download methods are chosen from these counts automatically.
 */
export function QualityPanel({ password }: { password: string }) {
  const [ratings, setRatings] = useState<RatingSummary[] | null>(null);
  const [sites, setSites] = useState<SiteMethod[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setBusy(true);
    Promise.all([adminApi.ratings(password), adminApi.sites(password)])
      .then(([r, s]) => {
        setRatings(r.ratings);
        setSites(s.sites);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load the ratings.'))
      .finally(() => setBusy(false));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, []);

  const cell = 'px-3 py-2';
  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-white">Quality and sites</h2>
          <p className="text-sm text-slate-400 max-w-2xl">
            👍 / 👎 people gave their videos, worst first: where many say a translation or a voice needs work, check the
            rules above and the corrections people make. Below, how downloads from each site went with each method; KAVOX
            tries the method that works best for a site first.
          </p>
        </div>
        <button onClick={load} disabled={busy} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 text-sm text-slate-300 hover:bg-slate-800">
          <RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </header>
      {error && <p className="text-sm text-rose-300">{error}</p>}

      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-900 text-left text-slate-400">
            <tr>
              <th className={`${cell} font-medium`}>Rated</th>
              <th className={`${cell} font-medium text-right`}>👍</th>
              <th className={`${cell} font-medium text-right`}>👎</th>
              <th className={`${cell} font-medium text-right`}>Liked</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {ratings?.length === 0 && (
              <tr>
                <td colSpan={4} className={`${cell} text-slate-500`}>No ratings yet.</td>
              </tr>
            )}
            {ratings?.map((r) => (
              <tr key={`${r.aspect}:${r.src}:${r.tgt}:${r.voice}`}>
                <td className={`${cell} text-slate-200`}>
                  {r.aspect === 'voice' ? `Voice · ${r.tgt} · ${VOICE[r.voice ?? ''] ?? r.voice}` : `Translation · ${r.src} → ${r.tgt}`}
                </td>
                <td className={`${cell} text-right text-slate-300`}>{r.up}</td>
                <td className={`${cell} text-right text-slate-300`}>{r.down}</td>
                <td className={`${cell} text-right font-semibold ${share(r.up, r.down) < 60 ? 'text-rose-300' : 'text-status-done'}`}>
                  {share(r.up, r.down)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-900 text-left text-slate-400">
            <tr>
              <th className={`${cell} font-medium`}>Site</th>
              <th className={`${cell} font-medium`}>Method</th>
              <th className={`${cell} font-medium text-right`}>Worked</th>
              <th className={`${cell} font-medium text-right`}>Failed</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {sites?.length === 0 && (
              <tr>
                <td colSpan={4} className={`${cell} text-slate-500`}>No downloads counted yet.</td>
              </tr>
            )}
            {sites?.map((m) => (
              <tr key={`${m.host}:${m.strategy}`}>
                <td className={`${cell} text-slate-200`}>{m.host}</td>
                <td className={`${cell} text-slate-300`}>{METHOD[m.strategy] ?? m.strategy}</td>
                <td className={`${cell} text-right text-slate-300`}>{Math.round(m.ok * 10) / 10}</td>
                <td className={`${cell} text-right text-slate-300`}>{Math.round(m.fail * 10) / 10}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
