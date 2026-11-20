import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Check } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { AdminJob } from '../../../shared/api';
import type { CardProps } from './Board';
import { Avatar } from './JobCard';
import { STATUS_STYLE, formatDuration, fullTime, jobTitle, relativeTime } from './model';

type SortKey = 'title' | 'status' | 'channel' | 'tgt_lang' | 'mode' | 'created_at' | 'duration';

const COLUMNS: { key: SortKey; label: string; className: string }[] = [
  { key: 'title', label: 'Title', className: 'flex-1 min-w-[12rem]' },
  { key: 'status', label: 'Status', className: 'w-32' },
  { key: 'channel', label: 'From', className: 'w-28 hidden md:block' },
  { key: 'tgt_lang', label: 'Language', className: 'w-24' },
  { key: 'mode', label: 'Output', className: 'w-28 hidden lg:block' },
  { key: 'duration', label: 'Length', className: 'w-20 hidden lg:block text-right' },
  { key: 'created_at', label: 'Created', className: 'w-24 text-right' },
];

const ROW = 44;

function value(job: AdminJob, key: SortKey): string | number {
  if (key === 'title') return jobTitle(job).toLowerCase();
  if (key === 'duration') return job.duration ?? -1;
  return job[key] as string | number;
}

/** Sortable list of every job; only the visible rows are rendered. */
export function Table({ jobs, props, onOrder }: { jobs: AdminJob[]; props: CardProps; onOrder: (ids: string[]) => void }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'created_at', dir: -1 });
  const rows = useMemo(
    () => [...jobs].sort((a, b) => (value(a, sort.key) > value(b, sort.key) ? 1 : value(a, sort.key) < value(b, sort.key) ? -1 : 0) * sort.dir),
    [jobs, sort],
  );
  useEffect(() => onOrder(rows.map((j) => j.id)), [rows, onOrder]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({ count: rows.length, getScrollElement: () => scrollRef.current, estimateSize: () => ROW, overscan: 10 });
  useEffect(() => {
    const index = props.focusedId ? rows.findIndex((j) => j.id === props.focusedId) : -1;
    if (index >= 0) virtual.scrollToIndex(index, { align: 'auto' });
  }, [props.focusedId, rows, virtual]);

  const allSelected = rows.length > 0 && rows.every((j) => props.selected.has(j.id));

  return (
    <div role="grid" aria-rowcount={rows.length} className="h-full flex flex-col rounded-xl border border-slate-800 bg-slate-950/70 overflow-hidden">
      <div role="row" className="flex items-center gap-3 px-3 h-10 shrink-0 border-b border-slate-800 text-xs font-semibold text-slate-400">
        <button
          role="checkbox"
          aria-checked={allSelected}
          aria-label="Select every row"
          onClick={() => rows.forEach((j) => (allSelected || !props.selected.has(j.id)) && props.onToggle(j.id))}
          className={`w-4 h-4 shrink-0 rounded border flex items-center justify-center ${allSelected ? 'bg-amber-400 border-amber-400 text-slate-950' : 'border-slate-600'}`}
        >
          {allSelected && <Check className="w-3 h-3" strokeWidth={3} />}
        </button>
        {COLUMNS.map((c) => (
          <button
            key={c.key}
            role="columnheader"
            aria-sort={sort.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
            onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? (-s.dir as 1 | -1) : c.key === 'created_at' ? -1 : 1 }))}
            className={`${c.className.replace(/\b(md|lg):block\b/, '$1:flex')} flex items-center gap-1 text-left hover:text-white ${c.className.includes('text-right') ? 'justify-end' : ''}`}
          >
            {c.label}
            {sort.key === c.key && (sort.dir === 1 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
          </button>
        ))}
      </div>
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto">
        {rows.length === 0 && <p className="p-8 text-center text-sm text-slate-500">No jobs match these filters.</p>}
        <div className="relative" style={{ height: virtual.getTotalSize() }}>
          {virtual.getVirtualItems().map((item) => {
            const job = rows[item.index];
            const tone = STATUS_STYLE[job.status];
            const selected = props.selected.has(job.id);
            return (
              <div
                key={job.id}
                role="row"
                aria-selected={selected}
                tabIndex={0}
                data-job={job.id}
                onClick={() => props.onOpen(job.id)}
                onFocus={() => props.onFocus(job.id)}
                className={`absolute left-0 right-0 flex items-center gap-3 px-3 border-b border-slate-900 text-sm cursor-pointer outline-none ${
                  selected ? 'bg-amber-400/5' : 'hover:bg-slate-900/80'
                } ${props.focusedId === job.id ? 'ring-2 ring-inset ring-amber-400/80' : ''} ${props.pending.has(job.id) ? 'opacity-60 animate-pulse' : ''}`}
                style={{ height: ROW, transform: `translateY(${item.start}px)` }}
              >
                <button
                  role="checkbox"
                  aria-checked={selected}
                  aria-label={`Select ${jobTitle(job)}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onToggle(job.id);
                  }}
                  className={`w-4 h-4 shrink-0 rounded border flex items-center justify-center ${selected ? 'bg-amber-400 border-amber-400 text-slate-950' : 'border-slate-600'}`}
                >
                  {selected && <Check className="w-3 h-3" strokeWidth={3} />}
                </button>
                <span className="flex-1 min-w-[12rem] flex items-center gap-2 truncate">
                  <Avatar job={job} />
                  <span className="truncate text-slate-100">{jobTitle(job)}</span>
                </span>
                <span className="w-32">
                  <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs ${tone.soft} ${tone.text}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} />
                    {tone.label}
                    {job.status === 'running' && <span className="tabular-nums">{job.progress}%</span>}
                  </span>
                </span>
                <span className="w-28 hidden md:block text-slate-400">{job.channel === 'telegram' ? 'Telegram' : 'Website'}</span>
                <span className="w-24 uppercase text-xs font-semibold text-slate-300">
                  {job.detected_lang ?? job.src_lang} → {job.tgt_lang}
                </span>
                <span className="w-28 hidden lg:block text-slate-400">{job.mode === 'hard' ? 'Burned in' : job.mode === 'dub' ? 'Dubbed' : 'Subtitle file'}</span>
                <span className="w-20 hidden lg:block text-right tabular-nums text-slate-400">{formatDuration(job.duration)}</span>
                <span className="w-24 text-right tabular-nums text-slate-400" title={fullTime(job.created_at)}>
                  {relativeTime(job.created_at)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
