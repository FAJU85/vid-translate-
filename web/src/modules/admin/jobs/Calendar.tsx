import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { AdminJob } from '../../../shared/api';
import type { CardProps } from './Board';
import { STATUS_STYLE, jobTitle } from './model';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** Jobs by the day they were submitted. Jobs are kept for 30 days, so a month covers them all. */
export function Calendar({ jobs, props }: { jobs: AdminJob[]; props: CardProps }) {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const byDay = useMemo(() => {
    const map = new Map<string, AdminJob[]>();
    for (const job of jobs) {
      const key = dayKey(new Date(job.created_at * 1000));
      map.set(key, [...(map.get(key) ?? []), job]);
    }
    return map;
  }, [jobs]);

  const days = useMemo(() => {
    const first = new Date(month);
    first.setDate(1 - ((first.getDay() + 6) % 7)); // back to Monday
    return Array.from({ length: 42 }, (_, i) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + i));
  }, [month]);

  const today = dayKey(new Date());
  const shift = (n: number) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1));

  return (
    <div className="h-full flex flex-col rounded-xl border border-slate-800 bg-slate-950/70 overflow-hidden">
      <div className="flex items-center gap-2 px-3 h-11 shrink-0 border-b border-slate-800">
        <button onClick={() => shift(-1)} aria-label="Previous month" className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-300">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <h3 className="text-sm font-semibold text-white w-36 text-center">
          {month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </h3>
        <button onClick={() => shift(1)} aria-label="Next month" className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-300">
          <ChevronRight className="w-4 h-4" />
        </button>
        <button
          onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}
          className="ml-2 px-2.5 py-1 rounded-lg border border-slate-700 text-xs text-slate-300 hover:bg-slate-800"
        >
          Today
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto flex flex-col">
        <div className="grid grid-cols-7 min-w-[44rem] shrink-0">
          {WEEKDAYS.map((d) => (
            <div key={d} className="h-7 px-2 flex items-center text-[11px] font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-800">
              {d}
            </div>
          ))}
        </div>
        <div className="flex-1 grid grid-cols-7 min-w-[44rem] auto-rows-[minmax(6.5rem,1fr)]">
          {days.map((d) => {
            const key = dayKey(d);
            const list = byDay.get(key) ?? [];
            const inMonth = d.getMonth() === month.getMonth();
            return (
              <div key={key} className={`min-w-0 p-1.5 border-b border-r border-slate-900 flex flex-col ${inMonth ? '' : 'bg-slate-950/80 opacity-50'}`}>
                <div className="flex items-center justify-between px-0.5 mb-1">
                  <span
                    className={`text-xs tabular-nums ${key === today ? 'w-5 h-5 rounded-full bg-amber-400 text-slate-950 font-bold flex items-center justify-center' : 'text-slate-400'}`}
                  >
                    {d.getDate()}
                  </span>
                  {list.length > 0 && <span className="text-[10px] text-slate-500 tabular-nums">{list.length}</span>}
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto space-y-1 max-h-28">
                  {list.map((job) => {
                    const tone = STATUS_STYLE[job.status];
                    return (
                      <button
                        key={job.id}
                        data-job={job.id}
                        onClick={() => props.onOpen(job.id)}
                        onFocus={() => props.onFocus(job.id)}
                        title={`${jobTitle(job)} · ${tone.label}`}
                        className={`w-full flex items-center gap-1.5 px-1.5 py-0.5 rounded text-left text-[11px] truncate border ${tone.border} ${tone.soft} text-slate-200 hover:brightness-125 ${
                          props.focusedId === job.id ? 'ring-2 ring-amber-400/80' : ''
                        } ${props.selected.has(job.id) ? 'outline outline-1 outline-amber-400' : ''}`}
                      >
                        <span className={`w-1.5 h-1.5 shrink-0 rounded-full ${tone.dot}`} />
                        <span className="truncate">{jobTitle(job)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
