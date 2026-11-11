import { signedQuery } from './crypto';
import { activeJobs, countRecent, getJob, insertJob, updateJob } from './db';
import { errorText, esc, langName, t, type UiLang } from './i18n';
import { editMessage, sendFile, sendMessage, type Keyboard } from './telegram';
import { TERMINAL, now, type BackendState, type Env, type JobRow, type SourceKind, type SubtitleMode } from './types';

const TELEGRAM_UPLOAD_LIMIT = 49 * 1024 * 1024; // bots may upload up to 50 MB
const LINK_TTL = 24 * 3600;
const MAX_DISPATCH_ATTEMPTS = 15; // one per minute while the Space wakes up
const STALE_AFTER = 10 * 60;
const GIVE_UP_AFTER = 3 * 3600;

const backend = (env: Env) => env.BACKEND_URL.replace(/\/$/, '');
const authHeaders = (env: Env) => ({ Authorization: `Bearer ${env.SHARED_SECRET}` });
export const maxPerHour = (env: Env) => Number(env.MAX_JOBS_PER_HOUR) || 5;

// ------------------------------------------------------------------ creation

export interface NewJob {
  channel: 'web' | 'telegram';
  owner: string;
  ip?: string | null;
  chatId?: number;
  statusMessageId?: number;
  uiLang?: UiLang;
  sourceKind: SourceKind;
  source: string;
  title?: string | null;
  srcLang?: string;
  tgtLang: string;
  mode: SubtitleMode;
  origin: string;
}

type LimitError = 'rate_limited' | 'busy';

/** Hourly quota and concurrent-job cap. Uploads are checked again when they start. */
export async function checkLimits(
  env: Env,
  p: { owner: string; ip?: string | null; channel: 'web' | 'telegram' },
): Promise<LimitError | null> {
  const limit = maxPerHour(env);
  if ((await countRecent(env, 'owner', p.owner)) >= limit) return 'rate_limited';
  if (p.ip && (await countRecent(env, 'ip', p.ip)) >= limit * 3) return 'rate_limited';
  if ((await activeJobs(env, p.owner)).length >= (p.channel === 'telegram' ? 1 : 2)) return 'busy';
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
  await insertJob(env, job);
  return { job };
}

// ------------------------------------------------------------------ backend calls

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
    const res = await fetch(`${backend(env)}/invoke`, {
      method: 'POST',
      headers: { ...authHeaders(env), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_id: job.id,
        source_kind: sourceKind,
        source_url: sourceUrl,
        src_lang: job.src_lang,
        tgt_lang: job.tgt_lang,
        subtitle_mode: job.mode,
        callback_url: `${job.origin}/api/callback`,
        title: job.title,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const data = (await res.json().catch(() => null)) as { status?: string; error?: string } | null;
    if (res.status === 202 && data?.status === 'accepted') {
      await updateJob(env, job.id, { dispatched: 1 });
      // The user may have cancelled while the hand-off was in flight.
      if ((await getJob(env, job.id))?.status === 'cancelled') await cancelOnBackend(env, job.id);
      return true;
    }
    if (data && [400, 409, 422].includes(res.status)) {
      await failJob(env, job, res.status === 409 ? 'E_INTERNAL' : 'E_URL_INVALID', String(data.error ?? ''));
      return false;
    }
    failure = `HTTP ${res.status}`; // asleep, building, busy (429) or misconfigured (401)
  } catch (err) {
    failure = (err as Error).message;
  }

  console.warn(`dispatch of ${job.id} failed (${failure}), attempt ${job.dispatch_attempts + 1}`);
  const attempts = job.dispatch_attempts + 1;
  if (attempts >= MAX_DISPATCH_ATTEMPTS) {
    await failJob(env, job, 'E_BACKEND_DOWN', failure);
    return false;
  }
  await updateJob(env, job.id, { dispatch_attempts: attempts });
  if (attempts === 1) await showStatus(env, { ...job, dispatch_attempts: attempts });
  return false;
}

export async function fileLink(env: Env, jobId: string, name: string, ttl: number, filename?: string): Promise<string> {
  const query = await signedQuery(env.SHARED_SECRET, `file:${jobId}:${name}`, ttl);
  return `${backend(env)}/files/${jobId}/${name}?${query}${filename ? `&filename=${encodeURIComponent(filename)}` : ''}`;
}

export async function uploadLink(env: Env, jobId: string): Promise<string> {
  return `${backend(env)}/upload/${jobId}?${await signedQuery(env.SHARED_SECRET, `upload:${jobId}`, 2 * 3600)}`;
}

export async function backendHealth(env: Env): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${backend(env)}/health`, { signal: AbortSignal.timeout(8_000) });
    return res.ok ? ((await res.json()) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ state changes

/** Ask the Space to stop a job. Once it confirms, the job is no longer marked as handed off. */
async function cancelOnBackend(env: Env, jobId: string): Promise<void> {
  try {
    const res = await fetch(`${backend(env)}/cancel/${jobId}`, {
      method: 'POST',
      headers: authHeaders(env),
      signal: AbortSignal.timeout(8_000),
    });
    // 404 with a JSON body means the Space no longer knows the job: nothing left to stop.
    if (res.ok || (res.status === 404 && (await res.json().catch(() => null)))) {
      await env.DB.prepare(`UPDATE jobs SET dispatched = 0 WHERE id = ? AND status = 'cancelled'`).bind(jobId).run();
    }
  } catch {
    /* unreachable: the sweep retries */
  }
}

/** Like updateJob, but never overwrites a finished job. Returns false if it was already finished. */
async function updateActiveJob(env: Env, id: string, patch: Partial<JobRow>): Promise<boolean> {
  const cols = Object.keys(patch) as (keyof JobRow)[];
  const res = await env.DB.prepare(
    `UPDATE jobs SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ?
     WHERE id = ? AND status NOT IN ('done', 'failed', 'cancelled')`,
  )
    .bind(...cols.map((c) => patch[c] ?? null), now(), id)
    .run();
  return res.meta.changes > 0;
}

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
  if (!(await updateActiveJob(env, job.id, patch))) return; // finished or cancelled meanwhile
  const updated: JobRow = { ...job, ...patch };

  if (updated.status === 'done') {
    await deliver(env, updated);
  } else if (TERMINAL.includes(updated.status)) {
    await showStatus(env, updated);
  } else {
    const key = `${updated.stage}:${Math.floor(updated.progress / 10)}`;
    if (key !== job.notified) {
      await updateJob(env, job.id, { notified: key });
      await showStatus(env, updated);
    }
  }
}

export async function failJob(env: Env, job: JobRow, code: string, message: string): Promise<void> {
  if (TERMINAL.includes(job.status)) return;
  if (!(await updateActiveJob(env, job.id, { status: 'failed', error_code: code, error_message: message }))) return;
  await showStatus(env, { ...job, status: 'failed', error_code: code, error_message: message });
}

export async function cancelJob(env: Env, job: JobRow): Promise<void> {
  if (TERMINAL.includes(job.status)) return;
  if (!(await updateActiveJob(env, job.id, { status: 'cancelled', error_code: 'E_CANCELLED' }))) return;
  // Re-read: a hand-off in flight may have completed since `job` was loaded.
  if ((await getJob(env, job.id))?.dispatched) await cancelOnBackend(env, job.id);
  await showStatus(env, { ...job, status: 'cancelled' });
}

// ------------------------------------------------------------------ Telegram presentation

function jobTitle(job: JobRow): string {
  if (job.title) return job.title;
  if (job.source_kind === 'url') {
    try {
      return new URL(job.source).hostname.replace(/^www\./, '');
    } catch {
      /* fall through */
    }
  }
  return t(job.ui_lang as UiLang, 'untitled');
}

function statusText(job: JobRow): string {
  const ui = job.ui_lang as UiLang;
  const title = esc(jobTitle(job));
  if (job.status === 'done') return t(ui, 'done', { title });
  if (job.status === 'cancelled') return t(ui, 'cancelled');
  if (job.status === 'failed') return errorText(ui, job.error_code, job.error_message);
  const waking = job.status === 'queued' && !job.dispatched && job.dispatch_attempts > 0;
  const stage = waking ? 'stage_waking' : `stage_${job.status === 'queued' ? 'queued' : job.stage}`;
  const filled = Math.round(job.progress / 10);
  const bar = '▓'.repeat(filled) + '░'.repeat(10 - filled);
  return `🎬 <b>${title}</b>\n${bar} ${job.progress}%\n${t(ui, stage)}`;
}

/** Create or update the single progress message of a Telegram job. */
export async function showStatus(env: Env, job: JobRow): Promise<void> {
  if (job.channel !== 'telegram' || !job.chat_id) return;
  const keyboard: Keyboard = TERMINAL.includes(job.status)
    ? []
    : [[{ text: t(job.ui_lang as UiLang, 'btn_cancel'), callback_data: `cancel:${job.id}` }]];
  if (job.status_message_id) {
    await editMessage(env, job.chat_id, job.status_message_id, statusText(job), keyboard);
  } else {
    const sent = await sendMessage(env, job.chat_id, statusText(job), keyboard);
    if (sent) await updateJob(env, job.id, { status_message_id: sent.message_id });
  }
}

function fileBase(job: JobRow): string {
  const base = (job.title ?? '')
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return base || 'subtitles';
}

/** Send the finished files into the Telegram chat (exactly once per job). */
async function deliver(env: Env, job: JobRow): Promise<void> {
  if (job.channel !== 'telegram' || !job.chat_id) return;
  const claim = await env.DB.prepare('UPDATE jobs SET delivered = 1 WHERE id = ? AND delivered = 0').bind(job.id).run();
  if (!claim.meta.changes) return;

  const ui = job.ui_lang as UiLang;
  const chatId = String(job.chat_id);
  const title = esc(jobTitle(job));
  const outputs = JSON.parse(job.outputs || '{}') as Record<string, string>;
  const base = fileBase(job);

  const srtName = `${base}.${job.tgt_lang}.srt`;
  const srtUrl = await fileLink(env, job.id, 'subtitles.srt', LINK_TTL, srtName);
  const caption = t(ui, 'done_caption', {
    title,
    src: langName(job.detected_lang ?? job.src_lang, ui),
    tgt: langName(job.tgt_lang, ui),
  });
  const srtSent = await sendFile(env, 'sendDocument', 'document', await fetch(srtUrl), srtName, {
    chat_id: chatId,
    caption,
    parse_mode: 'HTML',
  });
  if (!srtSent) await sendMessage(env, job.chat_id, t(ui, 'srt_link', { url: esc(srtUrl) }));

  if (job.mode === 'hard') {
    if (outputs.mp4) {
      const videoUrl = await fileLink(env, job.id, 'video.mp4', LINK_TTL, `${base}.${job.tgt_lang}.mp4`);
      const res = await fetch(videoUrl);
      let sent = false;
      if (res.ok && Number(res.headers.get('content-length')) <= TELEGRAM_UPLOAD_LIMIT) {
        sent = await sendFile(env, 'sendVideo', 'video', res, `${base}.${job.tgt_lang}.mp4`, {
          chat_id: chatId,
          caption: t(ui, 'video_caption', { title }),
          parse_mode: 'HTML',
          supports_streaming: 'true',
        });
      } else {
        await res.body?.cancel();
      }
      if (!sent) await sendMessage(env, job.chat_id, t(ui, 'video_link', { url: esc(videoUrl) }));
    } else {
      await sendMessage(env, job.chat_id, t(ui, 'audio_only_note'));
    }
  }
  await showStatus(env, job);
}

// ------------------------------------------------------------------ scheduled upkeep

/** Runs every minute: retries hand-offs to a sleeping Space and reconciles stuck jobs. */
export async function sweep(env: Env): Promise<void> {
  const ts = now();

  const waiting = await env.DB.prepare(
    `SELECT * FROM jobs WHERE status = 'queued' AND dispatched = 0 AND created_at < ? LIMIT 10`,
  )
    .bind(ts - 20)
    .all<JobRow>();
  for (const job of waiting.results) await dispatch(env, job);

  const stale = await env.DB.prepare(
    `SELECT * FROM jobs WHERE status IN ('queued', 'running') AND dispatched = 1 AND updated_at < ? LIMIT 10`,
  )
    .bind(ts - STALE_AFTER)
    .all<JobRow>();
  for (const job of stale.results) {
    try {
      const res = await fetch(`${backend(env)}/status/${job.id}`, {
        headers: authHeaders(env),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 404 && (await res.json().catch(() => null))) {
        await failJob(env, job, 'E_BACKEND_RESTARTED', '');
        continue;
      }
      if (res.ok) {
        const fresh = await getJob(env, job.id);
        if (fresh) await applyState(env, fresh, (await res.json()) as BackendState);
        await env.DB.prepare('UPDATE jobs SET updated_at = ? WHERE id = ? AND status IN (?, ?)')
          .bind(ts, job.id, 'queued', 'running')
          .run();
        continue;
      }
    } catch {
      /* Space unreachable: decide below */
    }
    if (job.created_at < ts - GIVE_UP_AFTER) await failJob(env, job, 'E_BACKEND_DOWN', '');
  }

  // Cancelled here but not yet confirmed stopped on the Space: keep asking for an hour.
  const unconfirmed = await env.DB.prepare(
    `SELECT id FROM jobs WHERE status = 'cancelled' AND dispatched = 1 AND updated_at > ? LIMIT 10`,
  )
    .bind(ts - 3600)
    .all<{ id: string }>();
  for (const { id } of unconfirmed.results) await cancelOnBackend(env, id);

  await env.DB.prepare(`DELETE FROM jobs WHERE status = 'awaiting_upload' AND created_at < ?`).bind(ts - 3 * 3600).run();
  await env.DB.prepare(`DELETE FROM jobs WHERE created_at < ?`).bind(ts - 30 * 86400).run();
}
