import { now, type Env } from '../../shared/env';

/**
 * Invites: everyone has an invite code; a new person who arrives by it and makes a first video
 * counts as a friend they brought. Rewards (free minutes for both, once) are given only when the
 * admin switched them on and credits are on.
 */
export const REFERRALS_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS referral_codes (
    code TEXT PRIMARY KEY,
    account_id TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS referrals (
    referred_account TEXT PRIMARY KEY,
    referred_owner TEXT NOT NULL,
    referrer_account TEXT NOT NULL,
    channel TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    first_video_at INTEGER,
    rewarded_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS referrals_owner ON referrals (referred_owner)`,
  `CREATE INDEX IF NOT EXISTS referrals_referrer ON referrals (referrer_account)`,
];

// Letters and digits that cannot be mistaken for one another (no 0/O, 1/l/I).
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
export const CODE_RE = /^[A-HJ-NP-Za-hj-np-z2-9]{8}$/;

function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

/** This account's invite code (made the first time it is asked for). */
export async function codeFor(env: Env, accountId: string): Promise<string> {
  const found = await env.DB.prepare('SELECT code FROM referral_codes WHERE account_id = ?').bind(accountId).first<{ code: string }>();
  if (found) return found.code;
  for (let i = 0; i < 4; i++) {
    const code = newCode();
    const res = await env.DB.prepare('INSERT OR IGNORE INTO referral_codes (code, account_id, created_at) VALUES (?, ?, ?)').bind(code, accountId, now()).run();
    if (res.meta.changes) return code;
    const again = await env.DB.prepare('SELECT code FROM referral_codes WHERE account_id = ?').bind(accountId).first<{ code: string }>();
    if (again) return again.code; // made at the same moment by another request
  }
  throw new Error('no free invite code');
}

/**
 * Someone new arrived by an invite: remember who brought them. Nothing happens for an unknown
 * code, for your own code, or for someone already counted. `isNew`: they have made no video yet.
 */
export async function recordReferral(
  env: Env,
  code: string,
  referred: { account: string; owner: string; isNew: boolean },
  channel: 'web' | 'telegram',
): Promise<boolean> {
  if (!CODE_RE.test(code) || !referred.isNew) return false;
  const from = await env.DB.prepare('SELECT account_id FROM referral_codes WHERE code = ?').bind(code).first<{ account_id: string }>();
  if (!from || from.account_id === referred.account) return false;
  const res = await env.DB.prepare(
    `INSERT OR IGNORE INTO referrals (referred_account, referred_owner, referrer_account, channel, created_at) VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(referred.account, referred.owner, from.account_id, channel, now())
    .run();
  return Boolean(res.meta.changes);
}

export interface Referral {
  referred_account: string;
  referrer_account: string;
  first_video_at: number | null;
  rewarded_at: number | null;
}

/** The referral of someone whose job this is (by the job's owner), if any and still waiting. */
export async function waitingReferral(env: Env, owner: string, accountId: string | null): Promise<Referral | null> {
  return env.DB.prepare(
    `SELECT referred_account, referrer_account, first_video_at, rewarded_at FROM referrals
     WHERE (referred_owner = ? OR referred_account = ?) AND first_video_at IS NULL LIMIT 1`,
  )
    .bind(owner, accountId ?? '')
    .first<Referral>();
}

/** Mark the first video made; `rewarded`: the free minutes were given too. Once only. */
export async function markFirstVideo(env: Env, referredAccount: string, rewarded: boolean): Promise<boolean> {
  const ts = now();
  const res = await env.DB.prepare(
    'UPDATE referrals SET first_video_at = ?, rewarded_at = ? WHERE referred_account = ? AND first_video_at IS NULL',
  )
    .bind(ts, rewarded ? ts : null, referredAccount)
    .run();
  return Boolean(res.meta.changes);
}

/** How many friends this account brought: arrived, and made a first video. */
export async function invitedBy(env: Env, accountId: string): Promise<{ joined: number; made_video: number }> {
  const r = await env.DB.prepare(
    'SELECT COUNT(*) AS joined, COUNT(first_video_at) AS made_video FROM referrals WHERE referrer_account = ?',
  )
    .bind(accountId)
    .first<{ joined: number; made_video: number }>();
  return { joined: r?.joined ?? 0, made_video: r?.made_video ?? 0 };
}

/** Totals for the admin: invited, made a first video, rewarded. */
export async function referralTotals(env: Env): Promise<{ joined: number; made_video: number; rewarded: number }> {
  const r = await env.DB.prepare('SELECT COUNT(*) AS joined, COUNT(first_video_at) AS made_video, COUNT(rewarded_at) AS rewarded FROM referrals').first<{
    joined: number;
    made_video: number;
    rewarded: number;
  }>();
  return { joined: r?.joined ?? 0, made_video: r?.made_video ?? 0, rewarded: r?.rewarded ?? 0 };
}

/** Personal data: an account's code and its referrals (export / erase). */
export async function referralsOf(env: Env, accountId: string) {
  const [code, rows] = await Promise.all([
    env.DB.prepare('SELECT code, created_at FROM referral_codes WHERE account_id = ?').bind(accountId).first(),
    env.DB.prepare('SELECT referrer_account = ? AS invited_by_you, channel, created_at, first_video_at, rewarded_at FROM referrals WHERE referrer_account = ? OR referred_account = ?')
      .bind(accountId, accountId, accountId)
      .all(),
  ]);
  return { code, referrals: rows.results };
}

export async function eraseReferrals(env: Env, accountId: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM referral_codes WHERE account_id = ?').bind(accountId),
    env.DB.prepare('DELETE FROM referrals WHERE referrer_account = ? OR referred_account = ?').bind(accountId, accountId),
  ]);
}
