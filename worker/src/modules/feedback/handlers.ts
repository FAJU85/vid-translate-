import { hmacHex } from '../../shared/crypto';
import type { Env } from '../../shared/env';
import { apiError, json } from '../../shared/http';
import { signedInAccount } from '../accounts';
import { addFeedback, deleteFeedback, feedbackCounts, listFeedback, recentFeedback, setFeedbackStatus, type FeedbackStatus } from './store';

/** The longest message, and how many one sender may send an hour. */
export const MAX_FEEDBACK = 2000;
const PER_HOUR = 5;

/** Who sent it, for the rate limit: the account, or a keyed fingerprint of the connection (never the address). */
async function senderKey(env: Env, request: Request, accountId: string | null): Promise<string> {
  if (accountId) return `acct:${accountId}`;
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  return `ip:${(await hmacHex(env.SHARED_SECRET || 'kavox', `feedback:${ip}`)).slice(0, 24)}`;
}

/** POST /api/feedback {text, page?, lang?}: anyone, signed in or not. */
export async function handleFeedback(request: Request, env: Env, path: string): Promise<Response | null> {
  if (path !== '/api/feedback' || request.method !== 'POST') return null;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const text = String(body?.text ?? '').trim();
  if (!text) return apiError(400, 'E_BAD_REQUEST', 'Write something first.');
  if (text.length > MAX_FEEDBACK) return apiError(400, 'E_BAD_REQUEST', `Feedback has at most ${MAX_FEEDBACK} characters.`);
  const account = await signedInAccount(env, request).catch(() => null);
  const sender = await senderKey(env, request, account?.id ?? null);
  if ((await recentFeedback(env, sender, 3600)) >= PER_HOUR) return apiError(429, 'E_SLOW_DOWN', 'You sent a lot of feedback. Try again later.');
  const page = typeof body?.page === 'string' ? body.page.slice(0, 200) : null;
  const lang = body?.lang === 'ar' || body?.lang === 'en' ? body.lang : null;
  await addFeedback(env, { source: 'web', sender, account_id: account?.id ?? null, text, page, lang });
  return json({ ok: true });
}

/** /feedback in the bot: saved like the website's, under the chat. False when the chat sent too many. */
export async function telegramFeedback(env: Env, chatId: number, accountId: string | null, text: string, lang: string): Promise<boolean> {
  const sender = `tg:${chatId}`;
  if ((await recentFeedback(env, sender, 3600)) >= PER_HOUR) return false;
  await addFeedback(env, { source: 'telegram', sender, account_id: accountId, text: text.slice(0, MAX_FEEDBACK), page: null, lang });
  return true;
}

/** GET /api/admin/feedback(?status=new|done), POST {id, action: done|new|delete}. The caller checks the admin password. */
export async function handleFeedbackAdmin(request: Request, env: Env, path: string): Promise<Response | null> {
  if (path !== '/api/admin/feedback') return null;
  if (request.method === 'GET') {
    const s = new URL(request.url).searchParams.get('status');
    const status = s === 'new' || s === 'done' ? (s as FeedbackStatus) : null;
    return json({ items: await listFeedback(env, status), counts: await feedbackCounts(env) });
  }
  if (request.method !== 'POST') return null;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id < 1) return apiError(400, 'E_BAD_REQUEST', 'Say which feedback.');
  const action = String(body?.action ?? '');
  if (action === 'delete') await deleteFeedback(env, id);
  else if (action === 'done' || action === 'new') await setFeedbackStatus(env, id, action);
  else return apiError(400, 'E_BAD_REQUEST', 'Unknown action.');
  return json({ ok: true });
}
