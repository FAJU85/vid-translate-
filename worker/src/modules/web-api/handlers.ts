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
  jobStats,
  jobsFor,
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
import { ASPECTS, handleMemoryAdmin, learnFromEdit, rate, ratingsOf, siteStatus, type Aspect } from '../learning';
import { handleShares, listShares, publicShare, shareTotals, shareUrl } from '../shares';
import { handleAdminLogin, handleAdminSettings, isAdmin, publicSettings, serveLogo } from '../settings';
import {
  FREE_MAX_VIDEO_SECONDS,
  SECONDS_PER_CREDIT,
  accountForWeb,
  signedInAccount,
  chargeJob,
  checkJob,
  creditsEnabled,
  handleAccounts,
  releaseJob,
  type Refusal,
} from '../accounts';

const OUTPUT_LINK_TTL = 6 * 3600;
// Counted from when the job was created, which is before the Space made the job's folder (deleted after 24 hours).
const RERENDER_WINDOW = 23 * 3600;
const MAX_RENDER_CUES = 5000;

const maxUploadMb = (env: Env) => Number(env.MAX_UPLOAD_MB) || 500;

const credits = (seconds: number) => (seconds / SECONDS_PER_CREDIT).toFixed(2);

const REFUSAL: Record<Refusal, { status: number; code: string; message: (need: number, have: number) => string }> = {
  credits: {
    status: 402,
    code: 'E_NO_CREDITS',
    message: (need, have) => `This video needs ${credits(need)} credits and you have ${credits(have)}.`,
  },
  free_limit: {
    status: 402,
    code: 'E_FREE_LIMIT',
    message: () => `Free videos can be up to ${FREE_MAX_VIDEO_SECONDS} seconds long. Get credits to translate longer videos.`,
  },
  dub_paid: {
    status: 402,
    code: 'E_DUB_PAID',
    message: () => 'Dubbing needs credits (your free preview is used or the video is longer than 15 seconds).',
  },
};

/** 402 with why, what a video needs and what the account has, so the website can offer more credits. */
const refused = (reason: Refusal, need: number, have: number) =>
  json({ error_code: REFUSAL[reason].code, message: REFUSAL[reason].message(need, have), need_seconds: need, have_seconds: have }, REFUSAL[reason].status);

/** A video's length as the browser read it (seconds), when it sent one. */
const durationHint = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && n < 24 * 3600 ? n : null;
};

/** Before creating a job: refuse at once when it could not start (credits, free limits). */
async function creditCheck(env: Env, request: Request, clientId: string, mode: string, hint: number | null): Promise<Response | null> {
  if (!creditsEnabled(env)) return null;
  const account = await accountForWeb(env, request, clientId);
  const result = await checkJob(env, account, mode, hint);
  return result.ok ? null : refused(result.reason, result.need, result.have);
}

/** Set the job's credits aside; if that fails (spent meanwhile), stop the job and answer 402. */
async function charge(env: Env, request: Request, clientId: string, job: JobRow, hint: number | null): Promise<Response | null> {
  if (!creditsEnabled(env)) return null;
  try {
    const account = await accountForWeb(env, request, clientId);
    const result = await chargeJob(env, account, job, hint);
    if (result.ok) return null;
    await stopJob(env, job, REFUSAL[result.reason].code, REFUSAL[result.reason].message(result.need, result.have));
    return refused(result.reason, result.need, result.have);
  } catch (err) {
    // Never leave a job ready to run without its credits set aside.
    console.error('charging failed for', job.id, (err as Error).stack ?? err);
    await stopJob(env, job, 'E_INTERNAL', 'Credits could not be set aside.');
    return apiError(500, 'E_INTERNAL', 'Something went wrong. Please try again.');
  }
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
    // The video's public page (shares brick), once it is done.
    share_url: job.status === 'done' ? await shareUrl(env, job) : null,
    // 👍 / 👎 given to it: { translation: 1, voice: -1 } (learning brick).
    ratings: job.status === 'done' ? await ratingsOf(env, job.id) : {},
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

  // Your dashboard: what you translated (website and bot), its links and your numbers.
  if (path === '/api/dashboard' && method === 'GET') {
    const clientId = url.searchParams.get('client_id') ?? '';
    const owner = UUID.test(clientId) ? `web:${clientId}` : null;
    const account = await signedInAccount(env, request);
    const who = { accountId: account?.id ?? null, owner };
    const [jobs, stats, shares, totals] = await Promise.all([
      jobsFor(env, who, 100),
      jobStats(env, who),
      listShares(env, who, 200),
      shareTotals(env, who),
    ]);
    const byJob = new Map(shares.map((s) => [s.job_id, publicShare(s, api.origin)]));
    const fresh = (j: JobRow) => j.status === 'done' && Date.now() / 1000 - j.created_at < 24 * 3600;
    return json({
      signed_in: Boolean(account),
      stats: { ...stats, share_views: totals.views, shared_videos: totals.shared },
      videos: jobs.map((j) => ({
        job_id: j.id,
        title: j.title,
        channel: j.channel,
        status: j.status,
        mode: j.mode,
        src_lang: j.detected_lang ?? j.src_lang,
        tgt_lang: j.tgt_lang,
        duration: j.duration,
        created_at: j.created_at,
        rerender: j.source_kind === 'rerender',
        // Its files are on the Space for a day: the website can open the result.
        can_open: fresh(j) && j.channel === 'web',
        share: byJob.get(j.id) ?? null,
      })),
    });
  }

  // Your shared videos (list, delete): by account, or by this browser's jobs.
  if (path === '/api/shares' || path.startsWith('/api/shares/')) {
    const clientId = url.searchParams.get('client_id') ?? '';
    const owner = UUID.test(clientId) ? `web:${clientId}` : null;
    // The signed-in account whether or not credits are on (as the dashboard shows it), else this
    // browser's guest account when credits are on (its links are charged to it).
    const account = (await signedInAccount(env, request)) ?? (creditsEnabled(env) && owner ? await accountForWeb(env, request, clientId) : null);
    const shares = await handleShares(request, env, path, api.origin, { accountId: account?.id ?? null, owner });
    if (shares) return shares;
  }

  if (path === '/api/health' && method === 'GET') {
    return json({ status: 'ok', backend: await backendHealth(env) });
  }

  // How downloads from a link's site are going (learned from every download), for a hint by the link box.
  if (path === '/api/site-status' && method === 'GET') {
    const link = url.searchParams.get('url') ?? '';
    if (!/^https?:\/\//i.test(link) || link.length > 2000) return apiError(400, 'E_BAD_REQUEST', 'Give an http(s) link.');
    return json(await siteStatus(env, link));
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
  // What KAVOX learned (translation memory from corrections, download methods per site), to review.
  if (path === '/api/admin/memory' || path.startsWith('/api/admin/memory/') || path === '/api/admin/sites' || path === '/api/admin/ratings') {
    if (!isAdmin(request, env)) return apiError(401, 'E_UNAUTHORIZED', 'Admin password required.');
    const memory = await handleMemoryAdmin(request, env, path);
    if (memory) return memory;
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
      accountId: (await signedInAccount(env, request))?.id ?? null,
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

  const match = path.match(/^\/api\/jobs\/([0-9a-f-]{36})(\/start|\/cancel|\/retry|\/render|\/corrections|\/rating)?$/);
  if (match) {
    const job = await getJob(env, match[1]);
    if (!job) return apiError(404, 'E_JOB_NOT_FOUND', 'Job not found.');
    // The Space's own progress reports are unreliable, so a poll asks it directly when stale.
    if (!match[2] && method === 'GET') return json(await publicJob(env, await refreshJob(env, job)));

    if (match[2] && method === 'POST') {
      const body = (await request.json().catch(() => null)) as Record<string, any> | null;
      // The browser that made it, or the signed-in account it belongs to (from another browser).
      const mine =
        job.owner === `web:${body?.client_id}` || (job.account_id !== null && job.account_id === (await signedInAccount(env, request))?.id);
      if (!mine) return apiError(403, 'E_FORBIDDEN', 'This job belongs to someone else.');
      // Corrections to the translation teach the translation memory (signed-in accounts only:
      // one vote per person, so nobody can teach a rule alone).
      if (match[2] === '/corrections') {
        const parsed = parseCues(body?.cues);
        if ('error' in parsed) return apiError(400, 'E_BAD_REQUEST', parsed.error);
        const account = await signedInAccount(env, request);
        const learned = await learnFromEdit(env, job, parsed.cues, account?.id ?? null);
        return json({ learned, signed_in: Boolean(account) });
      }
      // 👍 / 👎 on the translation or the voice: shows the admin where KAVOX needs correcting.
      if (match[2] === '/rating') {
        const aspect = String(body?.aspect ?? '') as Aspect;
        const value = body?.value === 1 || body?.value === -1 ? (body.value as 1 | -1) : null;
        if (!ASPECTS.includes(aspect) || value === null) return apiError(400, 'E_BAD_REQUEST', 'Rate the translation or the voice, 1 or -1.');
        if (!(await rate(env, job, aspect, value))) return apiError(400, 'E_BAD_REQUEST', 'This video cannot be rated that way.');
        return json({ ratings: await ratingsOf(env, job.id) });
      }
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
          // The same account as the video it re-renders, so its ending follows a chain of edits.
          accountId: job.account_id ?? (await signedInAccount(env, request))?.id ?? null,
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
        // Credits first: the job only becomes ready to run once they are set aside.
        const unpaid = await charge(env, request, body!.client_id, job, durationHint(body?.duration));
        if (unpaid) return unpaid;
        // Unstarted uploads are not counted against the quota, so it is checked now.
        const started = await startUploadedJob(env, job);
        if (!started.job) {
          await releaseJob(env, job.id, 'limit reached');
          return apiError(429, 'E_RATE_LIMITED', 'You reached the limit for now. Try again later.');
        }
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
