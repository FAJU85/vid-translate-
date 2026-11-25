import { Check } from 'lucide-react';
import type { Job } from '../../shared/api';

/** The stages a job goes through, in order, for its result (the server's job.stage names). */
function stagesFor(job: Job): { id: string; label: string }[] {
  const list = [
    { id: 'downloading', label: job.source_url ? 'Get the video' : 'Upload' },
    { id: 'transcribing', label: 'Listen' },
    { id: 'translating', label: 'Translate' },
  ];
  if (job.mode === 'hard') list.push({ id: 'rendering', label: 'Add subtitles' });
  if (job.mode === 'dub') list.push({ id: 'dubbing', label: 'Record voice' });
  return list;
}

/**
 * Where a job is: each stage done (teal check), the current one live (coral, pulsing), the rest to
 * come. Waiting in the queue or for the server counts as before the first stage.
 */
export function Progress({ job }: { job: Job }) {
  const stages = stagesFor(job);
  const at = job.status === 'running' ? stages.findIndex((s) => s.id === job.stage) : -1;
  return (
    <ol className="flex items-start" aria-label="Progress">
      {stages.map((s, i) => {
        const done = at > i;
        const live = at === i;
        return (
          <li key={s.id} className="flex-1 flex flex-col items-center text-center relative" aria-current={live ? 'step' : undefined}>
            {/* The line to the previous stage. */}
            {i > 0 && <span className={`absolute top-3.5 right-1/2 w-full h-0.5 ${at >= i ? 'bg-amber-400' : 'bg-slate-700'}`} aria-hidden />}
            <span
              className={`relative z-10 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                done
                  ? 'bg-amber-400 text-slate-950'
                  : live
                    ? 'bg-rose-400 text-slate-950 ring-4 ring-rose-400/25 animate-pulse'
                    : 'bg-slate-800 text-slate-400 border border-slate-700'
              }`}
            >
              {done ? <Check className="w-4 h-4" /> : i + 1}
            </span>
            <span className={`mt-1.5 text-[11px] sm:text-xs ${live ? 'text-slate-100 font-semibold' : done ? 'text-slate-300' : 'text-slate-500'}`}>
              {s.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
