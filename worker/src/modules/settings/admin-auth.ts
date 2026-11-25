import { connectionKey, hmacHex, safeEqual } from '../../shared/crypto';
import { now, type Env } from '../../shared/env';
import { apiError, json } from '../../shared/http';
import { audit, recentAudit } from '../audit';

/** An admin sign-in lasts this long; then the page asks again. */
const TOKEN_TTL = 12 * 3600;
/** At most this many failed sign-ins per connection in 15 minutes. */
const MAX_FAILS = 8;

const passwordOk = (env: Env, given: string) => {
  const password = env.ADMIN_PASSWORD ?? '';
  return password.length >= 8 && safeEqual(given, password); // unset or too short: the admin page stays locked
};
/** Tokens are signed with the password and the shared secret: changing either signs everyone out. */
const tokenKey = (env: Env) => `admin|${env.ADMIN_PASSWORD ?? ''}|${env.SHARED_SECRET ?? ''}`;

async function makeToken(env: Env): Promise<{ token: string; expires_at: number }> {
  const exp = now() + TOKEN_TTL;
  return { token: `adm.${exp}.${await hmacHex(tokenKey(env), `admin:${exp}`)}`, expires_at: exp };
}

async function tokenOk(env: Env, token: string): Promise<boolean> {
  const m = /^adm\.(\d{10})\.([0-9a-f]{64})$/.exec(token);
  if (!m || Number(m[1]) < now() || !(env.ADMIN_PASSWORD ?? '').length) return false;
  return safeEqual(m[2], await hmacHex(tokenKey(env), `admin:${m[1]}`));
}

// --- TOTP (RFC 6238: 6 digits, 30-second steps, HMAC-SHA1), with WebCrypto -------------------

function base32(secret: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = secret.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of clean) {
    value = (value << 5) | alphabet.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

async function totpAt(secret: Uint8Array, step: number): Promise<string> {
  const counter = new Uint8Array(8);
  let n = step;
  for (let i = 7; i >= 0; i--) (counter[i] = n & 0xff), (n = Math.floor(n / 256));
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, counter));
  const offset = mac[19] & 0xf;
  const code = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(code % 1_000_000).padStart(6, '0');
}

/** The code now, or 30 seconds before or after (phone clocks drift). */
export async function totpOk(secretBase32: string, code: string): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false;
  const secret = base32(secretBase32);
  if (secret.length < 10) return false;
  const step = Math.floor(Date.now() / 30_000);
  for (const s of [step - 1, step, step + 1]) if (safeEqual(await totpAt(secret, s), code)) return true;
  return false;
}

// --- Who is the admin ---------------------------------------------------------------------------

/**
 * True when the request carries a valid admin sign-in (Authorization: Bearer <token> from
 * /api/admin/login). Without two-step sign-in set up, the password itself is still accepted.
 */
export async function isAdmin(request: Request, env: Env): Promise<boolean> {
  const given = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!given) return false;
  if (given.startsWith('adm.')) return tokenOk(env, given);
  return !env.ADMIN_TOTP_SECRET && passwordOk(env, given);
}

/**
 * POST /api/admin/login (Authorization: Bearer <password>, body {code}): the password, and the
 * authenticator code when two-step sign-in is on. Gives a sign-in token for 12 hours. Every try
 * is in the audit log; too many failures from one connection are refused for a while.
 */
export async function handleAdminLogin(request: Request, env: Env): Promise<Response> {
  if (!env.ADMIN_PASSWORD) return apiError(503, 'E_ADMIN_DISABLED', 'Set the ADMIN_PASSWORD secret to enable this page.');
  const conn = await connectionKey(env.SHARED_SECRET, request);
  if ((await recentAudit(env, 'admin.login_failed', 900, conn)) >= MAX_FAILS) {
    return apiError(429, 'E_SLOW_DOWN', 'Too many failed sign-ins. Try again in 15 minutes.');
  }
  const given = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const body = (await request.json().catch(() => null)) as { code?: unknown } | null;
  const code = String(body?.code ?? '').replace(/\s/g, '');
  const twoStep = Boolean(env.ADMIN_TOTP_SECRET);
  if (!passwordOk(env, given)) {
    await audit(env, { actor: 'admin', action: 'admin.login_failed', detail: 'password', conn });
    return apiError(401, 'E_UNAUTHORIZED', 'Wrong password.');
  }
  if (twoStep && !code) return apiError(401, 'E_2FA_REQUIRED', 'Enter the 6-digit code from your authenticator app.');
  if (twoStep && !(await totpOk(env.ADMIN_TOTP_SECRET!, code))) {
    await audit(env, { actor: 'admin', action: 'admin.login_failed', detail: 'code', conn });
    return apiError(401, 'E_2FA_WRONG', 'That code is not right. Use the newest one in your app.');
  }
  await audit(env, { actor: 'admin', action: 'admin.login', detail: twoStep ? 'password + code' : 'password', conn });
  return json({ ok: true, two_factor: twoStep, ...(await makeToken(env)) });
}
