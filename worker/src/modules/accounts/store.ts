import { now, type Env } from '../../shared/env';

/**
 * Accounts brick storage. One person = one account, whichever way they signed in (Telegram, an
 * email link, Google); a browser that has not signed in gets a guest account tied to its id.
 * Credits are kept in whole seconds of video (1 credit = 60 seconds) to avoid rounding errors.
 */
export const ACCOUNTS_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    name TEXT,
    email TEXT UNIQUE,
    email_verified INTEGER NOT NULL DEFAULT 0,
    google_sub TEXT UNIQUE,
    telegram_id INTEGER UNIQUE,
    guest_client TEXT UNIQUE,
    created_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  // One-time sign-in codes: an emailed link, or a code the Telegram bot confirms.
  `CREATE TABLE IF NOT EXISTS login_codes (
    code_hash TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    email TEXT,
    telegram_id INTEGER,
    telegram_name TEXT,
    ip TEXT,
    country TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS login_codes_created ON login_codes (created_at)`,
  // Balances per bucket: daily (free, refills), monthly (a plan, until its period ends),
  // bonus (one-off free credits) and topup (bought packs, never expire).
  `CREATE TABLE IF NOT EXISTS credit_buckets (
    account_id TEXT NOT NULL,
    bucket TEXT NOT NULL,
    seconds INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER,
    PRIMARY KEY (account_id, bucket)
  )`,
  // Every change to a balance, for the usage history.
  `CREATE TABLE IF NOT EXISTS credit_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL,
    job_id TEXT,
    kind TEXT NOT NULL,
    seconds INTEGER NOT NULL,
    detail TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS credit_ledger_account ON credit_ledger (account_id, created_at)`,
  // Credits set aside for a running job: returned if it fails, adjusted to its real length.
  `CREATE TABLE IF NOT EXISTS credit_holds (
    job_id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    breakdown TEXT NOT NULL,
    seconds INTEGER NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
];

export interface Account {
  id: string;
  name: string | null;
  email: string | null;
  email_verified: number;
  google_sub: string | null;
  telegram_id: number | null;
  guest_client: string | null;
  created_at: number;
  last_seen: number;
}

export type Identity =
  | { kind: 'telegram'; telegram_id: number; name?: string | null }
  | { kind: 'email'; email: string; name?: string | null }
  | { kind: 'google'; google_sub: string; email?: string | null; email_verified?: boolean; name?: string | null }
  | { kind: 'guest'; client: string };

export const getAccount = (env: Env, id: string) =>
  env.DB.prepare('SELECT * FROM accounts WHERE id = ?').bind(id).first<Account>();

function findBy(env: Env, identity: Identity): Promise<Account | null> {
  const q = (col: string, v: unknown) => env.DB.prepare(`SELECT * FROM accounts WHERE ${col} = ?`).bind(v).first<Account>();
  switch (identity.kind) {
    case 'telegram':
      return q('telegram_id', identity.telegram_id);
    case 'email':
      return q('email', identity.email);
    case 'guest':
      return q('guest_client', identity.client);
    case 'google':
      return q('google_sub', identity.google_sub).then(
        (a) => a ?? (identity.email && identity.email_verified ? q('email', identity.email) : null),
      );
  }
}

const COLUMNS: Record<Identity['kind'], (i: any) => Record<string, unknown>> = {
  telegram: (i) => ({ telegram_id: i.telegram_id }),
  email: (i) => ({ email: i.email, email_verified: 1 }),
  google: (i) => ({ google_sub: i.google_sub, ...(i.email && i.email_verified ? { email: i.email, email_verified: 1 } : {}) }),
  guest: (i) => ({ guest_client: i.client }),
};

/**
 * The account for a sign-in. With `current` (already signed in), a new way of signing in is
 * linked to that account, unless it already belongs to another account: then that one is used.
 */
export async function accountFor(env: Env, identity: Identity, current?: Account | null): Promise<Account> {
  const ts = now();
  const found = await findBy(env, identity);
  const name = 'name' in identity ? identity.name ?? null : null;
  if (found) {
    // Google may add a verified email the account did not have yet.
    const extra = identity.kind === 'google' && !found.google_sub ? COLUMNS.google(identity) : {};
    await update(env, found.id, { ...extra, last_seen: ts, ...(name && !found.name ? { name } : {}) });
    return (await getAccount(env, found.id))!;
  }
  if (current && current.guest_client === null) {
    await update(env, current.id, { ...COLUMNS[identity.kind](identity), last_seen: ts, ...(name && !current.name ? { name } : {}) });
    return (await getAccount(env, current.id))!;
  }
  const account: Account = {
    id: crypto.randomUUID(),
    name,
    email: null,
    email_verified: 0,
    google_sub: null,
    telegram_id: null,
    guest_client: null,
    created_at: ts,
    last_seen: ts,
    ...(COLUMNS[identity.kind](identity) as Partial<Account>),
  };
  const cols = Object.keys(account);
  // Two requests for the same new person at once: the second insert is ignored and both read the one row.
  const res = await env.DB.prepare(`INSERT OR IGNORE INTO accounts (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .bind(...cols.map((c) => (account as unknown as Record<string, unknown>)[c]))
    .run();
  if (res.meta.changes) return account;
  return (await findBy(env, identity)) ?? account;
}

async function update(env: Env, id: string, patch: Record<string, unknown>): Promise<void> {
  const cols = Object.keys(patch);
  if (!cols.length) return;
  await env.DB.prepare(`UPDATE accounts SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
    .bind(...cols.map((c) => patch[c]), id)
    .run();
}

export async function listAccounts(env: Env, query: string, limit = 100): Promise<Account[]> {
  const q = query.trim();
  const sql = q
    ? `SELECT * FROM accounts WHERE guest_client IS NULL AND (name LIKE ?1 OR email LIKE ?1 OR CAST(telegram_id AS TEXT) LIKE ?1 OR id = ?2)
       ORDER BY last_seen DESC LIMIT ?3`
    : 'SELECT * FROM accounts WHERE guest_client IS NULL ORDER BY last_seen DESC LIMIT ?1';
  const stmt = env.DB.prepare(sql);
  const { results } = await (q ? stmt.bind(`%${q}%`, q, limit) : stmt.bind(limit)).all<Account>();
  return results;
}
