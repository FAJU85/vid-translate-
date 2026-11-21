import type { Env } from '../../shared/env';
import { UUID, apiError, json } from '../../shared/http';
import {
  clearStateCookie,
  currentAccount,
  emailConfigured,
  endSession,
  finishEmailLogin,
  finishGoogleLogin,
  finishTelegramLogin,
  googleConfigured,
  sendEmailLink,
  startGoogleLogin,
  startTelegramLogin,
} from './auth';
import {
  DAILY_PERIOD,
  DAILY_SECONDS,
  DUB_PREVIEW_MAX_SECONDS,
  FREE_MAX_VIDEO_SECONDS,
  GUEST_TRIAL_SECONDS,
  SIGNUP_BONUS_SECONDS,
  freshBalance,
  paid,
  verified,
} from './allowances';
import { BUCKETS, SECONDS_PER_CREDIT, balance, balances, creditsEnabled, grant, history, type Bucket } from './credits';
import { accountFor, getAccount, listAccounts, type Account } from './store';

export interface AccountsContext {
  /** Public origin of the Worker (sign-in links and Google's return address). */
  origin: string;
  /** The bot's @username, for "Sign in with Telegram". */
  botUsername: () => Promise<string | null>;
  /** The site's name, for the sign-in email. */
  brand: () => Promise<string>;
  isAdmin: boolean;
}

/** The account a website request acts for: the signed-in one, or this browser's guest account. */
export async function accountForWeb(env: Env, request: Request, clientId: string): Promise<Account> {
  return (await currentAccount(env, request)) ?? accountFor(env, { kind: 'guest', client: clientId });
}

/** The account of a Telegram user (created on first use). */
export const accountForTelegram = (env: Env, telegramId: number, name?: string | null) =>
  accountFor(env, { kind: 'telegram', telegram_id: telegramId, name: name ?? null });

/** What the website may know about an account: never the internal ids of other services. */
function publicAccount(a: Account) {
  return {
    id: a.id,
    name: a.name,
    email: a.email,
    email_verified: Boolean(a.email_verified),
    linked: { telegram: a.telegram_id !== null, google: a.google_sub !== null, email: Boolean(a.email && a.email_verified) },
    created_at: a.created_at,
  };
}

async function me(env: Env, request: Request, api: AccountsContext, clientId: string | null) {
  const account = await currentAccount(env, request);
  // A guest's balance is shown too (credits are per browser until it signs in).
  const enabled = creditsEnabled(env);
  // Guest accounts are only made when credits are on (otherwise nothing is kept for a browser).
  const holder = account ?? (enabled && clientId && UUID.test(clientId) ? await accountFor(env, { kind: 'guest', client: clientId }) : null);
  const held = holder && enabled ? await freshBalance(env, holder) : null;
  const daily = held?.buckets.find((b) => b.bucket === 'daily');
  return {
    account: account && publicAccount(account),
    credits_enabled: enabled,
    seconds_per_credit: SECONDS_PER_CREDIT,
    balance: held,
    // What the free credits and limits are for this person now (the website explains them).
    free: holder && held
      ? {
          paid: paid(held),
          verified: verified(holder),
          daily_seconds: DAILY_SECONDS,
          // The next free credits come 24 hours after the last ones (shown when they are used up).
          next_daily_at: verified(holder) && daily?.expires_at ? daily.expires_at : null,
          max_video_seconds: paid(held) ? null : FREE_MAX_VIDEO_SECONDS,
          dub_preview_available: !paid(held) && !holder.dub_preview_used,
          dub_preview_max_seconds: DUB_PREVIEW_MAX_SECONDS,
        }
      : null,
    allowances: { guest_trial: GUEST_TRIAL_SECONDS, signup_bonus: SIGNUP_BONUS_SECONDS, daily: DAILY_SECONDS, daily_period: DAILY_PERIOD },
    sign_in: { telegram: Boolean(await api.botUsername()), email: emailConfigured(env), google: googleConfigured(env) },
  };
}

const redirect = (to: string, cookies: string[] = []) => {
  const headers = new Headers({ Location: to });
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(null, { status: 302, headers });
};

const withCookie = (res: Response, cookie: string) => {
  const out = new Response(res.body, res);
  out.headers.append('Set-Cookie', cookie);
  return out;
};

/** /api/me, /api/auth/* and /api/admin/accounts*. Returns null for any other path. */
export async function handleAccounts(request: Request, env: Env, path: string, api: AccountsContext): Promise<Response | null> {
  const url = new URL(request.url);
  const method = request.method;
  const ip = request.headers.get('CF-Connecting-IP');

  if (path === '/api/me' && method === 'GET') return json(await me(env, request, api, url.searchParams.get('client_id')));

  if (path === '/api/me/history' && method === 'GET') {
    const client = url.searchParams.get('client_id') ?? '';
    const account = (await currentAccount(env, request)) ?? (creditsEnabled(env) && UUID.test(client) ? await accountFor(env, { kind: 'guest', client }) : null);
    if (!account) return json([]);
    return json(await history(env, account.id));
  }

  if (path === '/api/auth/logout' && method === 'POST') {
    return json({ ok: true }, 200, { 'Set-Cookie': await endSession(env, request) });
  }

  // Telegram: the website gets a code, the person opens the bot with it, the website polls.
  if (path === '/api/auth/telegram/start' && method === 'POST') {
    const bot = await api.botUsername();
    if (!bot) return apiError(501, 'E_NOT_CONFIGURED', 'Telegram sign-in is not available.');
    const country = ((request as unknown as { cf?: { country?: string } }).cf?.country ?? null) as string | null;
    const code = await startTelegramLogin(env, ip, country);
    return json({ code, url: `https://t.me/${bot}?start=login_${code}` });
  }
  if (path === '/api/auth/telegram/check' && method === 'POST') {
    const body = (await request.json().catch(() => null)) as { code?: string; client_id?: string } | null;
    const done = await finishTelegramLogin(env, request, String(body?.code ?? ''));
    if (!done) return json({ status: 'waiting' });
    return withCookie(json({ status: 'signed_in', ...(await me(env, withSession(request, done.cookie), api, null)) }), done.cookie);
  }

  if (path === '/api/auth/email' && method === 'POST') {
    const body = (await request.json().catch(() => null)) as { email?: string } | null;
    const result = await sendEmailLink(env, api.origin, String(body?.email ?? ''), ip, await api.brand());
    if (result === 'sent') return json({ ok: true });
    const [status, message] = {
      not_configured: [501, 'Email sign-in is not available.'],
      invalid: [400, 'Please enter a valid email address.'],
      too_many: [429, 'Too many sign-in emails. Try again in an hour.'],
      failed: [502, 'The email could not be sent. Try again later.'],
    }[result] as [number, string];
    return apiError(status, 'E_EMAIL', message);
  }
  if (path === '/api/auth/email/verify' && method === 'GET') {
    const done = await finishEmailLogin(env, request, url.searchParams.get('code') ?? '');
    return done ? redirect('/?signin=ok', [done.cookie]) : redirect('/?signin=expired');
  }

  if (path === '/api/auth/google' && method === 'GET') {
    if (!googleConfigured(env)) return redirect('/?signin=unavailable');
    return startGoogleLogin(env, request, api.origin);
  }
  if (path === '/api/auth/google/callback' && method === 'GET') {
    if (!googleConfigured(env)) return redirect('/?signin=unavailable');
    const done = await finishGoogleLogin(env, request, api.origin, url.searchParams.get('code') ?? '', url.searchParams.get('state') ?? '');
    const cleared = clearStateCookie(request);
    return done ? redirect('/?signin=ok', [done.cookie, cleared]) : redirect('/?signin=failed', [cleared]);
  }

  // ------------------------------------------------------------------ /admin: accounts and credits
  if (path === '/api/admin/accounts' || path.startsWith('/api/admin/accounts/')) {
    if (!api.isAdmin) return apiError(401, 'E_UNAUTHORIZED', 'Wrong password.');
    if (path === '/api/admin/accounts' && method === 'GET') {
      const accounts = await listAccounts(env, url.searchParams.get('q') ?? '');
      const all = await balances(env, accounts.map((a) => a.id));
      return json(accounts.map((a) => ({ ...publicAccount(a), telegram_id: a.telegram_id, last_seen: a.last_seen, balance: all.get(a.id) })));
    }
    const credit = path.match(/^\/api\/admin\/accounts\/([0-9a-f-]{36})\/credits$/);
    if (credit && method === 'POST') {
      const account = await getAccount(env, credit[1]);
      if (!account) return apiError(404, 'E_NOT_FOUND', 'Account not found.');
      const body = (await request.json().catch(() => null)) as { seconds?: number; bucket?: string; days?: number; note?: string } | null;
      const seconds = Math.round(Number(body?.seconds));
      const bucket = body?.bucket as Bucket;
      if (!Number.isFinite(seconds) || !seconds || Math.abs(seconds) > 1_000_000 || !BUCKETS.includes(bucket)) {
        return apiError(400, 'E_BAD_REQUEST', 'Send seconds (not 0) and a bucket: daily, monthly, bonus or topup.');
      }
      const days = Number(body?.days);
      const expires = Number.isFinite(days) && days > 0 ? Math.floor(Date.now() / 1000) + Math.round(days * 86400) : null;
      await grant(env, account.id, bucket, seconds, `admin${body?.note ? `: ${String(body.note).slice(0, 120)}` : ''}`, expires);
      return json({ ...publicAccount(account), balance: await balance(env, account.id), history: await history(env, account.id, 20) });
    }
    if (credit) return apiError(405, 'E_BAD_REQUEST', 'Method not allowed.');
    const one = path.match(/^\/api\/admin\/accounts\/([0-9a-f-]{36})$/);
    if (one && method === 'GET') {
      const account = await getAccount(env, one[1]);
      if (!account) return apiError(404, 'E_NOT_FOUND', 'Account not found.');
      return json({ ...publicAccount(account), telegram_id: account.telegram_id, balance: await balance(env, account.id), history: await history(env, account.id, 50) });
    }
    return apiError(404, 'E_NOT_FOUND', 'Not found.');
  }

  return null;
}

/** The same request, as if it carried the new session cookie (to answer with the signed-in state). */
function withSession(request: Request, setCookie: string): Request {
  const pair = setCookie.split(';')[0];
  const headers = new Headers(request.headers);
  headers.set('Cookie', pair);
  return new Request(request.url, { method: 'GET', headers });
}
