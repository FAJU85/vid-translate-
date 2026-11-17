import type { AdminAction, AdminJob, JobStatus } from '../../../shared/api';

/** Board columns, in workflow order. Five stages keep the board free of horizontal scrolling on a laptop. */
export const COLUMNS: { status: JobStatus; label: string; hint: string }[] = [
  { status: 'queued', label: 'Queued', hint: 'Drop a failed or cancelled job here to run it again' },
  { status: 'running', label: 'Translating', hint: 'Set by the translation server' },
  { status: 'done', label: 'Done', hint: 'Set by the translation server' },
  { status: 'failed', label: 'Failed', hint: 'Set by the translation server' },
  { status: 'cancelled', label: 'Cancelled', hint: 'Drop a queued or running job here to stop it' },
];

/** Tailwind classes per status, all built on the --color-status-* tokens in index.css. */
export const STATUS_STYLE: Record<JobStatus, { dot: string; text: string; soft: string; border: string; label: string }> = {
  awaiting_upload: { dot: 'bg-status-queued', text: 'text-status-queued', soft: 'bg-status-queued/10', border: 'border-status-queued/40', label: 'Uploading' },
  queued: { dot: 'bg-status-queued', text: 'text-status-queued', soft: 'bg-status-queued/10', border: 'border-status-queued/40', label: 'Queued' },
  running: { dot: 'bg-status-running', text: 'text-status-running', soft: 'bg-status-running/10', border: 'border-status-running/40', label: 'Translating' },
  done: { dot: 'bg-status-done', text: 'text-status-done', soft: 'bg-status-done/10', border: 'border-status-done/40', label: 'Done' },
  failed: { dot: 'bg-status-failed', text: 'text-status-failed', soft: 'bg-status-failed/10', border: 'border-status-failed/40', label: 'Failed' },
  cancelled: { dot: 'bg-status-cancelled', text: 'text-zinc-400', soft: 'bg-status-cancelled/15', border: 'border-status-cancelled/40', label: 'Cancelled' },
};

export const ACTIVE: JobStatus[] = ['queued', 'running'];

/** Whether an action applies to a job; the server checks the same rules. */
export function canDo(action: AdminAction, job: AdminJob): boolean {
  if (action === 'cancel') return ACTIVE.includes(job.status);
  if (action === 'retry') return (job.status === 'failed' || job.status === 'cancelled') && job.source_kind !== 'upload';
  return job.status === 'done' || job.status === 'failed' || job.status === 'cancelled';
}

/** The action a drop onto a column means, or null when that column is set only by the server. */
export function dropAction(job: AdminJob, column: JobStatus): AdminAction | null {
  if (column === job.status) return null;
  if (column === 'cancelled' && canDo('cancel', job)) return 'cancel';
  if (column === 'queued' && canDo('retry', job)) return 'retry';
  return null;
}

/** What a job looks like straight after an action, before the server answers. */
export function optimistic(action: AdminAction, job: AdminJob): AdminJob | null {
  if (action === 'delete') return null;
  if (action === 'cancel') return { ...job, status: 'cancelled', error_code: 'E_CANCELLED' };
  return { ...job, status: 'queued', stage: 'queued', progress: 0, error_code: null, error_message: null, outputs: {}, waking: false };
}

export const ACTION_LABEL: Record<AdminAction, { verb: string; done: string }> = {
  cancel: { verb: 'Cancel', done: 'cancelled' },
  retry: { verb: 'Retry', done: 'queued again' },
  delete: { verb: 'Delete', done: 'deleted' },
};

// ------------------------------------------------------------------ filters

export interface Filter {
  q: string;
  channel: 'all' | 'web' | 'telegram';
  statuses: JobStatus[]; // empty = every status
  range: 'all' | '24h' | '7d';
}

export const EMPTY_FILTER: Filter = { q: '', channel: 'all', statuses: [], range: 'all' };

export interface Preset {
  id: string;
  name: string;
  filter: Filter;
  builtIn?: boolean;
}

export const BUILT_IN_PRESETS: Preset[] = [
  { id: 'all', name: 'All jobs', filter: EMPTY_FILTER, builtIn: true },
  { id: 'active', name: 'In progress', filter: { ...EMPTY_FILTER, statuses: ['queued', 'running'] }, builtIn: true },
  { id: 'attention', name: 'Needs attention', filter: { ...EMPTY_FILTER, statuses: ['failed'] }, builtIn: true },
  { id: 'today', name: 'Last 24 hours', filter: { ...EMPTY_FILTER, range: '24h' }, builtIn: true },
  { id: 'telegram', name: 'Telegram', filter: { ...EMPTY_FILTER, channel: 'telegram' }, builtIn: true },
  { id: 'web', name: 'Website', filter: { ...EMPTY_FILTER, channel: 'web' }, builtIn: true },
];

export function sameFilter(a: Filter, b: Filter): boolean {
  return (
    a.q === b.q &&
    a.channel === b.channel &&
    a.range === b.range &&
    a.statuses.length === b.statuses.length &&
    a.statuses.every((s) => b.statuses.includes(s))
  );
}

export function applyFilter(jobs: AdminJob[], f: Filter, nowSec = Date.now() / 1000): AdminJob[] {
  const q = f.q.trim().toLowerCase();
  const since = f.range === '24h' ? nowSec - 86400 : f.range === '7d' ? nowSec - 7 * 86400 : 0;
  return jobs.filter(
    (j) =>
      (f.channel === 'all' || j.channel === f.channel) &&
      (!f.statuses.length || f.statuses.includes(j.status)) &&
      j.created_at >= since &&
      (!q ||
        [jobTitle(j), j.source ?? '', j.id, j.owner, j.tgt_lang, j.error_code ?? ''].some((v) => v.toLowerCase().includes(q))),
  );
}

// ------------------------------------------------------------------ formatting

export function jobTitle(job: AdminJob): string {
  if (job.title) return job.title;
  if (job.source_kind === 'url' && job.source) {
    try {
      const url = new URL(job.source);
      return url.hostname.replace(/^www\./, '') + url.pathname.replace(/\/$/, '');
    } catch {
      return job.source;
    }
  }
  return job.source_kind === 'telegram' ? 'Video sent to the bot' : 'Untitled video';
}

/** A short owner label and a stable hue for its avatar. */
export function ownerBadge(job: AdminJob): { initials: string; hue: number; label: string } {
  const id = job.owner.split(':')[1] ?? job.owner;
  let hash = 0;
  for (const c of job.owner) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  const label = job.channel === 'telegram' ? `Telegram user ${id}` : `Website visitor ${id.slice(0, 8)}`;
  const initials = job.channel === 'telegram' ? 'TG' : id.slice(0, 2).toUpperCase();
  return { initials, hue: hash % 360, label };
}

export function relativeTime(sec: number, nowSec = Date.now() / 1000): string {
  const d = Math.max(0, nowSec - sec);
  if (d < 60) return 'now';
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  if (d < 7 * 86400) return `${Math.floor(d / 86400)}d`;
  return new Date(sec * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function fullTime(sec: number): string {
  return new Date(sec * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatDuration(sec: number | null): string {
  if (sec == null) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}:${String(s).padStart(2, '0')}`;
}
