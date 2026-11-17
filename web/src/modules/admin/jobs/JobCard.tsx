import { forwardRef, type HTMLAttributes } from 'react';
import { Check, Clock } from 'lucide-react';
import type { AdminJob } from '../../../shared/api';
import { STATUS_STYLE, fullTime, jobTitle, ownerBadge, relativeTime } from './model';

export function Avatar({ job, size = 'sm' }: { job: AdminJob; size?: 'sm' | 'md' }) {
  const { initials, hue, label } = ownerBadge(job);
  return (
    <span
      title={label}
      aria-label={label}
      className={`inline-flex items-center justify-center shrink-0 rounded-full font-semibold text-white/90 ${
        size === 'md' ? 'w-8 h-8 text-xs' : 'w-6 h-6 text-[10px]'
      }`}
      style={{ background: `hsl(${hue} 45% 32%)` }}
    >
      {initials}
    </span>
  );
}

interface Props extends HTMLAttributes<HTMLDivElement> {
  job: AdminJob;
  selected: boolean;
  /** Something is selected: checkboxes stay visible on every card. */
  selecting: boolean;
  focused: boolean;
  busy: boolean;
  dragging?: boolean;
  onToggle: () => void;
}

/**
 * A board card shows four things only: title, owner, age and target language. Everything else
 * waits in the drawer.
 */
export const JobCard = forwardRef<HTMLDivElement, Props>(function JobCard(
  { job, selected, selecting, focused, busy, dragging, onToggle, className = '', ...rest },
  ref,
) {
  const status = STATUS_STYLE[job.status];
  return (
    <div
      ref={ref}
      data-job={job.id}
      {...rest}
      className={`group relative rounded-lg border bg-slate-900 px-3 py-2.5 cursor-pointer select-none outline-none transition-[border-color,box-shadow,opacity] ${
        selected ? 'border-amber-400/70 bg-slate-900' : 'border-slate-800 hover:border-slate-600'
      } ${focused ? 'ring-2 ring-amber-400/80' : ''} ${dragging ? 'opacity-30' : ''} ${busy ? 'opacity-60 animate-pulse' : ''} ${className}`}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          role="checkbox"
          aria-checked={selected}
          aria-label={`Select ${jobTitle(job)}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className={`mt-0.5 w-4 h-4 shrink-0 rounded border flex items-center justify-center transition-opacity ${
            selected ? 'bg-amber-400 border-amber-400 text-slate-950' : 'border-slate-600 bg-slate-950'
          } ${selected || selecting ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'}`}
        >
          {selected && <Check className="w-3 h-3" strokeWidth={3} />}
        </button>
        <p className="flex-1 min-w-0 text-[13px] leading-snug font-medium text-slate-100 line-clamp-2 break-words">{jobTitle(job)}</p>
      </div>
      <div className="mt-2 flex items-center gap-2 text-[11px]">
        <Avatar job={job} />
        <span title={fullTime(job.created_at)} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
          <Clock className="w-3 h-3" />
          {relativeTime(job.created_at)}
        </span>
        <span className={`ml-auto px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide ${status.soft} ${status.text}`}>
          → {job.tgt_lang}
        </span>
      </div>
      {job.status === 'running' && (
        <div className="absolute inset-x-0 bottom-0 h-0.5 rounded-b-lg bg-slate-800 overflow-hidden" aria-hidden>
          <div className="h-full bg-status-running transition-[width] duration-700" style={{ width: `${job.progress}%` }} />
        </div>
      )}
    </div>
  );
});
