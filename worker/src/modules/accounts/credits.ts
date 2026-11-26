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

/** Balances of many accounts with one database call (D1 counts a batch as a single query). */
export async function balances(env: Env, accountIds: string[]): Promise<Map<string, Balance>> {
  const ts = now();
  const out = new Map<string, Balance>();
  if (!accountIds.length) return out;
  const results = await env.DB.batch(
    accountIds.map((id) => env.DB.prepare('SELECT bucket, seconds, expires_at FROM credit_buckets WHERE account_id = ?').bind(id)),
  );
  accountIds.forEach((id, i) => {
    const rows = (results[i].results ?? []) as BucketBalance[];
    const buckets = BUCKETS.map((bucket) => {
      const row = rows.find((r) => r.bucket === bucket);
      const live = row && (!row.expires_at || row.expires_at > ts) ? Math.max(0, row.seconds) : 0;
      return { bucket, seconds: live, expires_at: row?.expires_at ?? null };
    });
    out.set(id, { total_seconds: buckets.reduce((a, b) => a + b.seconds, 0), buckets });
  });
  return out;
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
  await env.DB.batch(grantStatements(env, accountId, bucket, seconds, detail, expiresAt));
}

/**
 * The statements of a grant, for another brick to run inside its own batch (one transaction):
 * e.g. "mark the invite rewarded" and both sides' grants together, all or nothing.
 */
export function grantStatements(
  env: Env,
  accountId: string,
  bucket: Bucket,
  seconds: number,
  detail: string,
  expiresAt: number | null = null,
): D1PreparedStatement[] {
  const ts = now();
  return [
    // An expired bucket starts again from zero.
    env.DB.prepare(
      `INSERT INTO credit_buckets (account_id, bucket, seconds, expires_at) VALUES (?1, ?2, MAX(0, ?3), ?4)
       ON CONFLICT (account_id, bucket) DO UPDATE SET
         seconds = MAX(0, CASE WHEN expires_at IS NOT NULL AND expires_at <= ?5 THEN 0 ELSE seconds END + ?3),
         expires_at = COALESCE(?4, CASE WHEN expires_at IS NOT NULL AND expires_at <= ?5 THEN NULL ELSE expires_at END)`,
    ).bind(accountId, bucket, Math.round(seconds), expiresAt, ts),
    log(env, accountId, seconds >= 0 ? 'grant' : 'remove', Math.round(seconds), null, `${bucket}: ${detail}`.slice(0, 200)),
  ];
}

/** What a hold took from one bucket, and that bucket's expiry then (to give it back to the same credits). */
export interface Part {
  s: number;
  exp: number | null;
}
export type Breakdown = Partial<Record<Bucket, Part>>;

// A statement that fails on purpose (SQLite: integer overflow) when its condition holds. D1 runs a
// batch as one transaction, so a failing guard undoes the whole batch: nothing half-done is kept.
const ABORT = 'abs(-9223372036854775808)';
export const guardChanged = (env: Env) => env.DB.prepare(`SELECT CASE WHEN changes() = 0 THEN ${ABORT} END`);
const guardNotNegative = (env: Env, accountId: string) =>
  env.DB.prepare(`SELECT CASE WHEN EXISTS (SELECT 1 FROM credit_buckets WHERE account_id = ? AND seconds < 0) THEN ${ABORT} END`).bind(accountId);

/** Which buckets `seconds` would come from, in spending order; null when the balance is too low. */
async function plan(env: Env, accountId: string, seconds: number): Promise<Breakdown | null> {
  if (seconds <= 0) return {};
  const { buckets, total_seconds } = await balance(env, accountId);
  if (total_seconds < seconds) return null;
  const parts: Breakdown = {};
  let left = seconds;
  for (const b of buckets) {
    const part = Math.min(left, b.seconds);
    if (part > 0) parts[b.bucket] = { s: part, exp: b.expires_at };
    left -= part;
    if (!left) break;
  }
  return parts;
}

const entries = (b: Breakdown) => Object.entries(b).filter(([, p]) => p && p.s > 0) as [Bucket, Part][];
const total = (b: Breakdown) => entries(b).reduce((n, [, p]) => n + p.s, 0);

/** Take each part from its bucket, only if that bucket still is the one planned (same expiry). */
function takeStatements(env: Env, accountId: string, parts: Breakdown) {
  return entries(parts).flatMap(([bucket, p]) => [
    env.DB.prepare('UPDATE credit_buckets SET seconds = seconds - ? WHERE account_id = ? AND bucket = ? AND expires_at IS ?').bind(p.s, accountId, bucket, p.exp),
    guardChanged(env),
  ]);
}

/**
 * Give parts back to the credits they came from: not to a bucket that has since expired or been
 * started again (a new day's free credits), where they would gain a new expiry.
 */
function giveStatements(env: Env, accountId: string, parts: Breakdown) {
  const ts = now();
  return entries(parts).map(([bucket, p]) =>
    env.DB.prepare(
      'UPDATE credit_buckets SET seconds = seconds + ? WHERE account_id = ? AND bucket = ? AND expires_at IS ? AND (expires_at IS NULL OR expires_at > ?)',
    ).bind(p.s, accountId, bucket, p.exp, ts),
  );
}

function merge(a: Breakdown, b: Breakdown): Breakdown {
  const out: Breakdown = { ...a };
  for (const [bucket, p] of entries(b)) {
    const had = out[bucket];
    // Same bucket, same credits: add up. A bucket started again since: its newer credits win.
    out[bucket] = had && had.exp === p.exp ? { s: had.s + p.s, exp: p.exp } : p;
  }
  return out;
}

interface Hold {
  job_id: string;
  account_id: string;
  /** Set aside under the free limits (no bought credits or plan then). */
  free: number;
  breakdown: string;
  seconds: number;
  status: 'held' | 'charged' | 'refunded';
}

const getHold = (env: Env, jobId: string) => env.DB.prepare('SELECT * FROM credit_holds WHERE job_id = ?').bind(jobId).first<Hold>();

/** Change a hold only if it is still exactly as read (another settle or refund cannot interleave). */
const updateHold = (env: Env, hold: Hold, set: { seconds: number; breakdown: Breakdown; status: Hold['status'] }) =>
  env.DB.prepare(
    "UPDATE credit_holds SET seconds = ?, breakdown = ?, status = ? WHERE job_id = ? AND status = 'held' AND seconds = ? AND breakdown = ?",
  ).bind(set.seconds, JSON.stringify(set.breakdown), set.status, hold.job_id, hold.seconds, hold.breakdown);

/**
 * Set credits aside for a job before it starts: taking them, recording the hold and the ledger line
 * happen together or not at all. False when the balance is too low. A second call for the same job
 * (a repeated request) takes nothing more.
 */
export async function reserve(
  env: Env,
  accountId: string,
  jobId: string,
  seconds: number,
  title: string | null,
  free = false,
): Promise<boolean> {
  if ((await getHold(env, jobId))?.status === 'held') return true;
  for (let attempt = 0; attempt < 2; attempt++) {
    const parts = await plan(env, accountId, seconds);
    if (!parts) return false;
    try {
      await env.DB.batch([
        ...takeStatements(env, accountId, parts),
        guardNotNegative(env, accountId),
        env.DB.prepare(
          "INSERT INTO credit_holds (job_id, account_id, breakdown, seconds, status, free, created_at) VALUES (?, ?, ?, ?, 'held', ?, ?)",
        ).bind(jobId, accountId, JSON.stringify(parts), seconds, free ? 1 : 0, now()),
        log(env, accountId, 'reserve', -seconds, jobId, title),
      ]);
      return true;
    } catch {
      // Spent meanwhile, or the same job reserved at the same moment: look again.
      if ((await getHold(env, jobId))?.status === 'held') return true;
    }
  }
  return false;
}

/**
 * The job's real cost is known (its length was measured): take the difference, or give back what
 * was set aside beyond it. False when more was needed than the account has. At the end (`final`)
 * the job keeps what was set aside and the shortfall is written in the ledger as unpaid.
 */
export async function settle(env: Env, jobId: string, seconds: number, final: boolean): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const hold = await getHold(env, jobId);
    if (!hold || hold.status !== 'held') return true;
    const status = final ? 'charged' : 'held';
    const held = JSON.parse(hold.breakdown) as Breakdown;
    try {
      if (seconds === hold.seconds) {
        if (final) await env.DB.batch([updateHold(env, hold, { seconds, breakdown: held, status }), guardChanged(env)]);
        return true;
      }
      if (seconds > hold.seconds) {
        const extra = await plan(env, hold.account_id, seconds - hold.seconds);
        if (!extra) {
          if (final) {
            await env.DB.batch([
              updateHold(env, hold, { seconds: hold.seconds, breakdown: held, status: 'charged' }),
              guardChanged(env),
              log(env, hold.account_id, 'unpaid', -(seconds - hold.seconds), jobId, 'not enough credits for the full length'),
            ]);
          }
          return false;
        }
        await env.DB.batch([
          updateHold(env, hold, { seconds, breakdown: merge(held, extra), status }),
          guardChanged(env),
          ...takeStatements(env, hold.account_id, extra),
          guardNotNegative(env, hold.account_id),
          log(env, hold.account_id, 'reserve', -(seconds - hold.seconds), jobId, 'actual length'),
        ]);
        return true;
      }
      // Give back the excess, last-spent bucket first (bought credits before free ones).
      let back = hold.seconds - seconds;
      const parts: Breakdown = {};
      const kept: Breakdown = { ...held };
      for (const bucket of [...BUCKETS].reverse()) {
        const p = held[bucket];
        const part = Math.min(back, p?.s ?? 0);
        if (p && part > 0) {
          parts[bucket] = { s: part, exp: p.exp };
          kept[bucket] = { s: p.s - part, exp: p.exp };
        }
        back -= part;
      }
      await env.DB.batch([
        updateHold(env, hold, { seconds, breakdown: kept, status }),
        guardChanged(env),
        ...giveStatements(env, hold.account_id, parts),
        log(env, hold.account_id, 'refund', hold.seconds - seconds, jobId, 'actual length'),
      ]);
      return true;
    } catch {
      // The hold changed under us (another report) or the credits did: read it again.
    }
  }
  return true;
}

/** The job failed or was cancelled: everything set aside for it goes back, in one step. */
export async function refund(env: Env, jobId: string, reason: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const hold = await getHold(env, jobId);
    if (!hold || hold.status !== 'held') return;
    const parts = JSON.parse(hold.breakdown) as Breakdown;
    try {
      await env.DB.batch([
        updateHold(env, hold, { seconds: hold.seconds, breakdown: parts, status: 'refunded' }),
        guardChanged(env),
        ...giveStatements(env, hold.account_id, parts),
        log(env, hold.account_id, 'refund', total(parts), jobId, reason),
      ]);
      return;
    } catch {
      // A settle changed the hold at the same moment: read it again.
    }
  }
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

/** Who a job's credits were set aside for, and whether under the free limits. Null: no hold. */
export async function holdInfo(env: Env, jobId: string): Promise<{ account_id: string; free: boolean; status: string } | null> {
  const hold = await getHold(env, jobId);
  return hold && { account_id: hold.account_id, free: Boolean(hold.free), status: hold.status };
}
