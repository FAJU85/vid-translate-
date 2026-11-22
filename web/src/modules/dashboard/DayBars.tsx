import { useState } from 'react';

/**
 * Videos per day, last 14 days: one series, so no legend (the title names it). Thin bars with
 * rounded tops on a shared baseline, a hover readout, and a table for screen readers.
 */
export function DayBars({ days }: { days: { day: string; videos: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...days.map((d) => d.videos));
  const label = (d: { day: string }) => new Date(`${d.day}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const shown = hover ?? days.length - 1;
  return (
    <figure className="space-y-2">
      <figcaption className="flex items-baseline justify-between gap-2 text-xs text-slate-400">
        <span>Videos per day, last 14 days</span>
        <span className="tabular-nums text-slate-200" aria-live="polite">
          {label(days[shown])}: {days[shown].videos} video{days[shown].videos === 1 ? '' : 's'}
        </span>
      </figcaption>
      <div className="flex items-end gap-0.5 h-24 border-b border-slate-700" onMouseLeave={() => setHover(null)} aria-hidden>
        {days.map((d, i) => (
          <div key={d.day} className="flex-1 h-full flex items-end cursor-default" onMouseEnter={() => setHover(i)}>
            <div
              className={`w-full rounded-t ${hover === i ? 'bg-amber-300' : 'bg-amber-400/80'}`}
              style={{ height: d.videos ? `${Math.max(6, (d.videos / max) * 100)}%` : '2px', opacity: d.videos ? 1 : 0.35 }}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[11px] text-slate-500" aria-hidden>
        <span>{label(days[0])}</span>
        <span>{label(days[days.length - 1])}</span>
      </div>
      <table className="sr-only">
        <caption>Videos per day</caption>
        <tbody>
          {days.map((d) => (
            <tr key={d.day}>
              <th scope="row">{label(d)}</th>
              <td>{d.videos}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
