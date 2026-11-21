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
import { SETTINGS_SCHEMA } from './modules/settings';
import { ACCOUNTS_COLUMNS, ACCOUNTS_SCHEMA, PAYMENTS_SCHEMA, billingListener, handleStripeWebhook } from './modules/accounts';
import { handleApi } from './modules/web-api';

// Telegram follows job progress through the jobs brick's listener port, and supplies the files
// users send to the bot through its source port.
registerJobListener(telegramJobListener);
// Credits follow jobs the same way: refunds when a job fails, the real cost once its length is known.
registerJobListener(billingListener);
registerSourceFetcher('telegram', fetchTelegramFile);

const SCHEMA = [...JOBS_SCHEMA, ...CHATS_SCHEMA, ...SETTINGS_SCHEMA, ...ACCOUNTS_SCHEMA, ...PAYMENTS_SCHEMA];
const ADDED_COLUMNS = [...JOBS_COLUMNS, ...CHATS_COLUMNS, ...ACCOUNTS_COLUMNS];

async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const origin = (env.PUBLIC_URL || url.origin).replace(/\/$/, '');
  const path = url.pathname;
  const method = request.method;

  // The website is served from ./web/dist by the assets binding; this is only reached without it.
  if (path === '/') return json({ service: 'tarjimvideo-worker', status: 'ok' });

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

  if (path.startsWith('/api/')) return handleApi(request, env, ctx, { origin, botUsername: () => getBotUsername(env) });

  return apiError(404, 'E_NOT_FOUND', 'Not found.');
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      await ensureSchema(env, SCHEMA, ADDED_COLUMNS);
      return await route(request, env, ctx);
    } catch (err) {
      console.error('request failed', (err as Error).stack ?? err);
      return apiError(500, 'E_INTERNAL', 'Internal error.');
    }
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    await ensureSchema(env, SCHEMA, ADDED_COLUMNS);
    ctx.waitUntil(sweep(env));
    ctx.waitUntil(ensureWebhookUpdates(env));
  },
} satisfies ExportedHandler<Env>;
