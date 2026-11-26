import { now, type Env } from '../../shared/env';
import type { AddedColumn } from '../../shared/db';
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
    style TEXT,
    cues TEXT,
    status TEXT NOT NULL,
    stage TEXT NOT NULL DEFAULT 'queued',
    queue_position INTEGER,
    eta INTEGER,
    progress INTEGER NOT NULL DEFAULT 0,
    error_code TEXT,
    error_message TEXT,
    outputs TEXT,
    origin TEXT NOT NULL,
    account_id TEXT,
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

/** Columns added after the first release, for databases created before them. */
export const JOBS_COLUMNS: AddedColumn[] = [
  { table: 'jobs', column: 'style', definition: 'TEXT' },
  { table: 'jobs', column: 'queue_position', definition: 'INTEGER' },
  { table: 'jobs', column: 'eta', definition: 'INTEGER' },
  { table: 'jobs', column: 'cues', definition: 'TEXT' },
  // The signed-in account that asked for the job (accounts brick), when there is one.
  { table: 'jobs', column: 'account_id', definition: 'TEXT' },
  // How each download try went on the Space (learning brick learns the best method per site).
  { table: 'jobs', column: 'downloads', definition: 'TEXT' },
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

/** Whose jobs: those of a signed-in account (website and bot) and those made from one browser. */
export interface JobOwner {
  accountId: string | null;
  owner: string | null;
}

const MINE = "(owner = ?1 OR (account_id IS NOT NULL AND account_id = ?2)) AND status != 'awaiting_upload'";

/** A person's jobs, newest first (their dashboard). */
export async function jobsFor(env: Env, who: JobOwner, limit = 100): Promise<JobRow[]> {
  const res = await env.DB.prepare(`SELECT * FROM jobs WHERE ${MINE} ORDER BY created_at DESC LIMIT ?3`)
    .bind(who.owner ?? '', who.accountId ?? '', limit)
    .all<JobRow>();
  return res.results;
}

export interface JobStats {
  /** Videos translated (re-renders of the same video not counted again). */
  videos: number;
  /** Seconds of video translated. */
  seconds: number;
  by_mode: Record<string, number>;
  /** Most used target languages, most first. */
  languages: { lang: string; videos: number }[];
  last_30_days: { videos: number; seconds: number };
  /** Videos per day for the last 14 days, oldest first (UTC days). */
  per_day: { day: string; videos: number }[];
}

/**
 * Jobs started per UTC day and journey, for the admin's Growth page: lyrics (a lyrics video),
 * dub, video (subtitles burned in) or files (subtitle files). Re-renders and abandoned uploads left out.
 */
export async function jobsPerDay(env: Env, days: number): Promise<{ day: string; journey: string; n: number }[]> {
  const since = Math.floor(Date.now() / 1000 / 86400) * 86400 - (days - 1) * 86400;
  const { results } = await env.DB.prepare(
    `SELECT date(created_at, 'unixepoch') AS day,
            CASE WHEN style LIKE '%"visual":true%' THEN 'lyrics' WHEN mode = 'dub' THEN 'dub' WHEN mode = 'hard' THEN 'video' ELSE 'files' END AS journey,
            COUNT(*) AS n
     FROM jobs WHERE created_at >= ? AND source_kind != 'rerender' AND status != 'awaiting_upload'
     GROUP BY day, journey ORDER BY day`,
  )
    .bind(since)
    .all<{ day: string; journey: string; n: number }>();
  return results;
}

/** What a person has translated: totals, kinds, languages and the last weeks. */
export async function jobStats(env: Env, who: JobOwner): Promise<JobStats> {
  const done = `${MINE} AND status = 'done' AND source_kind != 'rerender'`;
  const bind = (sql: string, ...extra: unknown[]) => env.DB.prepare(sql).bind(who.owner ?? '', who.accountId ?? '', ...extra);
  const since30 = Math.floor(Date.now() / 1000) - 30 * 86400;
  const since14 = Math.floor(Date.now() / 1000 / 86400) * 86400 - 13 * 86400;
  const [totals, modes, langs, recent, days] = await env.DB.batch([
    bind(`SELECT COUNT(*) AS videos, COALESCE(SUM(duration), 0) AS seconds FROM jobs WHERE ${done}`),
    bind(`SELECT mode, COUNT(*) AS n FROM jobs WHERE ${done} GROUP BY mode`),
    bind(`SELECT tgt_lang AS lang, COUNT(*) AS videos FROM jobs WHERE ${done} GROUP BY tgt_lang ORDER BY videos DESC LIMIT 5`),
    bind(`SELECT COUNT(*) AS videos, COALESCE(SUM(duration), 0) AS seconds FROM jobs WHERE ${done} AND created_at >= ?3`, since30),
    bind(`SELECT (created_at / 86400) * 86400 AS day, COUNT(*) AS n FROM jobs WHERE ${done} AND created_at >= ?3 GROUP BY day`, since14),
  ]);
  const t = (totals.results[0] ?? {}) as { videos?: number; seconds?: number };
  const r = (recent.results[0] ?? {}) as { videos?: number; seconds?: number };
  const counts = new Map((days.results as { day: number; n: number }[]).map((d) => [d.day, d.n]));
  return {
    videos: t.videos ?? 0,
    seconds: Math.round(t.seconds ?? 0),
    by_mode: Object.fromEntries((modes.results as { mode: string; n: number }[]).map((m) => [m.mode, m.n])),
    languages: langs.results as { lang: string; videos: number }[],
    last_30_days: { videos: r.videos ?? 0, seconds: Math.round(r.seconds ?? 0) },
    per_day: Array.from({ length: 14 }, (_, i) => {
      const day = since14 + i * 86400;
      return { day: new Date(day * 1000).toISOString().slice(0, 10), videos: counts.get(day) ?? 0 };
    }),
  };
}

/** True once this browser or chat (owner), or this account, has a finished video (invites: "new"). */
export async function hasFinishedVideo(env: Env, owner: string, accountId: string | null): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 AS x FROM jobs WHERE status = 'done' AND source_kind != 'rerender' AND (owner = ? OR account_id = ?) LIMIT 1`,
  )
    .bind(owner, accountId ?? '')
    .first();
  return Boolean(row);
}

/** Every job except unfinished uploads, newest first (the /admin dashboard). */
export async function allJobs(env: Env, limit = 1000): Promise<JobRow[]> {
  const res = await env.DB.prepare(`SELECT * FROM jobs WHERE status != 'awaiting_upload' ORDER BY created_at DESC LIMIT ?`)
    .bind(limit)
    .all<JobRow>();
  return res.results;
}

/** Delete finished jobs (done, failed or cancelled). Returns the ids that were deleted. */
export async function deleteFinishedJobs(env: Env, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const res = await env.DB.prepare(
    `DELETE FROM jobs WHERE id IN (${ids.map(() => '?').join(', ')}) AND status IN ('done', 'failed', 'cancelled') RETURNING id`,
  )
    .bind(...ids)
    .all<{ id: string }>();
  return res.results.map((r) => r.id);
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
/** Jobs this side stopped that the Space must stop too: cancelled ones, and ones stopped for lack of credits. */
const STOPPED_HERE = "(status = 'cancelled' OR (status = 'failed' AND error_code IN ('E_NO_CREDITS', 'E_FREE_LIMIT', 'E_DUB_PAID')))";

export async function confirmBackendCancel(env: Env, id: string): Promise<void> {
  await env.DB.prepare(`UPDATE jobs SET dispatched = 0 WHERE id = ? AND ${STOPPED_HERE}`).bind(id).run();
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
  const res = await env.DB.prepare(`SELECT id FROM jobs WHERE ${STOPPED_HERE} AND dispatched = 1 AND updated_at > ? LIMIT 10`)
    .bind(updatedAfter)
    .all<{ id: string }>();
  return res.results.map((r) => r.id);
}

export async function purgeOld(env: Env, ts: number): Promise<void> {
  await env.DB.prepare(`DELETE FROM jobs WHERE status = 'awaiting_upload' AND created_at < ?`).bind(ts - 3 * 3600).run();
  await env.DB.prepare(`DELETE FROM jobs WHERE created_at < ?`).bind(ts - 30 * 86400).run();
}
