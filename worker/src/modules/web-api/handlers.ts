import type { Env } from '../../shared/env';
import { UUID, apiError, json } from '../../shared/http';
import { LANGUAGES, isTargetLang } from '../../shared/languages';
import { isYouTubeUrl, parseVideoUrl } from '../../shared/urls';
import {
  backendHealth,
  canDub,
  canRetry,
  checkLimits,
  cancelJob,
  createJob,
  dispatch,
  fileLink,
  getJob,
  listJobs,
  maxPerHour,
  parseSubtitleStyle,
  refreshJob,
  retryJob,
  startUploadedJob,
  stopJob,
  uploadLink,
  type JobRow,
} from '../jobs';
import { handleAdminJobs } from './admin';
import { handleAdminLogin, handleAdminSettings, isAdmin, publicSettings, serveLogo } from '../settings';
import { SECONDS_PER_CREDIT, accountForWeb, balance, chargeJob, creditsEnabled, estimateSeconds, handleAccounts } from '../accounts';

const OUTPUT_LINK_TTL = 6 * 3600;
// Counted from when the job was created, which is before the Space made the job's folder (deleted after 24 hours).
const RERENDER_WINDOW = 23 * 3600;
const MAX_RENDER_CUES = 5000;

const maxUploadMb = (env: Env) => Number(env.MAX_UPLOAD_MB) || 500;

const credits = (seconds: number) => (seconds / SECONDS_PER_CREDIT).toFixed(2);

/** 402 with what a video needs and what the account has, so the website can offer more credits. */
const noCredits = (need: number, have: number) =>
  json(
    {
      error_code: 'E_NO_CREDITS',
      message: `This video needs ${credits(need)} credits and you have ${credits(have)}.`,
      need_seconds: need,
      have_seconds: have,
    },
    402,
  );

/** A video's length as the browser read it (seconds), when it sent one. */
const durationHint = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && n < 24 * 3600 ? n : null;
};

/** Before creating a job: refuse at once when even its estimated cost is more than the balance. */
async function creditCheck(env: Env, request: Request, clientId: string, mode: string, hint: number | null): Promise<Response | null> {
  if (!creditsEnabled(env)) return null;
  const account = await accountForWeb(env, request, clientId);
  const need = estimateSeconds(hint, mode);
  const have = (await balance(env, account.id)).total_seconds;
  return have < need ? noCredits(need, have) : null;
}

/** Set the job's credits aside; if that fails (spent meanwhile), stop the job and answer 402. */
async function charge(env: Env, request: Request, clientId: string, job: JobRow, hint: number | null): Promise<Response | null> {
  if (!creditsEnabled(env)) return null;
  const account = await accountForWeb(env, request, clientId);
  const result = await chargeJob(env, account.id, job, hint);
  if (result.ok) return null;
  await stopJob(env, job, 'E_NO_CREDITS', 'Not enough credits.');
  return noCredits(result.need, result.have);
}

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

const MAX_CUE_CHARS = 500;
// D1 stores at most 2 MB per row: the edited subtitles stay well under that.
const MAX_CUES_BYTES = 1_500_000;

type EditedCue = { start: number; end: number; text: string; translation: string };

/** Edited subtitles from the website: [{start, end, text, translation}], checked; never cut short. */
function parseCues(input: unknown): { cues: EditedCue[] } | { error: string } {
  const unreadable = { error: 'The subtitles could not be read.' };
  if (!Array.isArray(input) || !input.length) return unreadable;
  if (input.length > MAX_RENDER_CUES) return { error: `A video can have at most ${MAX_RENDER_CUES} subtitles.` };
  const cues: EditedCue[] = [];
  for (const [i, raw] of input.entries()) {
    const c = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const start = Number(c.start);
    const end = Number(c.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) return unreadable;
    const text = String(c.text ?? '');
    const translation = String(c.translation ?? '');
    if (text.length > MAX_CUE_CHARS || translation.length > MAX_CUE_CHARS) {
      return { error: `Subtitle ${i + 1} is longer than ${MAX_CUE_CHARS} characters. Shorten it or split it.` };
    }
    cues.push({ start, end, text, translation });
  }
  if (new TextEncoder().encode(JSON.stringify(cues)).length > MAX_CUES_BYTES) {
    return { error: 'The subtitles are too long to render in one go.' };
  }
  return { cues };
}

/** What the website is allowed to see of a job. */
async function publicJob(env: Env, job: JobRow) {
  const names = job.status === 'done' ? (JSON.parse(job.outputs || '{}') as Record<string, string>) : {};
  const base = (job.title ?? 'subtitles').replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 60) || 'subtitles';
  const outputs: Record<string, string> = {};
  for (const [key, name] of Object.entries(names)) {
    const ext = name.split('.').pop();
    const label: Record<string, string> = { original_srt: 'original', bilingual_srt: 'bilingual', transcript: 'transcript', dubbed: `${job.tgt_lang}.dubbed` };
    const download = key === 'cues' ? undefined : `${base}.${label[key] ?? job.tgt_lang}.${ext}`;
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
    queue_position: job.status === 'queued' && job.dispatched ? job.queue_position : job.status === 'running' ? 0 : null,
    eta_seconds: job.status === 'queued' || job.status === 'running' ? job.eta : null,
    can_retry: canRetry(job),
    // The Space keeps the video of a burned-in job with its files (24 hours), for "render with my edits".
    can_rerender: job.status === 'done' && job.mode === 'hard' && 'mp4' in names && Date.now() / 1000 - job.created_at < RERENDER_WINDOW,
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

  const accounts = await handleAccounts(request, env, path, {
    origin: api.origin,
    botUsername: api.botUsername,
    brand: async () => (await publicSettings(env)).name || 'Kavox',
    isAdmin: path.startsWith('/api/admin/') && isAdmin(request, env),
  });
  if (accounts) return accounts;

  if (path === '/api/health' && method === 'GET') {
    return json({ status: 'ok', backend: await backendHealth(env) });
  }

  if (path === '/api/config' && method === 'GET') {
    return json({
      bot_username: await api.botUsername(),
      languages: LANGUAGES.map(({ code, flag, en, ar }) => ({ code, flag, en, ar })),
      max_upload_mb: maxUploadMb(env),
      max_jobs_per_hour: maxPerHour(env),
      site: await publicSettings(env),
    });
  }

  // Settings edited on the website's /admin page (password: the ADMIN_PASSWORD secret).
  if (path === '/api/admin/login' && method === 'POST') return handleAdminLogin(request, env);
  if (path === '/api/admin/settings' && (method === 'GET' || method === 'POST')) return handleAdminSettings(request, env);
  if (path === '/api/logo' && method === 'GET') return serveLogo(env);
  if (path === '/api/admin/jobs' || path === '/api/admin/stats' || path.startsWith('/api/admin/jobs/')) {
    return handleAdminJobs(request, env, ctx, path);
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
    const mode = body.subtitle_mode === 'hard' || body.subtitle_mode === 'dub' ? body.subtitle_mode : 'soft';
    if (mode === 'dub' && !canDub(tgtLang)) {
      return apiError(400, 'E_NO_VOICE', 'Dubbing is not available for this language yet. Choose subtitles instead.');
    }
    const style = mode === 'soft' ? null : parseSubtitleStyle(body.style);
    const hint = durationHint(body.duration ?? body.upload?.duration);
    const refused = await creditCheck(env, request, body.client_id, mode, hint);
    if (refused) return refused;

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
      if (isYouTubeUrl(parsed)) {
        return apiError(400, 'E_YOUTUBE_UNSUPPORTED',
          "YouTube blocks our server, so YouTube links can't be downloaded. Upload the video file instead: if the video is yours, download it from YouTube Studio (Content → ⋮ → Download). Facebook, Instagram and TikTok links work.",
        );
      }
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
      style,
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
    if (sourceKind === 'url') {
      // Uploads are charged when they start (once the file is there); links right away.
      const unpaid = await charge(env, request, body.client_id, job, hint);
      if (unpaid) return unpaid;
      ctx.waitUntil(dispatch(env, job));
    }
    return json(
      { ...(await publicJob(env, job)), ...(sourceKind === 'upload' ? { upload_url: await uploadLink(env, job.id) } : {}) },
      201,
    );
  }

  const match = path.match(/^\/api\/jobs\/([0-9a-f-]{36})(\/start|\/cancel|\/retry|\/render)?$/);
  if (match) {
    const job = await getJob(env, match[1]);
    if (!job) return apiError(404, 'E_JOB_NOT_FOUND', 'Job not found.');
    // The Space's own progress reports are unreliable, so a poll asks it directly when stale.
    if (!match[2] && method === 'GET') return json(await publicJob(env, await refreshJob(env, job)));

    if (match[2] && method === 'POST') {
      const body = (await request.json().catch(() => null)) as Record<string, any> | null;
      if (job.owner !== `web:${body?.client_id}`) return apiError(403, 'E_FORBIDDEN', 'This job belongs to someone else.');
      if (match[2] === '/render') {
        const pub = await publicJob(env, job);
        if (!pub.can_rerender) return apiError(400, 'E_BAD_REQUEST', 'This video can no longer be rendered again. Translate it again.');
        const parsed = parseCues(body?.cues);
        if ('error' in parsed) return apiError(400, 'E_BAD_REQUEST', parsed.error);
        const cues = parsed.cues;
        const style = body?.style ? parseSubtitleStyle(body.style) : job.style ? parseSubtitleStyle(JSON.parse(job.style)) : null;
        const { job: next, error } = await createJob(env, {
          channel: 'web',
          owner: job.owner,
          ip: request.headers.get('CF-Connecting-IP'),
          sourceKind: 'rerender',
          source: job.id,
          title: job.title,
          srcLang: job.detected_lang ?? job.src_lang,
          tgtLang: job.tgt_lang,
          mode: 'hard',
          style,
          cues,
          origin: api.origin,
        });
        if (!next) return apiError(429, 'E_RATE_LIMITED', error === 'busy' ? 'Wait for your other translation to finish.' : 'You reached the limit for now. Try again later.');
        ctx.waitUntil(dispatch(env, next));
        return json(await publicJob(env, next), 201);
      }
      if (match[2] === '/retry') {
        if (!canRetry(job)) return apiError(400, 'E_BAD_REQUEST', 'This translation cannot be retried. Start a new one.');
        const limited = await checkLimits(env, { owner: job.owner, ip: request.headers.get('CF-Connecting-IP'), channel: 'web' });
        if (limited) return apiError(429, 'E_RATE_LIMITED', 'You reached the limit for now. Try again later.');
        const refused = await creditCheck(env, request, body!.client_id, job.mode, job.duration);
        if (refused) return refused;
        const copy = await retryJob(env, job);
        if (!copy) return apiError(400, 'E_BAD_REQUEST', 'This translation cannot be retried. Start a new one.');
        const unpaid = await charge(env, request, body!.client_id, copy, job.duration);
        if (unpaid) return unpaid;
        ctx.waitUntil(dispatch(env, copy));
        return json(await publicJob(env, copy), 201);
      }
      if (match[2] === '/start') {
        if (job.status !== 'awaiting_upload') return json(await publicJob(env, job));
        // Unstarted uploads are not counted against the quota, so it is checked now.
        const started = await startUploadedJob(env, job);
        if (!started.job) return apiError(429, 'E_RATE_LIMITED', 'You reached the limit for now. Try again later.');
        const unpaid = await charge(env, request, body!.client_id, started.job, durationHint(body?.duration));
        if (unpaid) return unpaid;
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
