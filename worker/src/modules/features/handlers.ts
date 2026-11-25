import { connectionKey } from '../../shared/crypto';
import type { Env } from '../../shared/env';
import { apiError, json } from '../../shared/http';
import { audit } from '../audit';
import { issueAdminToken, publicOrigin, publicSettings, totpOk } from '../settings';
import { getBotUsername, setupBot } from '../telegram';
import { forgetFeatures, readFeatures, withFeatures, writeFeature, type FieldName } from './store';

/** Where a value comes from: the server (Worker settings, wins), this page, or nowhere yet. */
type Source = 'server' | 'panel' | null;

const last4 = (v: string | undefined) => (v ? `…${v.slice(-4)}` : null);

/** A new two-step secret: 20 random bytes in base32, as authenticator apps expect. */
function newTotpSecret(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of crypto.getRandomValues(new Uint8Array(20))) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) (out += alphabet[(value >>> (bits - 5)) & 31]), (bits -= 5);
  }
  return bits > 0 ? out + alphabet[(value << (5 - bits)) & 31] : out;
}

/**
 * GET /api/admin/features: what is on, what is ready, and what each feature still needs.
 * POST {action, …}: turn a feature on or off, save a key, set up two-step sign-in, refresh the bot.
 * The caller has checked the admin. `env` is the server's own settings; `origin` the Worker's.
 */
export async function handleFeatures(request: Request, env: Env, path: string, origin: string): Promise<Response | null> {
  if (path !== '/api/admin/features') return null;
  const server = env.SERVER_ENV ?? env;
  const saved = await readFeatures(server);
  const live = await withFeatures(server);
  const source = (name: FieldName): Source => (server[name as keyof Env] ? 'server' : saved[name] ? 'panel' : null);
  const base = await publicOrigin(server, origin);

  if (request.method === 'GET') {
    const site = await publicSettings(server).catch(() => null);
    return json({
      two_step: { on: Boolean(live.ADMIN_TOTP_SECRET), source: source('ADMIN_TOTP_SECRET') },
      credits: { on: ['1', 'true', 'yes'].includes(String(live.CREDITS_ENABLED ?? '').toLowerCase()), source: source('CREDITS_ENABLED') },
      limits: {
        max_jobs_per_hour: Number(live.MAX_JOBS_PER_HOUR) || 5,
        max_upload_mb: Number(live.MAX_UPLOAD_MB) || 500,
        source: source('MAX_JOBS_PER_HOUR') ?? source('MAX_UPLOAD_MB'),
      },
      email: {
        ready: Boolean(live.RESEND_API_KEY && live.EMAIL_FROM),
        from: live.EMAIL_FROM ?? '',
        key: last4(live.RESEND_API_KEY),
        source: source('RESEND_API_KEY'),
      },
      google: {
        ready: Boolean(live.GOOGLE_CLIENT_ID && live.GOOGLE_CLIENT_SECRET),
        client_id: live.GOOGLE_CLIENT_ID ?? '',
        secret: last4(live.GOOGLE_CLIENT_SECRET),
        redirect_uri: `${base}/api/auth/google/callback`,
        source: source('GOOGLE_CLIENT_SECRET'),
      },
      stripe: {
        ready: Boolean(live.STRIPE_SECRET_KEY && live.STRIPE_WEBHOOK_SECRET),
        key: last4(live.STRIPE_SECRET_KEY),
        webhook_secret: last4(live.STRIPE_WEBHOOK_SECRET),
        webhook_url: `${origin}/api/stripe/webhook`,
        source: source('STRIPE_SECRET_KEY'),
      },
      telegram: { bot: await getBotUsername(live).catch(() => null) },
      domain: { public_domain: site?.public_domain || '', https_note: Boolean(site?.public_domain) },
    });
  }
  if (request.method !== 'POST') return null;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = String(body?.action ?? '');
  const conn = await connectionKey(server.SHARED_SECRET, request);
  const done = async (what: string, extra: Record<string, unknown> = {}) => {
    forgetFeatures();
    await audit(server, { actor: 'admin', action: 'admin.feature', target: what, conn });
    return json({ ok: true, ...extra });
  };

  // --- Two-step sign-in: start (a secret to scan), confirm (a code from it), or turn off ---
  if (action === '2fa_start') {
    if (server.ADMIN_TOTP_SECRET) return apiError(409, 'E_SET_ON_SERVER', 'Two-step sign-in is set on the server; change it there.');
    const secret = newTotpSecret();
    await writeFeature(server, 'ADMIN_TOTP_PENDING', secret);
    const label = encodeURIComponent(`${new URL(base).host} admin`);
    return json({ secret, uri: `otpauth://totp/${label}?secret=${secret}&issuer=KAVOX&algorithm=SHA1&digits=6&period=30` });
  }
  if (action === '2fa_confirm') {
    const pending = saved.ADMIN_TOTP_PENDING;
    if (!pending) return apiError(400, 'E_BAD_REQUEST', 'Start the setup first.');
    if (!(await totpOk(pending, String(body?.code ?? '').replace(/\s/g, '')))) {
      return apiError(400, 'E_2FA_WRONG', 'That code is not right. Use the newest one in your app.');
    }
    await writeFeature(server, 'ADMIN_TOTP_SECRET', pending);
    await writeFeature(server, 'ADMIN_TOTP_PENDING', '');
    forgetFeatures();
    // Turning it on ends every earlier sign-in, this one too: here is a new one.
    const { token } = await issueAdminToken(await withFeatures(server));
    return done('two_step:on', { token });
  }
  if (action === '2fa_off') {
    if (server.ADMIN_TOTP_SECRET) return apiError(409, 'E_SET_ON_SERVER', 'Two-step sign-in is set on the server; remove it there.');
    const active = saved.ADMIN_TOTP_SECRET;
    if (!active) return apiError(400, 'E_BAD_REQUEST', 'Two-step sign-in is already off.');
    if (!(await totpOk(active, String(body?.code ?? '').replace(/\s/g, '')))) {
      return apiError(400, 'E_2FA_WRONG', 'Enter the current code from your app to turn it off.');
    }
    await writeFeature(server, 'ADMIN_TOTP_SECRET', '');
    forgetFeatures();
    const { token } = await issueAdminToken(await withFeatures(server));
    return done('two_step:off', { token });
  }

  // --- The Telegram bot's webhook and command menu, without the command line ---
  if (action === 'bot_setup') {
    const result = await setupBot(live, origin).catch((err) => ({ error: String((err as Error).message ?? err) }));
    await audit(server, { actor: 'admin', action: 'admin.feature', target: 'telegram:setup', conn });
    return json({ ok: !('error' in result), result });
  }

  // --- A switch, a number or a key ---
  if (action === 'set') {
    const name = String(body?.name ?? '') as FieldName;
    const settable: FieldName[] = ['CREDITS_ENABLED', 'MAX_JOBS_PER_HOUR', 'MAX_UPLOAD_MB', 'RESEND_API_KEY', 'EMAIL_FROM', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'];
    if (!settable.includes(name)) return apiError(400, 'E_BAD_REQUEST', 'That cannot be set here.');
    if (server[name as keyof Env]) return apiError(409, 'E_SET_ON_SERVER', 'This is set on the server; change it there.');
    let value = String(body?.value ?? '').trim();
    if (name === 'CREDITS_ENABLED') value = value === '1' ? '1' : '';
    if (name === 'MAX_JOBS_PER_HOUR' || name === 'MAX_UPLOAD_MB') {
      const n = Number(value);
      const max = name === 'MAX_UPLOAD_MB' ? 2000 : 1000;
      if (value && (!Number.isInteger(n) || n < 1 || n > max)) return apiError(400, 'E_BAD_REQUEST', `Give a whole number from 1 to ${max}.`);
    }
    if (name === 'EMAIL_FROM' && value && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$|^.+<[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>$/.test(value)) {
      return apiError(400, 'E_BAD_REQUEST', 'The sender must look like name@your-domain.com or KAVOX <name@your-domain.com>.');
    }
    if (value.length > 500) return apiError(400, 'E_BAD_REQUEST', 'That is too long.');
    await writeFeature(server, name, value);
    return done(`${name}:${value ? 'set' : 'cleared'}`);
  }
  return apiError(400, 'E_BAD_REQUEST', 'Unknown action.');
}
