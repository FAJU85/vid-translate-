import type { Env } from '../../shared/env';
import { UUID, apiError, json } from '../../shared/http';
import {
  TERMINAL,
  allJobs,
  cancelJob,
  deleteFinishedJobs,
  dispatch,
  fileLink,
  getJob,
  refreshJob,
  retryJob,
  type JobRow,
} from '../jobs';
import { isAdmin } from '../settings';

const LINK_TTL = 6 * 3600;
const MAX_BATCH = 100;
const REFRESH_ACTIVE = 10; // active jobs brought up to date per list request

type Action = 'cancel' | 'retry' | 'delete';

/** A job as the /admin dashboard sees it: more than the public view, but never the user's IP. */
async function adminJob(env: Env, job: JobRow, withOutputs = false) {
  let style: unknown = null;
  try {
    style = job.style ? JSON.parse(job.style) : null;
  } catch {
    /* an unreadable style is shown as the default */
  }
  const outputs: Record<string, string> = {};
  if (withOutputs && job.status === 'done') {
    for (const [key, name] of Object.entries(JSON.parse(job.outputs || '{}') as Record<string, string>)) {
      if (key !== 'cues') outputs[key] = await fileLink(env, job.id, name, LINK_TTL);
    }
  }
  return {
    id: job.id,
    channel: job.channel,
    // web:<browser id> or tg:<user id>: enough to group a person's jobs, nothing more.
    owner: job.owner,
    source_kind: job.source_kind,
    // Telegram file ids are internal and useless to a person.
    source: job.source_kind === 'telegram' ? null : job.source,
    title: job.title,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    waking: job.status === 'queued' && !job.dispatched && job.dispatch_attempts > 0,
    dispatch_attempts: job.dispatch_attempts,
    duration: job.duration,
    src_lang: job.src_lang,
    detected_lang: job.detected_lang,
    tgt_lang: job.tgt_lang,
    mode: job.mode,
    style,
    error_code: job.error_code,
    error_message: job.error_message,
    created_at: job.created_at,
    updated_at: job.updated_at,
    outputs,
  };
}

async function runAction(env: Env, ctx: ExecutionContext, action: Action, id: string) {
  const job = await getJob(env, id);
  if (!job) return { id, ok: false, error: 'This job no longer exists.' };
  if (action === 'cancel') {
    if (TERMINAL.includes(job.status)) return { id, ok: false, error: 'This job has already finished.' };
    await cancelJob(env, job);
    const fresh = await getJob(env, id);
    return { id, ok: true, job: fresh && (await adminJob(env, fresh)) };
  }
  if (action === 'retry') {
    if (job.source_kind === 'upload') {
      return { id, ok: false, error: 'Uploaded files are not kept after a job ends, so it cannot be retried.' };
    }
    const copy = await retryJob(env, job);
    if (!copy) return { id, ok: false, error: 'Only failed or cancelled jobs can be retried.' };
    ctx.waitUntil(dispatch(env, copy));
    return { id, ok: true, job: await adminJob(env, copy) };
  }
  const deleted = await deleteFinishedJobs(env, [id]);
  return deleted.length ? { id, ok: true } : { id, ok: false, error: 'Cancel a job before deleting it.' };
}

const STATS_DAYS = 7;

/** The site a link belongs to, for grouping: m./www./web. dropped, Facebook's short hosts merged. */
export function siteOf(url: string): string {
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return 'invalid link';
  }
  host = host.replace(/^(www|m|web|mobile|vm|vt)\./, '');
  if (host === 'fb.watch' || host === 'fb.com') return 'facebook.com';
  if (host === 'youtu.be') return 'youtube.com';
  return host;
}

/** Link downloads per site over the last week: how many worked, how many failed, and the last error. */
async function siteStats(env: Env) {
  const since = Date.now() / 1000 - STATS_DAYS * 86400;
  const sites = new Map<string, { site: string; done: number; failed: number; last_error: string | null; last_failed_at: number | null; last_done_at: number | null }>();
  for (const job of await allJobs(env)) {
    if (job.source_kind !== 'url' || job.created_at < since || !['done', 'failed'].includes(job.status)) continue;
    const site = siteOf(job.source);
    const row = sites.get(site) ?? { site, done: 0, failed: 0, last_error: null, last_failed_at: null, last_done_at: null };
    if (job.status === 'done') {
      row.done += 1;
      row.last_done_at = Math.max(row.last_done_at ?? 0, job.updated_at);
    } else {
      row.failed += 1;
      if (!row.last_failed_at || job.updated_at > row.last_failed_at) {
        row.last_failed_at = job.updated_at;
        row.last_error = [job.error_code, job.error_message].filter(Boolean).join(': ').slice(0, 200) || null;
      }
    }
    sites.set(site, row);
  }
  return {
    days: STATS_DAYS,
    sites: [...sites.values()].sort((a, b) => b.done + b.failed - (a.done + a.failed)),
  };
}

/** /api/admin/jobs[/<id>]: the jobs dashboard on the /admin page. Needs the admin password. */
export async function handleAdminJobs(request: Request, env: Env, ctx: ExecutionContext, path: string): Promise<Response> {
  if (!isAdmin(request, env)) return apiError(401, 'E_UNAUTHORIZED', 'Wrong password.');

  const one = path.match(/^\/api\/admin\/jobs\/([0-9a-f-]{36})$/);
  if (one && request.method === 'GET') {
    const job = await getJob(env, one[1]);
    if (!job) return apiError(404, 'E_JOB_NOT_FOUND', 'Job not found.');
    return json(await adminJob(env, await refreshJob(env, job), true));
  }

  if (path === '/api/admin/stats' && request.method === 'GET') return json(await siteStats(env));
  if (path !== '/api/admin/jobs') return apiError(404, 'E_NOT_FOUND', 'Not found.');

  if (request.method === 'GET') {
    let jobs = await allJobs(env);
    // The Space's progress reports are unreliable, so the newest active jobs are asked about directly.
    const active = jobs.filter((j) => !TERMINAL.includes(j.status)).slice(0, REFRESH_ACTIVE);
    if (active.length) {
      const fresh = new Map((await Promise.all(active.map((j) => refreshJob(env, j)))).map((j) => [j.id, j]));
      jobs = jobs.map((j) => fresh.get(j.id) ?? j);
    }
    return json(await Promise.all(jobs.map((j) => adminJob(env, j))));
  }

  if (request.method === 'POST') {
    const body = (await request.json().catch(() => null)) as { action?: string; ids?: unknown } | null;
    const action = body?.action as Action;
    if (!['cancel', 'retry', 'delete'].includes(action)) return apiError(400, 'E_BAD_REQUEST', 'Unknown action.');
    const ids = Array.isArray(body?.ids) ? [...new Set(body.ids.map(String))].filter((id) => UUID.test(id)) : [];
    if (!ids.length || ids.length > MAX_BATCH) return apiError(400, 'E_BAD_REQUEST', `Send 1 to ${MAX_BATCH} job ids.`);
    const results = [];
    for (const id of ids) results.push(await runAction(env, ctx, action, id));
    return json({ results });
  }

  return apiError(405, 'E_BAD_REQUEST', 'Method not allowed.');
}
