import { useEffect, useState } from 'react';
import { BarChart3, Eye, Heart, Languages, Loader2, MessageCircle, UserPlus } from 'lucide-react';
import { ApiError, analyticsApi, type Analytics, type Metric } from '../../shared/api';
import { LOCALE, plural, t } from '../../shared/i18n';

const METRICS: { id: Metric; label: string; icon: typeof Eye; one: string; many: string }[] = [
  { id: 'views', label: t("Views"), icon: Eye, one: '{n} view', many: '{n} views' },
  { id: 'likes', label: t("Likes"), icon: Heart, one: '{n} like', many: '{n} likes' },
  { id: 'comments', label: t("Comments"), icon: MessageCircle, one: '{n} comment', many: '{n} comments' },
  { id: 'followers', label: t("New followers"), icon: UserPlus, one: '{n} new follower', many: '{n} new followers' },
];

const compact = (n: number) => (n >= 10_000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : n.toLocaleString());
const dayLabel = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString(LOCALE, { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** One metric per day over the period: one series, bars on a shared baseline, a hover readout. */
function Bars({ series, metric }: { series: Analytics['series']; metric: (typeof METRICS)[number] }) {
  const [hover, setHover] = useState<number | null>(null);
  const values = series.map((d) => d[metric.id]);
  const max = Math.max(1, ...values);
  const shown = hover ?? series.length - 1;
  const n = values[shown];
  return (
    <figure className="space-y-2">
      <figcaption className="flex items-baseline justify-between gap-2 text-xs text-slate-400">
        <span>{metric.label}{' '}{t("per day")}</span>
        <span className="tabular-nums text-slate-200" aria-live="polite">
          {dayLabel(series[shown].day)}: {plural(n, metric.one, metric.many)}
        </span>
      </figcaption>
      <div className="flex items-end gap-px h-28 border-b border-slate-700" onMouseLeave={() => setHover(null)} aria-hidden>
        {series.map((d, i) => (
          <div key={d.day} className="flex-1 h-full flex items-end cursor-default" onMouseEnter={() => setHover(i)}>
            <div
              className={`w-full rounded-t-sm ${hover === i ? 'bg-amber-300' : 'bg-amber-400/80'}`}
              style={{ height: values[i] ? `${Math.max(4, (values[i] / max) * 100)}%` : '2px', opacity: values[i] ? 1 : 0.35 }}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[11px] text-slate-500" aria-hidden>
        <span>{dayLabel(series[0].day)}</span>
        <span>{dayLabel(series[series.length - 1].day)}</span>
      </div>
      <table className="sr-only">
        <caption>{metric.label}{' '}{t("per day")}</caption>
        <tbody>
          {series.map((d) => (
            <tr key={d.day}>
              <th scope="row">{dayLabel(d.day)}</th>
              <td>{d[metric.id]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/**
 * Creator analytics: views, likes, comments and new followers over 7, 30 or 90 days (a tile each,
 * the chosen one as a daily chart), each video's numbers, and the languages viewers' browsers use.
 */
export function AnalyticsCard() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Analytics | null>(null);
  const [metric, setMetric] = useState<Metric>('views');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(null);
    analyticsApi
      .get(days)
      .then((r) => current && setData(r))
      .catch((err) => current && setError(err instanceof ApiError ? err.message : t("Your numbers could not be loaded.")))
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [days]);

  const chosen = METRICS.find((m) => m.id === metric)!;
  return (
    <section className="p-5 rounded-2xl border border-slate-800 bg-slate-900 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold text-white flex items-center gap-1.5">
          <BarChart3 className="w-4 h-4 text-amber-400" />{' '}{t("Creator analytics")}
          {loading && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
        </h2>
        <div className="flex rounded-lg border border-slate-700 p-0.5 text-xs" role="group" aria-label={t("Period")}>
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              aria-pressed={days === d}
              className={`px-2.5 py-1 rounded-md ${days === d ? 'bg-slate-100 text-slate-950 font-semibold' : 'text-slate-300 hover:text-white'}`}
            >
              {d}{' '}{t("days")}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="text-sm text-rose-300">{error}</p>}

      {data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {METRICS.map((m) => (
              <button
                key={m.id}
                onClick={() => setMetric(m.id)}
                aria-pressed={metric === m.id}
                className={`text-start p-3 rounded-xl border ${metric === m.id ? 'border-amber-400/70 bg-amber-400/10' : 'border-slate-800 bg-slate-950/40 hover:border-slate-700'}`}
              >
                <span className="flex items-center gap-1.5 text-xs text-slate-400">
                  <m.icon className="w-3.5 h-3.5" /> {m.label}
                </span>
                <span className="block mt-1 text-2xl font-bold text-white tabular-nums">{compact(data.period[m.id])}</span>
                <span className="block text-[11px] text-slate-500 tabular-nums">
                  {m.id === 'followers' ? t('{n} in all', { n: compact(data.totals.followers) }) : t('{n} all time', { n: compact(data.totals[m.id]) })}
                </span>
              </button>
            ))}
          </div>

          <Bars series={data.series} metric={chosen} />

          {data.languages.length > 0 && (
            <div className="space-y-2">
              <h3 className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
                <Languages className="w-3.5 h-3.5 text-sky-300" />{' '}{t("Your viewers' languages ({n} days)", { n: data.days })}
              </h3>
              <ul className="space-y-1.5">
                {data.languages.map((l) => (
                  <li key={l.code} className="grid grid-cols-[6.5rem_1fr_3rem] items-center gap-2 text-xs">
                    <span className="truncate text-slate-300">{l.name}</span>
                    <span className="h-2 rounded-full bg-slate-800 overflow-hidden">
                      <span className="block h-full rounded-full bg-sky-400/80" style={{ width: `${Math.max(2, l.share * 100)}%` }} />
                    </span>
                    <span className="text-end tabular-nums text-slate-400">{Math.round(l.share * 100)}%</span>
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-slate-500">{t("From each viewer's browser language. Views before this chart existed are only in the totals.")}</p>
            </div>
          )}

          {data.videos.length > 0 ? (
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-500 text-start">
                    <th className="font-medium px-1 py-1.5">{t("Video")}</th>
                    <th className="font-medium px-1 py-1.5 text-end">{t('{n}d views', { n: data.days })}</th>
                    <th className="font-medium px-1 py-1.5 text-end hidden sm:table-cell">{t("All views")}</th>
                    <th className="font-medium px-1 py-1.5 text-end">{t("Likes")}</th>
                    <th className="font-medium px-1 py-1.5 text-end hidden sm:table-cell">{t("Comments")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {data.videos.slice(0, 10).map((v) => (
                    <tr key={v.id}>
                      <td className="px-1 py-1.5 max-w-0 w-full">
                        <a href={v.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 min-w-0 hover:text-white text-slate-200">
                          {v.thumb_url ? <img src={v.thumb_url} alt="" className="w-6 h-9 rounded object-cover shrink-0 bg-slate-950" /> : <span className="w-6 h-9 rounded bg-slate-800 shrink-0" />}
                          <span className="truncate">{v.title || t("Untitled video")}</span>
                          {v.visibility === 'public' && <span className="hidden sm:inline shrink-0 px-1 rounded bg-amber-400/15 text-amber-300 text-[10px]">{t("posted")}</span>}
                        </a>
                      </td>
                      <td className="px-1 py-1.5 text-end tabular-nums text-white">{compact(v.period_views)}</td>
                      <td className="px-1 py-1.5 text-end tabular-nums text-slate-300 hidden sm:table-cell">{compact(v.views)}</td>
                      <td className="px-1 py-1.5 text-end tabular-nums text-slate-300">{compact(v.likes)}</td>
                      <td className="px-1 py-1.5 text-end tabular-nums text-slate-300 hidden sm:table-cell">{compact(v.comments)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-slate-400">{t("Share or post a video to see its numbers here.")}</p>
          )}
        </>
      )}
    </section>
  );
}
