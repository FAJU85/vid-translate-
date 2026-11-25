import { now, type Env } from '../../shared/env';

/**
 * The audit log: who did what to sensitive data, and when (PDPL accountability, and the first
 * place to look after a suspected breach). Admin sign-ins (failed ones too), every admin change,
 * an admin opening an account's details, people downloading or deleting their data.
 */
export const AUDIT_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT,
    detail TEXT,
    conn TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS audit_at ON audit_log (at)`,
  `CREATE INDEX IF NOT EXISTS audit_action ON audit_log (action, at)`,
];

/** Kept a year, then deleted (as the Privacy Policy says). */
const KEEP_DAYS = 365;

export interface AuditEntry {
  /** "admin", "user:<account id>", "guest:<browser>" or "system". */
  actor: string;
  /** What happened, e.g. "admin.login", "admin.login_failed", "data.export", "account.delete". */
  action: string;
  target?: string | null;
  detail?: unknown;
  /** A keyed fingerprint of the connection (never the address). */
  conn?: string | null;
}

export interface AuditRow {
  id: number;
  at: number;
  actor: string;
  action: string;
  target: string | null;
  detail: string | null;
  conn: string | null;
}

/** Write one entry. Never throws: an audit failure must not break what it records. */
export async function audit(env: Env, e: AuditEntry): Promise<void> {
  const detail = e.detail === undefined || e.detail === null ? null : typeof e.detail === 'string' ? e.detail : JSON.stringify(e.detail);
  await env.DB.prepare('INSERT INTO audit_log (at, actor, action, target, detail, conn) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(now(), e.actor, e.action, e.target ?? null, detail?.slice(0, 2000) ?? null, e.conn ?? null)
    .run()
    .catch((err) => console.error('audit failed', err));
}

/** How many times an action happened recently (e.g. failed admin sign-ins from a connection). */
export async function recentAudit(env: Env, action: string, seconds: number, conn?: string | null): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = ? AND at > ?${conn ? ' AND conn = ?' : ''}`)
    .bind(action, now() - seconds, ...(conn ? [conn] : []))
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function listAudit(env: Env, f: { action?: string | null; before?: number | null; limit?: number }): Promise<AuditRow[]> {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (f.action) (where.push('action LIKE ?'), binds.push(`${f.action}%`));
  if (f.before) (where.push('id < ?'), binds.push(f.before));
  const { results } = await env.DB.prepare(`SELECT * FROM audit_log ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`)
    .bind(...binds, f.limit ?? 200)
    .all<AuditRow>();
  return results;
}

export const sweepAudit = (env: Env) => env.DB.prepare('DELETE FROM audit_log WHERE at < ?').bind(now() - KEEP_DAYS * 86400).run();
