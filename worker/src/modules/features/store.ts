import { now, type Env } from '../../shared/env';

/**
 * Features switched on from the /admin page instead of the command line. Each value fills the
 * Worker setting of the same name (CREDITS_ENABLED, RESEND_API_KEY, ADMIN_TOTP_SECRET…) unless
 * that setting is already set on the server, which always wins. Keys and secrets are encrypted
 * here with a key derived from SHARED_SECRET, and never sent back to the browser.
 */
export const FEATURES_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS feature_settings (
    name TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    secret INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  )`,
];

/** What can be set from the panel, and which of those are secrets (stored encrypted, never shown). */
export const FIELDS = {
  CREDITS_ENABLED: { secret: false },
  MAX_JOBS_PER_HOUR: { secret: false },
  MAX_UPLOAD_MB: { secret: false },
  RESEND_API_KEY: { secret: true },
  EMAIL_FROM: { secret: false },
  GOOGLE_CLIENT_ID: { secret: false },
  GOOGLE_CLIENT_SECRET: { secret: true },
  STRIPE_SECRET_KEY: { secret: true },
  STRIPE_WEBHOOK_SECRET: { secret: true },
  ADMIN_TOTP_SECRET: { secret: true },
  /** A two-step secret being set up: it becomes ADMIN_TOTP_SECRET once a code from it is confirmed. */
  ADMIN_TOTP_PENDING: { secret: true },
} as const;
export type FieldName = keyof typeof FIELDS;

// --- Encryption (AES-GCM, key = SHA-256 of SHARED_SECRET and a fixed label) -------------------

const enc = new TextEncoder();
const keyFor = async (env: Env) =>
  crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', enc.encode(`kavox-features|${env.SHARED_SECRET ?? ''}`)), 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function seal(env: Env, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFor(env), enc.encode(plain)));
  return `v1.${b64(iv)}.${b64(data)}`;
}

async function open(env: Env, sealed: string): Promise<string | null> {
  const [v, iv, data] = sealed.split('.');
  if (v !== 'v1' || !iv || !data) return null;
  try {
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await keyFor(env), unb64(data)));
  } catch {
    return null; // SHARED_SECRET changed: the saved secret cannot be read any more
  }
}

// --- Reading and writing --------------------------------------------------------------------------

/** Every saved value, decrypted (in the Worker only). */
export async function readFeatures(env: Env): Promise<Partial<Record<FieldName, string>>> {
  const { results } = await env.DB.prepare('SELECT name, value, secret FROM feature_settings').all<{ name: FieldName; value: string; secret: number }>();
  const out: Partial<Record<FieldName, string>> = {};
  for (const r of results) {
    if (!(r.name in FIELDS)) continue;
    const v = r.secret ? await open(env, r.value) : r.value;
    if (v !== null && v !== '') out[r.name] = v;
  }
  return out;
}

/** Save (or, with an empty value, remove) one value. */
export async function writeFeature(env: Env, name: FieldName, value: string): Promise<void> {
  if (!value) {
    await env.DB.prepare('DELETE FROM feature_settings WHERE name = ?').bind(name).run();
    return;
  }
  const secret = FIELDS[name].secret;
  await env.DB.prepare(
    `INSERT INTO feature_settings (name, value, secret, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (name) DO UPDATE SET value = excluded.value, secret = excluded.secret, updated_at = excluded.updated_at`,
  )
    .bind(name, secret ? await seal(env, value) : value, secret ? 1 : 0, now())
    .run();
}

// --- The settings every request runs with ----------------------------------------------------------

let cache: { at: number; values: Partial<Record<FieldName, string>> } | null = null;
const CACHE_MS = 15_000;

/** Forget the cached values (after a change on the admin page). */
export const forgetFeatures = () => {
  cache = null;
};

/**
 * The Worker's settings with the panel's values filled in where the server has none. Read at
 * most every 15 seconds per Worker instance; a change shows everywhere within that time.
 */
export async function withFeatures(env: Env): Promise<Env> {
  if (!cache || Date.now() - cache.at > CACHE_MS) {
    const values = await readFeatures(env).catch(() => null);
    if (!values) return env; // table not made yet, or the database is down: the server's settings alone
    cache = { at: Date.now(), values };
  }
  const live: Env = { ...env, SERVER_ENV: env };
  for (const [name, value] of Object.entries(cache.values) as [FieldName, string][]) {
    if (name === 'ADMIN_TOTP_PENDING') continue;
    const k = name as keyof Env;
    if (live[k] === undefined || live[k] === '') (live as unknown as Record<string, string>)[k] = value;
  }
  return live;
}
