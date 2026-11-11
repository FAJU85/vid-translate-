import { useEffect, useState } from 'react';
import { ChevronRight, RefreshCw } from 'lucide-react';
import { api, type AppConfig, type Job } from '../lib/api';

const BADGE: Record<string, string> = {
  done: 'bg-emerald-950 text-emerald-300',
  failed: 'bg-rose-950 text-rose-300',
  cancelled: 'bg-slate-800 text-slate-300',
};

export function HistoryView({ config, onOpen }: { config: AppConfig | null; onOpen: (id: string) => void }) {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    api.jobs().then(setJobs).catch((e) => setError(e.message));
  };
  useEffect(load, []);

  const langName = (code: string) => config?.languages.find((l) => l.code === code)?.en ?? code;

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">My translations</h1>
          <p className="mt-1 text-sm text-slate-400">
            Videos submitted from this browser. Result files are kept for 24 hours.
          </p>
        </div>
        <button onClick={load} className="p-2 rounded-lg border border-slate-800 text-slate-300 hover:bg-slate-800" aria-label="Refresh">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {error && <p className="p-3 text-sm rounded-xl border border-rose-800 bg-rose-950/60 text-rose-200">{error}</p>}
      {jobs && jobs.length === 0 && (
        <p className="p-6 text-center text-sm rounded-xl border border-dashed border-slate-800 text-slate-400">
          Nothing here yet. Translate your first video from the Translate tab.
        </p>
      )}

      <ul className="space-y-2">
        {jobs?.map((job) => (
          <li key={job.id}>
            <button
              onClick={() => onOpen(job.id)}
              className="w-full flex items-center gap-3 p-4 text-left rounded-xl border border-slate-800 bg-slate-900 hover:border-slate-600"
            >
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-white truncate">{job.title ?? job.source_url ?? 'Video'}</div>
                <div className="mt-0.5 text-xs text-slate-400">
                  {new Date(job.created_at * 1000).toLocaleString()} · to {langName(job.tgt_lang)} ·{' '}
                  {job.mode === 'hard' ? 'burned-in video' : 'subtitle file'}
                </div>
              </div>
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${BADGE[job.status] ?? 'bg-amber-950 text-amber-300'}`}>
                {job.status === 'queued' || job.status === 'running' ? `${job.progress}%` : job.status}
              </span>
              <ChevronRight className="w-4 h-4 text-slate-500" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
