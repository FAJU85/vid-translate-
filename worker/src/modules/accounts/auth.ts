import { now, type Env } from '../../shared/env';
import { accountFor, getAccount, type Account, type Identity } from './store';

const SESSION_COOKIE = 'kavox_session';
const STATE_COOKIE = 'kavox_oauth_state';
const SESSION_TTL = 30 * 86400;
const CODE_TTL = 15 * 60;
const MAX_EMAILS_PER_HOUR = 5; // sign-in links per address (and per IP), against misuse

const encoder = new TextEncoder();

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A random URL-safe token (base64url of 24 random bytes). */
export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function cookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie') ?? '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) {
      try {
        return decodeURIComponent(v.join('='));
      } catch {
        return null; // a malformed cookie counts as none
      }
    }
  }
  return null;
}

const secureFlag = (request: Request) => (new URL(request.url).protocol === 'https:' ? '; Secure' : '');

export const setCookie = (request: Request, name: string, value: string, maxAge: number) =>
  `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureFlag(request)}`;

// ------------------------------------------------------------------ sessions

/** The signed-in account of a request, or null. */
export async function currentAccount(env: Env, request: Request): Promise<Account | null> {
  const token = cookie(request, SESSION_COOKIE);
  if (!token) return null;
  const row = await env.DB.prepare('SELECT account_id, expires_at FROM sessions WHERE token_hash = ?')
    .bind(await sha256(token))
    .first<{ account_id: string; expires_at: number }>();
  if (!row || row.expires_at < now()) return null;
  return getAccount(env, row.account_id);
}

/** Start a session for an account; returns the Set-Cookie header value. */
export async function startSession(env: Env, request: Request, account: Account): Promise<string> {
  const token = randomToken();
  const ts = now();
  await env.DB.prepare('INSERT INTO sessions (token_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256(token), account.id, ts, ts + SESSION_TTL)
    .run();
  return setCookie(request, SESSION_COOKIE, token, SESSION_TTL);
}

export async function endSession(env: Env, request: Request): Promise<string> {
  const token = cookie(request, SESSION_COOKIE);
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  return setCookie(request, SESSION_COOKIE, '', 0);
}

/** Sign in with an identity: links it to the account already signed in, if any. */
export async function signIn(env: Env, request: Request, identity: Identity): Promise<{ account: Account; cookie: string }> {
  const current = await currentAccount(env, request);
  const account = await accountFor(env, identity, current);
  return { account, cookie: await startSession(env, request, account) };
}

// ------------------------------------------------------------------ one-time codes

async function newCode(
  env: Env,
  kind: 'email' | 'telegram',
  fields: { email?: string; ip?: string | null; country?: string | null },
): Promise<string> {
  const code = randomToken();
  const ts = now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM login_codes WHERE created_at < ?').bind(ts - 86400),
    env.DB.prepare('INSERT INTO login_codes (code_hash, kind, email, ip, country, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(
      await sha256(code),
      kind,
      fields.email ?? null,
      fields.ip ?? null,
      fields.country ?? null,
      ts,
      ts + CODE_TTL,
    ),
  ]);
  return code;
}

interface CodeRow {
  code_hash: string;
  kind: string;
  country: string | null;
  created_at: number;
  email: string | null;
  telegram_id: number | null;
  telegram_name: string | null;
  expires_at: number;
  used: number;
}

async function readCode(env: Env, code: string, kind: string): Promise<CodeRow | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(code)) return null;
  const row = await env.DB.prepare('SELECT * FROM login_codes WHERE code_hash = ? AND kind = ?').bind(await sha256(code), kind).first<CodeRow>();
  return row && !row.used && row.expires_at >= now() ? row : null;
}

/** Use a code once: false if it was already used (two tabs, a replayed link). */
async function useCode(env: Env, row: CodeRow): Promise<boolean> {
  const res = await env.DB.prepare('UPDATE login_codes SET used = 1 WHERE code_hash = ? AND used = 0').bind(row.code_hash).run();
  return res.meta.changes > 0;
}

// ------------------------------------------------------------------ Telegram: confirm in the bot

/** The website asks for a code; the person opens the bot with it, and confirms there who they are. */
export const startTelegramLogin = (env: Env, ip: string | null, country: string | null) => newCode(env, 'telegram', { ip, country });

/**
 * "/start login_<code>" in the bot: what to show before asking "is this you?" (when and where the
 * website asked), or null when the code is no longer valid. Nothing is linked yet: a link someone
 * else sent must not sign them in as you just by opening it.
 */
export async function describeTelegramLogin(env: Env, code: string): Promise<{ created_at: number; country: string | null } | null> {
  const row = await readCode(env, code, 'telegram');
  return row && !row.telegram_id ? { created_at: row.created_at, country: row.country } : null;
}

/** The person pressed "Cancel": the code can no longer be used. */
export async function cancelTelegramLogin(env: Env, code: string): Promise<void> {
  const row = await readCode(env, code, 'telegram');
  if (row) await useCode(env, row);
}

/** The person pressed "Confirm" in the bot: ties the code to their Telegram account. */
export async function confirmTelegramLogin(env: Env, code: string, user: { id: number; name: string | null }): Promise<boolean> {
  const row = await readCode(env, code, 'telegram');
  if (!row || row.telegram_id) return false;
  await env.DB.prepare('UPDATE login_codes SET telegram_id = ?, telegram_name = ? WHERE code_hash = ? AND telegram_id IS NULL')
    .bind(user.id, user.name, row.code_hash)
    .run();
  return true;
}

/** The website polls: once the bot confirmed the code, sign in as that Telegram user. */
export async function finishTelegramLogin(env: Env, request: Request, code: string) {
  const row = await readCode(env, code, 'telegram');
  if (!row?.telegram_id) return null;
  if (!(await useCode(env, row))) return null;
  return signIn(env, request, { kind: 'telegram', telegram_id: row.telegram_id, name: row.telegram_name });
}

// ------------------------------------------------------------------ email: a link by email (Resend)

export const emailConfigured = (env: Env) => Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);

export type EmailResult = 'sent' | 'invalid' | 'too_many' | 'not_configured' | 'failed';

export async function sendEmailLink(env: Env, origin: string, rawEmail: string, ip: string | null, brand: string): Promise<EmailResult> {
  if (!emailConfigured(env)) return 'not_configured';
  const email = rawEmail.trim().toLowerCase();
  if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i.test(email)) return 'invalid';
  const since = now() - 3600;
  const recent = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM login_codes WHERE kind = 'email' AND created_at > ? AND (email = ? OR ip = ?)",
  )
    .bind(since, email, ip ?? '')
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= MAX_EMAILS_PER_HOUR) return 'too_many';
  const code = await newCode(env, 'email', { email, ip });
  const link = `${origin}/api/auth/email/verify?code=${code}`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [email],
      subject: `Sign in to ${brand}`,
      text: `Open this link to sign in to ${brand} (valid for 15 minutes):\n\n${link}\n\nIf you did not ask for it, ignore this email.`,
      html: `<p>Open this link to sign in to <b>${brand.replace(/[<>&]/g, '')}</b> (valid for 15 minutes):</p><p><a href="${link}">Sign in</a></p><p style="color:#64748b">If you did not ask for it, ignore this email.</p>`,
    }),
  }).catch(() => null);
  return res?.ok ? 'sent' : 'failed';
}

export async function finishEmailLogin(env: Env, request: Request, code: string) {
  const row = await readCode(env, code, 'email');
  if (!row?.email || !(await useCode(env, row))) return null;
  return signIn(env, request, { kind: 'email', email: row.email });
}

// ------------------------------------------------------------------ Google: OAuth (OpenID Connect)

export const googleConfigured = (env: Env) => Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

/** Redirect to Google's sign-in page, remembering a random state in a cookie (against forgery). */
export function startGoogleLogin(env: Env, request: Request, origin: string): Response {
  const state = randomToken();
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!,
    redirect_uri: `${origin}/api/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  }).toString();
  return new Response(null, { status: 302, headers: { Location: url.toString(), 'Set-Cookie': setCookie(request, STATE_COOKIE, state, 600) } });
}

export async function finishGoogleLogin(env: Env, request: Request, origin: string, code: string, state: string) {
  const expected = cookie(request, STATE_COOKIE);
  if (!code || !state || !expected || state !== expected) return null;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: `${origin}/api/auth/google/callback`,
      grant_type: 'authorization_code',
    }),
  }).catch(() => null);
  const data = (await res?.json().catch(() => null)) as { id_token?: string } | null;
  if (!res?.ok || !data?.id_token) return null;
  // The token came straight from Google over TLS in exchange for our secret: its claims can be read as is.
  let claims: { sub?: string; email?: string; email_verified?: boolean; name?: string; aud?: string };
  try {
    const raw = data.id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const part = raw + '='.repeat((4 - (raw.length % 4)) % 4);
    claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(part), (c) => c.charCodeAt(0))));
  } catch {
    return null;
  }
  if (!claims.sub || claims.aud !== env.GOOGLE_CLIENT_ID) return null;
  return signIn(env, request, {
    kind: 'google',
    google_sub: claims.sub,
    email: claims.email?.toLowerCase() ?? null,
    email_verified: claims.email_verified === true,
    name: claims.name ?? null,
  });
}

export const clearStateCookie = (request: Request) => setCookie(request, STATE_COOKIE, '', 0);
