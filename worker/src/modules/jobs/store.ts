import { now, type Env } from '../../shared/env';
import type { JobRow } from './model';

/** The jobs table. Only this file writes SQL against it. */
export const JOBS_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    channel TEXT NOT NULL,
    owner TEXT NOT NULL,
    ip TEXT,
    chat_id INTEGER,
    status_message_id INTEGER,
    ui_lang TEXT NOT NULL DEFAULT 'en',
    source_kind TEXT NOT NULL,
    source TEXT NOT NULL,
    title TEXT,
    duration REAL,
    src_lang TEXT NOT NULL DEFAULT 'auto',
    tgt_lang TEXT NOT NULL DEFAULT 'ar',
    detected_lang TEXT,
    mode TEXT NOT NULL DEFAULT 'soft',
    status TEXT NOT NULL,
    stage TEXT NOT NULL DEFAULT 'queued',
    progress INTEGER NOT NULL DEFAULT 0,
    error_code TEXT,
    error_message TEXT,
    outputs TEXT,
    origin TEXT NOT NULL,
    dispatched INTEGER NOT NULL DEFAULT 0,
    dispatch_attempts INTEGER NOT NULL DEFAULT 0,
    delivered INTEGER NOT NULL DEFAULT 0,
    notified TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS jobs_owner ON jobs (owner, created_at)`,
  `CREATE INDEX IF NOT EXISTS jobs_status ON jobs (status, updated_at)`,
];

export function getJob(env: Env, id: string): Promise<JobRow | null> {
  return env.DB.prepare('SELECT * FROM jobs WHERE id = ?').bind(id).first<JobRow>();
}

export async function insertJob(env: Env, job: JobRow): Promise<void> {
  const cols = Object.keys(job) as (keyof JobRow)[];
  await env.DB.prepare(`INSERT INTO jobs (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .bind(...cols.map((c) => job[c]))
    .run();
}

export async function updateJob(env: Env, id: string, patch: Partial<JobRow>): Promise<void> {
  const cols = Object.keys(patch) as (keyof JobRow)[];
  if (!cols.length) return;
  await env.DB.prepare(`UPDATE jobs SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
    .bind(...cols.map((c) => patch[c] ?? null), now(), id)
    .run();
}

/** Like updateJob, but never overwrites a finished job. Returns false if it was already finished. */
export async function updateActiveJob(env: Env, id: string, patch: Partial<JobRow>): Promise<boolean> {
  const cols = Object.keys(patch) as (keyof JobRow)[];
  const res = await env.DB.prepare(
    `UPDATE jobs SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ?
     WHERE id = ? AND status NOT IN ('done', 'failed', 'cancelled')`,
  )
    .bind(...cols.map((c) => patch[c] ?? null), now(), id)
    .run();
  return res.meta.changes > 0;
}

export async function listJobs(env: Env, owner: string, limit = 30): Promise<JobRow[]> {
  const res = await env.DB.prepare('SELECT * FROM jobs WHERE owner = ? ORDER BY created_at DESC LIMIT ?')
    .bind(owner, limit)
    .all<JobRow>();
  return res.results;
}

export async function countRecent(env: Env, column: 'owner' | 'ip', value: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM jobs WHERE ${column} = ? AND created_at > ? AND status != 'awaiting_upload'`,
  )
    .bind(value, now() - 3600)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function activeJobs(env: Env, owner: string): Promise<JobRow[]> {
  const res = await env.DB.prepare(
    `SELECT * FROM jobs WHERE owner = ? AND status IN ('queued', 'running') ORDER BY created_at DESC`,
  )
    .bind(owner)
    .all<JobRow>();
  return res.results;
}

/** Claims the one-time delivery of a finished job. True for exactly one caller. */
export async function claimDelivery(env: Env, id: string): Promise<boolean> {
  const res = await env.DB.prepare('UPDATE jobs SET delivered = 1 WHERE id = ? AND delivered = 0').bind(id).run();
  return res.meta.changes > 0;
}

/** The Space confirmed a cancelled job is stopped: it no longer counts as handed off. */
export async function confirmBackendCancel(env: Env, id: string): Promise<void> {
  await env.DB.prepare(`UPDATE jobs SET dispatched = 0 WHERE id = ? AND status = 'cancelled'`).bind(id).run();
}

export async function touchActive(env: Env, id: string, ts: number): Promise<void> {
  await env.DB.prepare('UPDATE jobs SET updated_at = ? WHERE id = ? AND status IN (?, ?)')
    .bind(ts, id, 'queued', 'running')
    .run();
}

export async function waitingForDispatch(env: Env, createdBefore: number): Promise<JobRow[]> {
  const res = await env.DB.prepare(`SELECT * FROM jobs WHERE status = 'queued' AND dispatched = 0 AND created_at < ? LIMIT 10`)
    .bind(createdBefore)
    .all<JobRow>();
  return res.results;
}

export async function staleDispatched(env: Env, updatedBefore: number): Promise<JobRow[]> {
  const res = await env.DB.prepare(
    `SELECT * FROM jobs WHERE status IN ('queued', 'running') AND dispatched = 1 AND updated_at < ? LIMIT 10`,
  )
    .bind(updatedBefore)
    .all<JobRow>();
  return res.results;
}

export async function unconfirmedCancels(env: Env, updatedAfter: number): Promise<string[]> {
  const res = await env.DB.prepare(`SELECT id FROM jobs WHERE status = 'cancelled' AND dispatched = 1 AND updated_at > ? LIMIT 10`)
    .bind(updatedAfter)
    .all<{ id: string }>();
  return res.results.map((r) => r.id);
}

export async function purgeOld(env: Env, ts: number): Promise<void> {
  await env.DB.prepare(`DELETE FROM jobs WHERE status = 'awaiting_upload' AND created_at < ?`).bind(ts - 3 * 3600).run();
  await env.DB.prepare(`DELETE FROM jobs WHERE created_at < ?`).bind(ts - 30 * 86400).run();
}
