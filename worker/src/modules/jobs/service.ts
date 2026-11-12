import { signedQuery } from '../../shared/crypto';
import { now, type Env } from '../../shared/env';
import * as backend from './backend';
import { emitChanged, emitFinished } from './events';
import { TERMINAL, type BackendState, type Channel, type JobRow, type SourceKind, type SubtitleMode } from './model';
import * as store from './store';

const MAX_DISPATCH_ATTEMPTS = 15; // one per minute while the Space wakes up
const STALE_AFTER = 10 * 60;
const GIVE_UP_AFTER = 3 * 3600;

export const maxPerHour = (env: Env) => Number(env.MAX_JOBS_PER_HOUR) || 5;

// ------------------------------------------------------------------ creation

export interface NewJob {
  channel: Channel;
  owner: string;
  ip?: string | null;
  chatId?: number;
  statusMessageId?: number;
  uiLang?: string;
  sourceKind: SourceKind;
  source: string;
  title?: string | null;
  srcLang?: string;
  tgtLang: string;
  mode: SubtitleMode;
  origin: string;
}

export type LimitError = 'rate_limited' | 'busy';

/** Hourly quota and concurrent-job cap. Uploads are checked again when they start. */
export async function checkLimits(
  env: Env,
  p: { owner: string; ip?: string | null; channel: Channel },
): Promise<LimitError | null> {
  const limit = maxPerHour(env);
  if ((await store.countRecent(env, 'owner', p.owner)) >= limit) return 'rate_limited';
  if (p.ip && (await store.countRecent(env, 'ip', p.ip)) >= limit * 3) return 'rate_limited';
  if ((await store.activeJobs(env, p.owner)).length >= (p.channel === 'telegram' ? 1 : 2)) return 'busy';
  return null;
}

export async function createJob(env: Env, p: NewJob): Promise<{ job?: JobRow; error?: LimitError }> {
  const limited = await checkLimits(env, p);
  if (limited) return { error: limited };

  const ts = now();
  const job: JobRow = {
    id: crypto.randomUUID(),
    channel: p.channel,
    owner: p.owner,
    ip: p.ip ?? null,
    chat_id: p.chatId ?? null,
    status_message_id: p.statusMessageId ?? null,
    ui_lang: p.uiLang ?? 'en',
    source_kind: p.sourceKind,
    source: p.source,
    title: p.title ?? null,
    duration: null,
    src_lang: p.srcLang || 'auto',
    tgt_lang: p.tgtLang,
    detected_lang: null,
    mode: p.mode,
    status: p.sourceKind === 'upload' ? 'awaiting_upload' : 'queued',
    stage: 'queued',
    progress: 0,
    error_code: null,
    error_message: null,
    outputs: null,
    origin: p.origin,
    dispatched: 0,
    dispatch_attempts: 0,
    delivered: 0,
    notified: null,
    created_at: ts,
    updated_at: ts,
  };
  await store.insertJob(env, job);
  return { job };
}

/** A browser upload finished: queue the job, re-checking the limits it skipped at creation. */
export async function startUploadedJob(env: Env, job: JobRow): Promise<{ job?: JobRow; error?: LimitError }> {
  const limited = await checkLimits(env, { owner: job.owner, ip: job.ip, channel: job.channel });
  if (limited) return { error: limited };
  await store.updateJob(env, job.id, { status: 'queued' });
  return { job: { ...job, status: 'queued' } };
}

// ------------------------------------------------------------------ hand-off to the Space

/** Hand a queued job to the Space. Returns true once the Space has accepted it. */
export async function dispatch(env: Env, job: JobRow): Promise<boolean> {
  let sourceKind: string = job.source_kind;
  let sourceUrl: string | undefined;
  if (job.source_kind === 'url') {
    sourceUrl = job.source;
  } else if (job.source_kind === 'telegram') {
    // The Space cannot reach api.telegram.org, so it downloads the file through this Worker.
    sourceKind = 'direct';
    sourceUrl = `${job.origin}/tg-file/${job.id}?${await signedQuery(env.SHARED_SECRET, `tgfile:${job.id}`, 6 * 3600)}`;
  }

  let failure = '';
  try {
    const { status, data } = await backend.invoke(env, {
      job_id: job.id,
      source_kind: sourceKind,
      source_url: sourceUrl,
      src_lang: job.src_lang,
      tgt_lang: job.tgt_lang,
      subtitle_mode: job.mode,
      callback_url: `${job.origin}/api/callback`,
      title: job.title,
    });
    if (status === 202 && data?.status === 'accepted') {
      await store.updateJob(env, job.id, { dispatched: 1 });
      // The user may have cancelled while the hand-off was in flight.
      if ((await store.getJob(env, job.id))?.status === 'cancelled') await cancelOnBackend(env, job.id);
      return true;
    }
    if (data && [400, 409, 422].includes(status)) {
      await failJob(env, job, status === 409 ? 'E_INTERNAL' : 'E_URL_INVALID', String(data.error ?? ''));
      return false;
    }
    failure = `HTTP ${status}`; // asleep, building, busy (429) or misconfigured (401)
  } catch (err) {
    failure = (err as Error).message;
  }

  console.warn(`dispatch of ${job.id} failed (${failure}), attempt ${job.dispatch_attempts + 1}`);
  const attempts = job.dispatch_attempts + 1;
  if (attempts >= MAX_DISPATCH_ATTEMPTS) {
    await failJob(env, job, 'E_BACKEND_DOWN', failure);
    return false;
  }
  await store.updateJob(env, job.id, { dispatch_attempts: attempts });
  if (attempts === 1) await emitChanged(env, { ...job, dispatch_attempts: attempts });
  return false;
}

async function cancelOnBackend(env: Env, jobId: string): Promise<void> {
  if (await backend.cancel(env, jobId)) await store.confirmBackendCancel(env, jobId);
}

// ------------------------------------------------------------------ state changes

/** Apply a progress report from the Space (callback or status poll). */
export async function applyState(env: Env, job: JobRow, state: BackendState): Promise<void> {
  if (TERMINAL.includes(job.status)) {
    // Cancelled here but still alive on the Space (its /cancel call was lost): tell it again.
    if (job.status === 'cancelled' && ['queued', 'running'].includes(state.status)) await cancelOnBackend(env, job.id);
    return;
  }

  const patch: Partial<JobRow> = {
    dispatched: 1,
    stage: state.stage || job.stage,
    progress: Math.max(job.progress, Math.round(state.progress ?? 0)),
    title: state.title || job.title,
    duration: state.duration ?? job.duration,
    detected_lang: state.detected_lang ?? job.detected_lang,
  };
  if (state.status === 'done') {
    Object.assign(patch, { status: 'done', stage: 'done', progress: 100, outputs: JSON.stringify(state.outputs ?? {}) });
  } else if (state.status === 'failed') {
    Object.assign(patch, {
      status: 'failed',
      error_code: state.error?.code ?? 'E_INTERNAL',
      error_message: state.error?.message ?? null,
    });
  } else if (state.status === 'cancelled') {
    Object.assign(patch, { status: 'cancelled', error_code: 'E_CANCELLED' });
  } else if (state.status === 'running') {
    patch.status = 'running';
  }
  if (!(await store.updateActiveJob(env, job.id, patch))) return; // finished or cancelled meanwhile
  const updated: JobRow = { ...job, ...patch };

  if (updated.status === 'done') {
    await emitFinished(env, updated);
  } else if (TERMINAL.includes(updated.status)) {
    await emitChanged(env, updated);
  } else {
    const key = `${updated.stage}:${Math.floor(updated.progress / 10)}`;
    if (key !== job.notified) {
      await store.updateJob(env, job.id, { notified: key });
      await emitChanged(env, updated);
    }
  }
}

export async function failJob(env: Env, job: JobRow, code: string, message: string): Promise<void> {
  if (TERMINAL.includes(job.status)) return;
  if (!(await store.updateActiveJob(env, job.id, { status: 'failed', error_code: code, error_message: message }))) return;
  await emitChanged(env, { ...job, status: 'failed', error_code: code, error_message: message });
}

export async function cancelJob(env: Env, job: JobRow): Promise<void> {
  if (TERMINAL.includes(job.status)) return;
  if (!(await store.updateActiveJob(env, job.id, { status: 'cancelled', error_code: 'E_CANCELLED' }))) return;
  // Re-read: a hand-off in flight may have completed since `job` was loaded.
  if ((await store.getJob(env, job.id))?.dispatched) await cancelOnBackend(env, job.id);
  await emitChanged(env, { ...job, status: 'cancelled' });
}

// ------------------------------------------------------------------ scheduled upkeep

/** Runs every minute: retries hand-offs to a sleeping Space and reconciles stuck jobs. */
export async function sweep(env: Env): Promise<void> {
  const ts = now();

  for (const job of await store.waitingForDispatch(env, ts - 20)) await dispatch(env, job);

  for (const job of await store.staleDispatched(env, ts - STALE_AFTER)) {
    try {
      const state = await backend.status(env, job.id);
      if (state === 'unknown') {
        await failJob(env, job, 'E_BACKEND_RESTARTED', '');
        continue;
      }
      if (state) {
        const fresh = await store.getJob(env, job.id);
        if (fresh) await applyState(env, fresh, state);
        await store.touchActive(env, job.id, ts);
        continue;
      }
    } catch {
      /* Space unreachable: decide below */
    }
    if (job.created_at < ts - GIVE_UP_AFTER) await failJob(env, job, 'E_BACKEND_DOWN', '');
  }

  // Cancelled here but not yet confirmed stopped on the Space: keep asking for an hour.
  for (const id of await store.unconfirmedCancels(env, ts - 3600)) await cancelOnBackend(env, id);

  await store.purgeOld(env, ts);
}
