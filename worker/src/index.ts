import { handleUpdate, parseVideoUrl, setupBot } from './bot';
import { hmacHex, safeEqual, verifySigned } from './crypto';
import { ensureSchema, getJob, listJobs, updateJob } from './db';
import { LANGUAGES, isTargetLang } from './i18n';
import { applyState, backendHealth, cancelJob, createJob, dispatch, fileLink, maxPerHour, sweep, uploadLink } from './jobs';
import { fileUrl, tg } from './telegram';
import { TERMINAL, type BackendState, type Env, type JobRow } from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const OUTPUT_LINK_TTL = 6 * 3600;

const json = (data: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });

const apiError = (status: number, code: string, message: string) => json({ error_code: code, message }, status);

function corsHeaders(env: Env, request: Request): Record<string, string> {
  const allowed = (env.ALLOWED_ORIGINS ?? '*').split(',').map((s) => s.trim()).filter(Boolean);
  const origin = request.headers.get('Origin') ?? '';
  const allow = allowed.includes('*') ? '*' : allowed.includes(origin) ? origin : '';
  if (!allow) return {};
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const maxUploadMb = (env: Env) => Number(env.MAX_UPLOAD_MB) || 500;

/** What the website is allowed to see of a job. */
async function publicJob(env: Env, job: JobRow) {
  const names = job.status === 'done' ? (JSON.parse(job.outputs || '{}') as Record<string, string>) : {};
  const base = (job.title ?? 'subtitles').replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 60) || 'subtitles';
  const outputs: Record<string, string> = {};
  for (const [key, name] of Object.entries(names)) {
    const ext = name.split('.').pop();
    const download = key === 'cues' ? undefined : `${base}.${key === 'original_srt' ? 'original' : job.tgt_lang}.${ext}`;
    outputs[`${key}_url`] = await fileLink(env, job.id, name, OUTPUT_LINK_TTL, download);
  }
  return {
    id: job.id,
    channel: job.channel,
    status: job.status,
    stage: job.status === 'queued' && !job.dispatched && job.dispatch_attempts > 0 ? 'waking' : job.stage,
    progress: job.progress,
    title: job.title,
    source_url: job.source_kind === 'url' ? job.source : null,
    duration: job.duration,
    src_lang: job.src_lang,
    detected_lang: job.detected_lang,
    tgt_lang: job.tgt_lang,
    mode: job.mode,
    error_code: job.error_code,
    error_message: job.error_message,
    created_at: job.created_at,
    updated_at: job.updated_at,
    outputs,
  };
}

let botUsername: string | null = null;

async function handleApi(request: Request, env: Env, ctx: ExecutionContext, url: URL, origin: string): Promise<Response> {
  const path = url.pathname;
  const method = request.method;

  if (path === '/api/health' && method === 'GET') {
    return json({ status: 'ok', backend: await backendHealth(env) });
  }

  if (path === '/api/config' && method === 'GET') {
    if (!botUsername && env.TELEGRAM_BOT_TOKEN) botUsername = (await tg<{ username: string }>(env, 'getMe'))?.username ?? null;
    return json({
      bot_username: botUsername,
      languages: LANGUAGES.map(({ code, flag, en, ar }) => ({ code, flag, en, ar })),
      max_upload_mb: maxUploadMb(env),
      max_jobs_per_hour: maxPerHour(env),
    });
  }

  if (path === '/api/jobs' && method === 'GET') {
    const client = url.searchParams.get('client_id') ?? '';
    if (!UUID.test(client)) return apiError(400, 'E_BAD_REQUEST', 'client_id is required.');
    const jobs = (await listJobs(env, `web:${client}`)).filter((j) => j.status !== 'awaiting_upload');
    return json(await Promise.all(jobs.map((j) => publicJob(env, j))));
  }

  if (path === '/api/jobs' && method === 'POST') {
    const body = (await request.json().catch(() => null)) as Record<string, any> | null;
    if (!body || !UUID.test(body.client_id ?? '')) return apiError(400, 'E_BAD_REQUEST', 'client_id is required.');
    const tgtLang = String(body.tgt_lang ?? 'ar');
    if (!isTargetLang(tgtLang)) return apiError(400, 'E_BAD_REQUEST', 'Unsupported target language.');
    const srcLang = /^[a-z]{2,3}$/.test(body.src_lang ?? '') ? body.src_lang : 'auto';
    const mode = body.subtitle_mode === 'hard' ? 'hard' : 'soft';

    let sourceKind: 'url' | 'upload';
    let source: string;
    let title: string | null = null;
    if (body.upload) {
      const sizeMb = Number(body.upload.size ?? 0) / (1024 * 1024);
      if (sizeMb > maxUploadMb(env)) {
        return apiError(413, 'E_FILE_TOO_LARGE', `The file is larger than ${maxUploadMb(env)} MB.`);
      }
      sourceKind = 'upload';
      source = String(body.upload.name ?? 'upload').slice(0, 200);
      title = source.replace(/\.[a-z0-9]{2,4}$/i, '');
    } else {
      const parsed = parseVideoUrl(String(body.video_url ?? ''));
      if (!parsed) return apiError(400, 'E_URL_INVALID', 'Please enter a valid public video link.');
      sourceKind = 'url';
      source = parsed;
    }

    const { job, error } = await createJob(env, {
      channel: 'web',
      owner: `web:${body.client_id}`,
      ip: request.headers.get('CF-Connecting-IP'),
      sourceKind,
      source,
      title,
      srcLang,
      tgtLang,
      mode,
      origin,
    });
    if (!job) {
      return apiError(
        429,
        'E_RATE_LIMITED',
        error === 'busy'
          ? 'You already have translations in progress. Wait for one to finish.'
          : `Limit of ${maxPerHour(env)} videos per hour reached. Try again later.`,
      );
    }
    if (sourceKind === 'url') ctx.waitUntil(dispatch(env, job));
    return json(
      { ...(await publicJob(env, job)), ...(sourceKind === 'upload' ? { upload_url: await uploadLink(env, job.id) } : {}) },
      201,
    );
  }

  const match = path.match(/^\/api\/jobs\/([0-9a-f-]{36})(\/start|\/cancel)?$/);
  if (match) {
    const job = await getJob(env, match[1]);
    if (!job) return apiError(404, 'E_JOB_NOT_FOUND', 'Job not found.');
    if (!match[2] && method === 'GET') return json(await publicJob(env, job));

    if (match[2] && method === 'POST') {
      const body = (await request.json().catch(() => null)) as Record<string, any> | null;
      if (job.owner !== `web:${body?.client_id}`) return apiError(403, 'E_FORBIDDEN', 'This job belongs to someone else.');
      if (match[2] === '/start') {
        if (job.status !== 'awaiting_upload') return json(await publicJob(env, job));
        await updateJob(env, job.id, { status: 'queued' });
        const queued: JobRow = { ...job, status: 'queued' };
        ctx.waitUntil(dispatch(env, queued));
        return json(await publicJob(env, queued));
      }
      await cancelJob(env, job);
      return json(await publicJob(env, (await getJob(env, job.id)) ?? job));
    }
  }

  return apiError(404, 'E_NOT_FOUND', 'Not found.');
}

/** Progress reports from the Space, authenticated with an HMAC over timestamp + body. */
async function handleCallback(request: Request, env: Env): Promise<Response> {
  const body = await request.text();
  const ts = request.headers.get('X-Timestamp') ?? '';
  const sig = request.headers.get('X-Signature') ?? '';
  const fresh = Math.abs(Date.now() / 1000 - Number(ts)) < 600;
  if (!sig || !fresh || !safeEqual(await hmacHex(env.SHARED_SECRET, `${ts}.${body}`), sig)) {
    return apiError(401, 'E_UNAUTHORIZED', 'Invalid callback signature.');
  }
  let state: BackendState;
  try {
    state = JSON.parse(body);
  } catch {
    return apiError(400, 'E_BAD_REQUEST', 'Invalid JSON.');
  }
  const job = UUID.test(state.job_id ?? '') ? await getJob(env, state.job_id) : null;
  if (!job) return apiError(404, 'E_JOB_NOT_FOUND', 'Job not found.');
  await applyState(env, job, state);
  return json({ ok: true });
}

/** Lets the Space download a file a user sent to the bot (the Space cannot reach Telegram itself). */
async function handleTelegramFile(env: Env, url: URL, jobId: string): Promise<Response> {
  const ok = await verifySigned(env.SHARED_SECRET, `tgfile:${jobId}`, url.searchParams.get('exp'), url.searchParams.get('sig'));
  if (!ok) return apiError(403, 'E_FORBIDDEN', 'Invalid or expired link.');
  const job = await getJob(env, jobId);
  if (!job || job.source_kind !== 'telegram' || TERMINAL.includes(job.status)) {
    return apiError(404, 'E_JOB_NOT_FOUND', 'Job not found.');
  }
  const file = await tg<{ file_path?: string }>(env, 'getFile', { file_id: job.source });
  if (!file?.file_path) return apiError(502, 'E_DOWNLOAD_FAILED', 'Telegram did not return the file.');
  const upstream = await fetch(fileUrl(env, file.file_path));
  if (!upstream.ok) return apiError(502, 'E_DOWNLOAD_FAILED', 'Telegram file download failed.');
  const headers = new Headers({ 'Content-Type': 'application/octet-stream' });
  const length = upstream.headers.get('content-length');
  if (length) headers.set('Content-Length', length);
  return new Response(upstream.body, { headers });
}

async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const origin = (env.PUBLIC_URL || url.origin).replace(/\/$/, '');
  const path = url.pathname;

  if (path === '/') {
    return json({ service: 'tarjimvideo-worker', status: 'ok' });
  }

  if (path === '/telegram/webhook' && request.method === 'POST') {
    const secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token') ?? '';
    if (!env.TELEGRAM_WEBHOOK_SECRET || !safeEqual(secret, env.TELEGRAM_WEBHOOK_SECRET)) {
      return apiError(401, 'E_UNAUTHORIZED', 'Bad webhook secret.');
    }
    const update = await request.json().catch(() => null);
    if (update) {
      try {
        await handleUpdate(env, ctx, origin, update);
      } catch (err) {
        // Always answer 200: Telegram would otherwise redeliver the same update for hours.
        console.error('update failed', (err as Error).stack ?? err);
      }
    }
    return json({ ok: true });
  }

  if (path === '/api/callback' && request.method === 'POST') return handleCallback(request, env);

  const tgFile = path.match(/^\/tg-file\/([0-9a-f-]{36})$/);
  if (tgFile && request.method === 'GET') return handleTelegramFile(env, url, tgFile[1]);

  if (path === '/admin/setup' && request.method === 'POST') {
    const auth = request.headers.get('Authorization') ?? '';
    if (!env.SHARED_SECRET || !safeEqual(auth, `Bearer ${env.SHARED_SECRET}`)) {
      return apiError(401, 'E_UNAUTHORIZED', 'Bad admin secret.');
    }
    return json({ ...(await setupBot(env, origin)), backend: await backendHealth(env) });
  }

  if (path.startsWith('/api/')) {
    const cors = corsHeaders(env, request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const res = await handleApi(request, env, ctx, url, origin);
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    return res;
  }

  return apiError(404, 'E_NOT_FOUND', 'Not found.');
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      await ensureSchema(env);
      return await route(request, env, ctx);
    } catch (err) {
      console.error('request failed', (err as Error).stack ?? err);
      return apiError(500, 'E_INTERNAL', 'Internal error.');
    }
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    await ensureSchema(env);
    ctx.waitUntil(sweep(env));
  },
} satisfies ExportedHandler<Env>;
