import { now, type Env } from '../../shared/env';
import { balance, creditsEnabled, grant, type Balance } from './credits';
import type { Account } from './store';

/**
 * The free allowances (see README → Accounts and credits):
 * - a browser that has not signed in: 0.5 credit once, to try it;
 * - an account: 3 credits once, when it is created (not added to a browser's trial: the trial
 *   stays with the browser);
 * - a verified account (Telegram, a Google account, an email link): 0.5 credit refilled 24 hours
 *   after the last refill. It never builds up: what is left expires and the next refill replaces it.
 * Without bought credits or a plan, a video may be at most 90 seconds long, and dubbing is
 * limited to one preview of up to 15 seconds.
 */
export const GUEST_TRIAL_SECONDS = 30;
export const SIGNUP_BONUS_SECONDS = 180;
export const DAILY_SECONDS = 30;
export const DAILY_PERIOD = 24 * 3600;
export const FREE_MAX_VIDEO_SECONDS = 90;
export const DUB_PREVIEW_MAX_SECONDS = 15;

/** Signed in with something that is hard to make by the thousand (not just a browser). */
export const verified = (a: Account) => a.guest_client === null && (a.telegram_id !== null || Boolean(a.email_verified) || a.google_sub !== null);

/** Bought credits or a plan: the free limits do not apply. */
export const paid = (b: Balance) => b.buckets.some((x) => (x.bucket === 'topup' || x.bucket === 'monthly') && x.seconds > 0);

/**
 * Bring an account's free credits up to date: its one-time welcome credits, and today's free
 * credits when the last ones are used up or older than a day. Safe to call on every request.
 */
export async function prepareAccount(env: Env, account: Account): Promise<void> {
  if (!creditsEnabled(env)) return;
  // Welcome credits, once: whoever sets the flag first grants them.
  const welcome = await env.DB.prepare('UPDATE accounts SET welcomed = 1 WHERE id = ? AND welcomed = 0').bind(account.id).run();
  if (welcome.meta.changes) {
    const guest = account.guest_client !== null;
    await grant(env, account.id, 'bonus', guest ? GUEST_TRIAL_SECONDS : SIGNUP_BONUS_SECONDS, guest ? 'free trial' : 'welcome credits');
  }
  if (!verified(account)) return;
  // Today's free credits: only when there are none yet, or the last ones have expired.
  const ts = now();
  const refill = await env.DB.prepare(
    `INSERT INTO credit_buckets (account_id, bucket, seconds, expires_at) VALUES (?1, 'daily', ?2, ?3)
     ON CONFLICT (account_id, bucket) DO UPDATE SET seconds = ?2, expires_at = ?3
     WHERE expires_at IS NULL OR expires_at <= ?4`,
  )
    .bind(account.id, DAILY_SECONDS, ts + DAILY_PERIOD, ts)
    .run();
  if (refill.meta.changes) {
    await env.DB.prepare("INSERT INTO credit_ledger (account_id, job_id, kind, seconds, detail, created_at) VALUES (?, NULL, 'grant', ?, 'daily: free credits', ?)")
      .bind(account.id, DAILY_SECONDS, ts)
      .run();
  }
}

export type FreeLimit = 'free_limit' | 'dub_paid' | null;

/** Whether the free limits stop a video of this length (seconds; null when not known yet). */
export function freeLimit(account: Account, b: Balance, mode: string, durationSeconds: number | null | undefined): FreeLimit {
  if (paid(b)) return null;
  const d = Number(durationSeconds) || 0;
  if (mode === 'dub' && (account.dub_preview_used || d > DUB_PREVIEW_MAX_SECONDS)) return 'dub_paid';
  if (d > FREE_MAX_VIDEO_SECONDS) return 'free_limit';
  return null;
}

/** Take the one dubbing preview; false if it was already taken (two requests at once). */
export async function useDubPreview(env: Env, accountId: string): Promise<boolean> {
  const res = await env.DB.prepare('UPDATE accounts SET dub_preview_used = 1 WHERE id = ? AND dub_preview_used = 0').bind(accountId).run();
  return res.meta.changes > 0;
}

/** A free dubbing preview that failed or was cancelled can be tried again. */
export const giveBackDubPreview = (env: Env, accountId: string) =>
  env.DB.prepare('UPDATE accounts SET dub_preview_used = 0 WHERE id = ?').bind(accountId).run();

/** Balance, after bringing the free credits up to date. */
export async function freshBalance(env: Env, account: Account): Promise<Balance> {
  await prepareAccount(env, account);
  return balance(env, account.id);
}
