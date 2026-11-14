import type { Env } from '../../shared/env';
import { UUID, apiError, json } from '../../shared/http';
import { LANGUAGES, isTargetLang } from '../../shared/languages';
import { parseVideoUrl } from '../../shared/urls';
import {
  backendHealth,
  cancelJob,
  createJob,
  dispatch,
  fileLink,
  getJob,
  listJobs,
  maxPerHour,
  refreshJob,
  startUploadedJob,
  uploadLink,
  type JobRow,
} from '../jobs';

const OUTPUT_LINK_TTL = 6 * 3600;

const maxUploadMb = (env: Env) => Number(env.MAX_UPLOAD_MB) || 500;

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

export interface ApiContext {
  /** Public origin of the Worker, for callback and file-relay URLs. */
  origin: string;
  /** Resolves the bot's @username for /api/config (provided by the base). */
  botUsername: () => Promise<string | null>;
}

async function route(request: Request, env: Env, ctx: ExecutionContext, url: URL, api: ApiContext): Promise<Response> {
  const path = url.pathname;
  const method = request.method;

  if (path === '/api/health' && method === 'GET') {
    return json({ status: 'ok', backend: await backendHealth(env) });
  }

  if (path === '/api/config' && method === 'GET') {
    return json({
      bot_username: await api.botUsername(),
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
      origin: api.origin,
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
    // The Space's own progress reports are unreliable, so a poll asks it directly when stale.
    if (!match[2] && method === 'GET') return json(await publicJob(env, await refreshJob(env, job)));

    if (match[2] && method === 'POST') {
      const body = (await request.json().catch(() => null)) as Record<string, any> | null;
      if (job.owner !== `web:${body?.client_id}`) return apiError(403, 'E_FORBIDDEN', 'This job belongs to someone else.');
      if (match[2] === '/start') {
        if (job.status !== 'awaiting_upload') return json(await publicJob(env, job));
        // Unstarted uploads are not counted against the quota, so it is checked now.
        const started = await startUploadedJob(env, job);
        if (!started.job) return apiError(429, 'E_RATE_LIMITED', 'You reached the limit for now. Try again later.');
        ctx.waitUntil(dispatch(env, started.job));
        return json(await publicJob(env, started.job));
      }
      await cancelJob(env, job);
      return json(await publicJob(env, (await getJob(env, job.id)) ?? job));
    }
  }

  return apiError(404, 'E_NOT_FOUND', 'Not found.');
}

/** The website's JSON API under /api/*, with CORS. */
export async function handleApi(request: Request, env: Env, ctx: ExecutionContext, api: ApiContext): Promise<Response> {
  const cors = corsHeaders(env, request);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const res = await route(request, env, ctx, new URL(request.url), api);
  for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
  return res;
}
