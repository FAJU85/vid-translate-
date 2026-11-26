import { useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { ApiError, adminApi, type GrowthReport } from '../../shared/api';

// Plain names for the sources and journeys the site records.
const NAMES: Record<string, string> = {
  direct: 'Direct (typed, bookmark, or unknown)',
  app: 'The installed app',
  video: 'A shared video page ("Try it")',
  share: 'A shared video page link',
  wa: 'WhatsApp',
  tg: 'Telegram',
  x: 'X (Twitter)',
  copy: 'Copied link',
  native: 'Phone share menu (link)',
  file: 'Video file shared to an app',
  download: 'Video downloaded',
  google: 'Google',
  bing: 'Bing',
  search: 'Other search engines',
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  snapchat: 'Snapchat',
  youtube: 'YouTube',
  reddit: 'Reddit',
  linkedin: 'LinkedIn',
  producthunt: 'Product Hunt',
  'seo-translate': 'Search page: translate (English)',
  'seo-translate-ar': 'Search page: translate (Arabic)',
  'seo-lyrics': 'Search page: lyrics (English)',
  'seo-lyrics-ar': 'Search page: lyrics (Arabic)',
  browser: 'Installed from the browser',
};
const JOURNEYS: Record<string, string> = { lyrics: 'Lyrics videos', video: 'Subtitled videos', dub: 'Dubbed videos', files: 'Subtitle files' };
const label = (s: string, journeys = false) => (journeys ? JOURNEYS[s] : NAMES[s]) ?? s;

function Bars({ title, rows, empty, journeys = false }: { title: string; rows: [string, number][]; empty: string; journeys?: boolean }) {
  const top = Math.max(1, ...rows.map(([, n]) => n));
  return (
    <section className="p-5 rounded-2xl border border-slate-800 bg-slate-900 space-y-3">
      <h2 className="font-semibold text-white">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-400">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map(([name, n]) => (
            <li key={name} className="text-sm">
              <div className="flex justify-between gap-3 text-slate-200">
                <span className="truncate">{label(name, journeys)}</span>
                <span className="tabular-nums text-slate-400">{n.toLocaleString()}</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-slate-800">
                <div className="h-1.5 rounded-full bg-amber-400" style={{ width: `${(n / top) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const sum = (rows: { n: number }[]) => rows.reduce((a, r) => a + r.n, 0);
function byKey<T extends { n: number }>(rows: T[], key: (r: T) => string): [string, number][] {
  const m = new Map<string, number>();
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + r.n);
  return [...m].sort((a, b) => b[1] - a[1]);
}

/**
 * Growth workspace: where visitors come from, what they share and to which app, installs, and
 * the jobs that follow, per journey. Anonymous daily totals only (the Worker's growth brick).
 */
export function GrowthPanel({ password }: { password: string }) {
  const [days, setDays] = useState(30);
  const [r, setR] = useState<GrowthReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const load = () => {
    setLoading(true);
    adminApi
      .growth(password, days)
      .then((x) => (setR(x), setError(null)))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load the numbers.'))
      .finally(() => setLoading(false));
  };
  useEffect(load, [password, days]); // eslint-disable-line react-hooks/exhaustive-deps

  const visits = r?.counts.filter((c) => c.kind === 'visit') ?? [];
  const shares = r?.counts.filter((c) => c.kind === 'share') ?? [];
  const installs = r?.counts.filter((c) => c.kind === 'install') ?? [];
  const jobs = r?.jobs ?? [];
  // Day by day: visits and jobs, so a spike from one share or post shows at once.
  const dayList = Array.from({ length: days }, (_, i) => new Date(Date.now() - (days - 1 - i) * 86400_000).toISOString().slice(0, 10));
  const perDay = dayList.map((d) => ({ d, v: sum(visits.filter((x) => x.day === d)), j: sum(jobs.filter((x) => x.day === d)) }));
  const peak = Math.max(1, ...perDay.map((x) => Math.max(x.v, x.j)));

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-white">Growth</h1>
          <p className="text-sm text-slate-400">Where people come from and how they spread KAVOX. Daily totals only: nothing about any person is kept.</p>
        </div>
        <div className="flex items-center gap-2">
          {[7, 30, 90].map((n) => (
            <button key={n} onClick={() => setDays(n)} aria-pressed={days === n} className={`px-3 py-1.5 rounded-lg text-sm ${days === n ? 'bg-amber-400 text-slate-950 font-semibold' : 'border border-slate-700 text-slate-300 hover:bg-slate-800'}`}>
              {n} days
            </button>
          ))}
          <button onClick={load} aria-label="Refresh" className="p-2 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </button>
        </div>
      </div>
      {error && <p className="p-3 text-sm rounded-xl border border-rose-800 bg-rose-950/60 text-rose-200">{error}</p>}
      {r && (
        <>
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
            {(
              [
                ['Visits', sum(visits)],
                ['Shares', sum(shares)],
                ['App installs', sum(installs)],
                ['Videos started', sum(jobs)],
              ] as const
            ).map(([name, n]) => (
              <div key={name} className="p-4 rounded-2xl border border-slate-800 bg-slate-900">
                <div className="text-xs text-slate-400">{name}</div>
                <div className="text-2xl font-bold text-white tabular-nums">{n.toLocaleString()}</div>
              </div>
            ))}
          </div>
          <section className="p-5 rounded-2xl border border-slate-800 bg-slate-900 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-white">Day by day</h2>
              <div className="flex gap-3 text-xs text-slate-400">
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-slate-500" /> Visits</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-400" /> Videos started</span>
              </div>
            </div>
            <div className="flex items-end gap-[2px] h-32" role="img" aria-label="Visits and videos started per day">
              {perDay.map((x) => (
                <div key={x.d} className="flex-1 flex items-end gap-[1px] h-full" title={`${x.d}: ${x.v} visits, ${x.j} videos`}>
                  <div className="flex-1 rounded-t-sm bg-slate-500" style={{ height: `${(x.v / peak) * 100}%` }} />
                  <div className="flex-1 rounded-t-sm bg-amber-400" style={{ height: `${(x.j / peak) * 100}%` }} />
                </div>
              ))}
            </div>
          </section>
          <div className="grid gap-4 md:grid-cols-2">
            <Bars title="Where visits come from" rows={byKey(visits, (c) => c.source)} empty="No visits counted yet." />
            <Bars title="What people share, and where" rows={byKey(shares, (c) => c.source)} empty="No shares yet." />
            <Bars title="Videos started, by journey" rows={byKey(jobs, (j) => j.journey)} empty="No videos yet." journeys />
            <section className="p-5 rounded-2xl border border-slate-800 bg-slate-900 space-y-2 text-sm text-slate-300">
              <h2 className="font-semibold text-white">Reading this</h2>
              <p>A visit from <b>WhatsApp</b>, <b>Telegram</b> or <b>X</b> came through a link someone shared from KAVOX; <b>A shared video page</b> means a viewer pressed "Try it".</p>
              <p>To measure your own posts, add <code className="text-amber-300">?ref=</code> to the link you post, for example <code className="text-amber-300">?ref=instagram-bio</code>: it shows here under that name.</p>
              <p>iPhones add apps to the Home Screen without telling the site, so installs count Android and computers only.</p>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
