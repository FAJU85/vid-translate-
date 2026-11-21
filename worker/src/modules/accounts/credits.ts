import { now, type Env } from '../../shared/env';

/** 1 credit = 60 seconds of video; balances and charges are whole seconds. */
export const SECONDS_PER_CREDIT = 60;
/** The least a job costs: very short clips still use a whole run of the pipeline. */
export const MIN_BILLED_SECONDS = 10;
/** Dubbing makes speech too: it costs this many times subtitles. */
export const DUB_MULTIPLIER = 2;

/** Spent in this order: what expires first goes first, bought packs (never expire) last. */
export const BUCKETS = ['daily', 'monthly', 'bonus', 'topup'] as const;
export type Bucket = (typeof BUCKETS)[number];

/** Credits are only counted and charged when the owner switches them on (CREDITS_ENABLED=1). */
export const creditsEnabled = (env: Env) => ['1', 'true', 'yes'].includes(String(env.CREDITS_ENABLED ?? '').toLowerCase());

/** What a job costs, in seconds of credit. Re-rendering edited subtitles is free. */
export function costSeconds(durationSeconds: number | null | undefined, mode: string, sourceKind: string): number {
  if (sourceKind === 'rerender') return 0;
  const seconds = Math.max(MIN_BILLED_SECONDS, Math.ceil(Number(durationSeconds) || 0));
  return mode === 'dub' ? seconds * DUB_MULTIPLIER : seconds;
}

export interface BucketBalance {
  bucket: Bucket;
  seconds: number;
  expires_at: number | null;
}

export interface Balance {
  total_seconds: number;
  buckets: BucketBalance[];
}

/** What an account can spend now (expired buckets count as empty). */
export async function balance(env: Env, accountId: string): Promise<Balance> {
  const ts = now();
  const { results } = await env.DB.prepare('SELECT bucket, seconds, expires_at FROM credit_buckets WHERE account_id = ?')
    .bind(accountId)
    .all<BucketBalance>();
  const buckets = BUCKETS.map((bucket) => {
    const row = results.find((r) => r.bucket === bucket);
    const live = row && (!row.expires_at || row.expires_at > ts) ? Math.max(0, row.seconds) : 0;
    return { bucket, seconds: live, expires_at: row?.expires_at ?? null };
  });
  return { total_seconds: buckets.reduce((a, b) => a + b.seconds, 0), buckets };
}

function log(env: Env, accountId: string, kind: string, seconds: number, jobId: string | null, detail: string | null) {
  return env.DB.prepare('INSERT INTO credit_ledger (account_id, job_id, kind, seconds, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(accountId, jobId, kind, seconds, detail, now());
}

/**
 * Add (or, with a negative amount, remove) credits in one bucket. `expiresAt` sets when that
 * bucket runs out (monthly plans, daily refills); a top-up never expires.
 */
export async function grant(
  env: Env,
  accountId: string,
  bucket: Bucket,
  seconds: number,
  detail: string,
  expiresAt: number | null = null,
): Promise<void> {
  const ts = now();
  await env.DB.batch([
    // An expired bucket starts again from zero.
    env.DB.prepare(
      `INSERT INTO credit_buckets (account_id, bucket, seconds, expires_at) VALUES (?1, ?2, MAX(0, ?3), ?4)
       ON CONFLICT (account_id, bucket) DO UPDATE SET
         seconds = MAX(0, CASE WHEN expires_at IS NOT NULL AND expires_at <= ?5 THEN 0 ELSE seconds END + ?3),
         expires_at = COALESCE(?4, CASE WHEN expires_at IS NOT NULL AND expires_at <= ?5 THEN NULL ELSE expires_at END)`,
    ).bind(accountId, bucket, Math.round(seconds), expiresAt, ts),
    log(env, accountId, seconds >= 0 ? 'grant' : 'remove', Math.round(seconds), null, `${bucket}: ${detail}`.slice(0, 200)),
  ]);
}

export type Breakdown = Partial<Record<Bucket, number>>;

/**
 * Take `seconds` from the account, bucket by bucket in spending order. All or nothing: returns
 * what was taken from each bucket, or null (and takes nothing) when the balance is too low.
 */
async function take(env: Env, accountId: string, seconds: number): Promise<Breakdown | null> {
  if (seconds <= 0) return {};
  const ts = now();
  const { buckets, total_seconds } = await balance(env, accountId);
  if (total_seconds < seconds) return null;
  const plan: Breakdown = {};
  let left = seconds;
  for (const b of buckets) {
    const part = Math.min(left, b.seconds);
    if (part > 0) plan[b.bucket] = part;
    left -= part;
    if (!left) break;
  }
  // Each step only succeeds if the bucket still holds enough (two jobs at once cannot overspend).
  const taken: Breakdown = {};
  for (const [bucket, part] of Object.entries(plan) as [Bucket, number][]) {
    const res = await env.DB.prepare(
      `UPDATE credit_buckets SET seconds = seconds - ?3
       WHERE account_id = ?1 AND bucket = ?2 AND seconds >= ?3 AND (expires_at IS NULL OR expires_at > ?4)`,
    )
      .bind(accountId, bucket, part, ts)
      .run();
    if (!res.meta.changes) {
      await giveBack(env, accountId, taken);
      return null;
    }
    taken[bucket] = part;
  }
  return taken;
}

async function giveBack(env: Env, accountId: string, parts: Breakdown): Promise<void> {
  const stmts = (Object.entries(parts) as [Bucket, number][])
    .filter(([, s]) => s > 0)
    .map(([bucket, s]) =>
      env.DB.prepare('UPDATE credit_buckets SET seconds = seconds + ? WHERE account_id = ? AND bucket = ?').bind(s, accountId, bucket),
    );
  if (stmts.length) await env.DB.batch(stmts);
}

const merge = (a: Breakdown, b: Breakdown): Breakdown => {
  const out: Breakdown = { ...a };
  for (const [k, v] of Object.entries(b) as [Bucket, number][]) out[k] = (out[k] ?? 0) + v;
  return out;
};

interface Hold {
  job_id: string;
  account_id: string;
  breakdown: string;
  seconds: number;
  status: 'held' | 'charged' | 'refunded';
}

const getHold = (env: Env, jobId: string) => env.DB.prepare('SELECT * FROM credit_holds WHERE job_id = ?').bind(jobId).first<Hold>();

/** Set credits aside for a job before it starts. False when the balance is too low. */
export async function reserve(env: Env, accountId: string, jobId: string, seconds: number, title: string | null): Promise<boolean> {
  const taken = await take(env, accountId, seconds);
  if (!taken) return false;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO credit_holds (job_id, account_id, breakdown, seconds, status, created_at) VALUES (?, ?, ?, ?, 'held', ?)",
    ).bind(jobId, accountId, JSON.stringify(taken), seconds, now()),
    log(env, accountId, 'reserve', -seconds, jobId, title),
  ]);
  return true;
}

/**
 * The job's real cost is known (its length was measured): take the difference, or give back what
 * was set aside beyond it. False when more was needed than the account has (nothing is taken).
 */
export async function settle(env: Env, jobId: string, seconds: number, final: boolean): Promise<boolean> {
  const hold = await getHold(env, jobId);
  if (!hold || hold.status !== 'held') return true;
  const status = final ? 'charged' : 'held';
  if (seconds === hold.seconds) {
    if (final) await env.DB.prepare("UPDATE credit_holds SET status = 'charged' WHERE job_id = ? AND status = 'held'").bind(jobId).run();
    return true;
  }
  // Claim the change first: progress reports can arrive together, and only one may settle.
  const claim = await env.DB.prepare(
    "UPDATE credit_holds SET seconds = ?, status = ? WHERE job_id = ? AND seconds = ? AND status = 'held'",
  )
    .bind(seconds, status, jobId, hold.seconds)
    .run();
  if (!claim.meta.changes) return true; // another report settled it
  const held = JSON.parse(hold.breakdown) as Breakdown;
  let breakdown = held;
  if (seconds > hold.seconds) {
    const extra = await take(env, hold.account_id, seconds - hold.seconds);
    if (!extra) {
      // Not enough left: put the hold back as it was (at the end, the job keeps what was set aside).
      await env.DB.prepare('UPDATE credit_holds SET seconds = ?, status = ? WHERE job_id = ?')
        .bind(hold.seconds, final ? 'charged' : 'held', jobId)
        .run();
      return false;
    }
    breakdown = merge(held, extra);
    await log(env, hold.account_id, 'reserve', -(seconds - hold.seconds), jobId, 'actual length').run();
  } else {
    // Give back the excess, last-spent bucket first (top-ups before free credits).
    let back = hold.seconds - seconds;
    const parts: Breakdown = {};
    for (const bucket of [...BUCKETS].reverse()) {
      const part = Math.min(back, held[bucket] ?? 0);
      if (part > 0) {
        parts[bucket] = part;
        breakdown = { ...breakdown, [bucket]: (breakdown[bucket] ?? 0) - part };
      }
      back -= part;
    }
    await giveBack(env, hold.account_id, parts);
    await log(env, hold.account_id, 'refund', hold.seconds - seconds, jobId, 'actual length').run();
  }
  await env.DB.prepare('UPDATE credit_holds SET breakdown = ? WHERE job_id = ?').bind(JSON.stringify(breakdown), jobId).run();
  return true;
}

/** The job failed or was cancelled: everything set aside for it goes back. */
export async function refund(env: Env, jobId: string, reason: string): Promise<void> {
  const hold = await getHold(env, jobId);
  if (!hold || hold.status !== 'held') return;
  // Claim the refund first, so two reports of the same failure cannot refund twice.
  const claimed = await env.DB.prepare("UPDATE credit_holds SET status = 'refunded' WHERE job_id = ? AND status = 'held'").bind(jobId).run();
  if (!claimed.meta.changes) return;
  const fresh = (await getHold(env, jobId)) ?? hold; // a settle may have just changed it
  await giveBack(env, fresh.account_id, JSON.parse(fresh.breakdown) as Breakdown);
  await log(env, fresh.account_id, 'refund', fresh.seconds, jobId, reason).run();
}

export interface LedgerEntry {
  id: number;
  job_id: string | null;
  kind: string;
  seconds: number;
  detail: string | null;
  created_at: number;
}

export async function history(env: Env, accountId: string, limit = 100): Promise<LedgerEntry[]> {
  const { results } = await env.DB.prepare(
    'SELECT id, job_id, kind, seconds, detail, created_at FROM credit_ledger WHERE account_id = ? ORDER BY id DESC LIMIT ?',
  )
    .bind(accountId, limit)
    .all<LedgerEntry>();
  return results;
}
