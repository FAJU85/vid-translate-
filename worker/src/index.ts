/**
 * Base: the Worker's entry point. It only routes requests to bricks and wires them together;
 * the work lives in ./modules. See ARCHITECTURE.md.
 */
import { safeEqual } from './shared/crypto';
import { ensureSchema } from './shared/db';
import type { Env } from './shared/env';
import { apiError, json } from './shared/http';
import { JOBS_SCHEMA, backendHealth, handleBackendCallback, registerJobListener, sweep } from './modules/jobs';
import { CHATS_SCHEMA, getBotUsername, handleWebhook, serveTelegramFile, setupBot, telegramJobListener } from './modules/telegram';
import { handleApi } from './modules/web-api';

// Telegram follows job progress through the jobs brick's listener port.
registerJobListener(telegramJobListener);

const SCHEMA = [...JOBS_SCHEMA, ...CHATS_SCHEMA];

async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const origin = (env.PUBLIC_URL || url.origin).replace(/\/$/, '');
  const path = url.pathname;
  const method = request.method;

  if (path === '/') return json({ service: 'tarjimvideo-worker', status: 'ok' });

  if (path === '/telegram/webhook' && method === 'POST') return handleWebhook(request, env, ctx, origin);

  if (path === '/api/callback' && method === 'POST') return handleBackendCallback(request, env);

  const tgFile = path.match(/^\/tg-file\/([0-9a-f-]{36})$/);
  if (tgFile && method === 'GET') return serveTelegramFile(env, url, tgFile[1]);

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
      await ensureSchema(env, SCHEMA);
      return await route(request, env, ctx);
    } catch (err) {
      console.error('request failed', (err as Error).stack ?? err);
      return apiError(500, 'E_INTERNAL', 'Internal error.');
    }
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    await ensureSchema(env, SCHEMA);
    ctx.waitUntil(sweep(env));
  },
} satisfies ExportedHandler<Env>;
