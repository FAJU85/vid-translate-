import { Ban, RotateCcw, Trash2, X } from 'lucide-react';
import type { AdminAction, AdminJob } from '../../../shared/api';
import { canDo } from './model';

/** Floats at the bottom while cards are selected: one click applies an action to all that fit. */
export function BulkBar({ jobs, run, clear }: { jobs: AdminJob[]; run: (action: AdminAction) => void; clear: () => void }) {
  if (!jobs.length) return null;
  const count = (a: AdminAction) => jobs.filter((j) => canDo(a, j)).length;
  const button = (action: AdminAction, label: string, icon: React.ReactNode, key: string, danger = false) => {
    const n = count(action);
    return (
      <button
        disabled={!n}
        onClick={() => run(action)}
        title={`${label} (${key})`}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm disabled:opacity-35 disabled:cursor-not-allowed ${
          danger ? 'text-rose-200 hover:bg-status-failed/15' : 'text-slate-100 hover:bg-slate-700'
        }`}
      >
        {icon}
        {label}
        {n > 0 && n !== jobs.length && <span className="text-xs text-slate-400 tabular-nums">{n}</span>}
      </button>
    );
  };
  return (
    <div
      role="toolbar"
      aria-label="Actions for selected jobs"
      className="fixed z-20 bottom-4 left-1/2 -translate-x-1/2 max-w-[calc(100vw-2rem)] flex flex-wrap items-center gap-1 p-1.5 rounded-xl border border-slate-700 bg-slate-800/95 backdrop-blur shadow-2xl shadow-black/50"
    >
      <span className="px-2.5 text-sm font-semibold text-white tabular-nums">{jobs.length} selected</span>
      <span className="w-px h-5 bg-slate-600" />
      {button('cancel', 'Cancel', <Ban className="w-4 h-4" />, 'C')}
      {button('retry', 'Retry', <RotateCcw className="w-4 h-4" />, 'R')}
      {button('delete', 'Delete', <Trash2 className="w-4 h-4" />, 'Del', true)}
      <span className="w-px h-5 bg-slate-600" />
      <button onClick={clear} aria-label="Clear selection (Esc)" className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
