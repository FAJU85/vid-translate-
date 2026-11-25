/**
 * Base: the Worker's entry point. It only routes requests to bricks and wires them together;
 * the work lives in ./modules. See ARCHITECTURE.md.
 */
import { safeEqual } from './shared/crypto';
import { ensureSchema } from './shared/db';
import type { Env } from './shared/env';
import { apiError, json } from './shared/http';
import {
  JOBS_COLUMNS,
  JOBS_SCHEMA,
  backendHealth,
  handleBackendCallback,
  registerJobListener,
  registerDownloadPlanner,
  registerMemoryProvider,
  registerOutroChooser,
  registerSourceFetcher,
  sweep,
} from './modules/jobs';
import {
  CHATS_COLUMNS,
  CHATS_SCHEMA,
  ensureWebhookUpdates,
  fetchTelegramFile,
  getBotUsername,
  handleWebhook,
  setupBot,
  telegramJobListener,
} from './modules/telegram';
import { ADMIN_AUTH_SCHEMA, SETTINGS_SCHEMA, handlePrivacyPage, handleTermsPage } from './modules/settings';
import { ACCOUNTS_COLUMNS, ACCOUNTS_SCHEMA, PAYMENTS_SCHEMA, billingListener, chooseOutro, handleStripeWebhook } from './modules/accounts';
import { SHARES_COLUMNS, SHARES_SCHEMA, SHORT_PATH, handleSharePage, registerCreatorLookup, registerPostListener, sharesJobListener, sweepShares } from './modules/shares';
import { PROFILE_PATH, SOCIAL_SCHEMA, creatorFor, handleProfilePage, handleSeo, notifyPost, sweepNotifications } from './modules/social';
import { FEEDBACK_SCHEMA, sweepFeedback } from './modules/feedback';
import { AUDIT_SCHEMA, sweepAudit } from './modules/audit';
import { FEATURES_SCHEMA, withFeatures } from './modules/features';
import { LEARNING_SCHEMA, RATINGS_SCHEMA, SITES_SCHEMA, downloadPlanFor, memoryFor, sitesJobListener } from './modules/learning';
import { handleApi } from './modules/web-api';

// A finished video gets its public page first, so Telegram's message can carry the link.
registerJobListener(sharesJobListener);
// Telegram follows job progress through the jobs brick's listener port, and supplies the files
// users send to the bot through its source port.
registerJobListener(telegramJobListener);
// Credits follow jobs the same way: refunds when a job fails, the real cost once its length is known.
registerJobListener(billingListener);
registerSourceFetcher('telegram', fetchTelegramFile);
registerOutroChooser(chooseOutro);
// A video's page names its creator's @handle (social brick).
registerCreatorLookup(creatorFor);
registerPostListener(notifyPost);
// The translation memory (learning brick) goes with every job.
registerMemoryProvider(memoryFor);
// ...and the download methods that work best for a link's site, learned from every download.
registerDownloadPlanner(downloadPlanFor);
registerJobListener(sitesJobListener);

const SCHEMA = [...JOBS_SCHEMA, ...CHATS_SCHEMA, ...SETTINGS_SCHEMA, ...ACCOUNTS_SCHEMA, ...PAYMENTS_SCHEMA, ...SHARES_SCHEMA, ...LEARNING_SCHEMA, ...SITES_SCHEMA, ...RATINGS_SCHEMA, ...SOCIAL_SCHEMA, ...FEEDBACK_SCHEMA, ...AUDIT_SCHEMA, ...ADMIN_AUTH_SCHEMA, ...FEATURES_SCHEMA];
const ADDED_COLUMNS = [...JOBS_COLUMNS, ...CHATS_COLUMNS, ...ACCOUNTS_COLUMNS, ...SHARES_COLUMNS];

async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const origin = (env.PUBLIC_URL || url.origin).replace(/\/$/, '');
  const path = url.pathname;
  const method = request.method;

  // The website is served from ./web/dist by the assets binding; this is only reached without it.
  if (path === '/' && !env.ASSETS) return json({ service: 'tarjimvideo-worker', status: 'ok' });

  if (path === '/telegram/webhook' && method === 'POST') return handleWebhook(request, env, ctx, origin);

  if (path === '/api/callback' && method === 'POST') return handleBackendCallback(request, env);

  // Stripe's payment notices (signed): no CORS, answered before the website's API.
  if (path === '/api/stripe/webhook' && method === 'POST') return handleStripeWebhook(env, request);

  if (path === '/admin/setup' && method === 'POST') {
    const auth = request.headers.get('Authorization') ?? '';
    if (!env.SHARED_SECRET || !safeEqual(auth, `Bearer ${env.SHARED_SECRET}`)) {
      return apiError(401, 'E_UNAUTHORIZED', 'Bad admin secret.');
    }
    return json({ ...(await setupBot(env, origin)), backend: await backendHealth(env) });
  }

  // A shared video's public page (/<id>) and its files (/v/<id>/...).
  if (path.startsWith('/v/') || SHORT_PATH.test(path)) {
    return (await handleSharePage(request, env, path, origin)) ?? apiError(404, 'E_NOT_FOUND', 'Not found.');
  }
  // The terms of use, with the takedown address (/terms).
  if (path === '/terms') return (await handleTermsPage(request, env, path)) ?? apiError(404, 'E_NOT_FOUND', 'Not found.');
  // The privacy policy (/privacy).
  if (path === '/privacy') return (await handlePrivacyPage(request, env, path)) ?? apiError(404, 'E_NOT_FOUND', 'Not found.');
  // For search engines: what may be crawled, and every posted video and profile.
  if (path === '/robots.txt' || path === '/sitemap.xml' || /^\/google[0-9a-z]+\.html$/.test(path)) return (await handleSeo(request, env, path, origin)) ?? apiError(404, 'E_NOT_FOUND', 'Not found.');
  // A creator's profile (/@handle).
  if (PROFILE_PATH.test(path)) return (await handleProfilePage(request, env, path, origin)) ?? apiError(404, 'E_NOT_FOUND', 'Not found.');

  if (path.startsWith('/api/')) return handleApi(request, env, ctx, { origin, botUsername: () => getBotUsername(env) });

  // Every other page is the website (its files are served before the Worker runs; see wrangler.toml).
  if (env.ASSETS) return env.ASSETS.fetch(request);
  return apiError(404, 'E_NOT_FOUND', 'Not found.');
}

/**
 * Security headers on everything the Worker answers (the website's own files get the same from
 * web/public/_headers): HTTPS only from now on, no sniffing, no framing, a short referrer, and no
 * camera, microphone or location.
 */
const SECURITY_HEADERS: Record<string, string> = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "frame-ancestors 'none'",
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};
function secured(res: Response): Response {
  if (res.status === 101) return res;
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) if (!out.headers.has(k)) out.headers.set(k, v);
  return out;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Plain HTTP is sent to HTTPS (never on a local development address).
    const url = new URL(request.url);
    if (url.protocol === 'http:' && !/^(localhost|127\.0\.0\.1)$/.test(url.hostname)) {
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 301);
    }
    try {
      await ensureSchema(env, SCHEMA, ADDED_COLUMNS);
      // The admin page's feature switches and keys, filled into the settings this request runs with.
      return secured(await route(request, await withFeatures(env), ctx));
    } catch (err) {
      console.error('request failed', (err as Error).stack ?? err);
      return secured(apiError(500, 'E_INTERNAL', 'Internal error.'));
    }
  },

  async scheduled(_event: ScheduledController, serverEnv: Env, ctx: ExecutionContext): Promise<void> {
    await ensureSchema(serverEnv, SCHEMA, ADDED_COLUMNS);
    const env = await withFeatures(serverEnv);
    ctx.waitUntil(sweep(env));
    ctx.waitUntil(ensureWebhookUpdates(env));
    ctx.waitUntil(sweepShares(env));
    ctx.waitUntil(sweepNotifications(env));
    ctx.waitUntil(sweepFeedback(env));
    ctx.waitUntil(sweepAudit(env));
  },
} satisfies ExportedHandler<Env>;
