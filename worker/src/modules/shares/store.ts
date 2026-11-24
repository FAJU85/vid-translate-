import type { AddedColumn } from '../../shared/db';
import { now, type Env } from '../../shared/env';

/**
 * Shares brick storage. Every finished video (subtitles burned in, or dubbed) gets a public page
 * at /v/<id>. Its files are copied from the Space (which keeps them a day) to R2, where they stay:
 * 30 days for free accounts, until deleted for monthly plans.
 */
export const SHARES_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS shares (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL UNIQUE,
    owner TEXT NOT NULL,
    account_id TEXT,
    title TEXT,
    src_lang TEXT,
    tgt_lang TEXT NOT NULL,
    mode TEXT NOT NULL,
    duration REAL,
    status TEXT NOT NULL,
    size INTEGER,
    has_thumb INTEGER NOT NULL DEFAULT 0,
    copy_attempts INTEGER NOT NULL DEFAULT 0,
    views INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    expires_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS shares_owner ON shares (owner, created_at)`,
  `CREATE INDEX IF NOT EXISTS shares_account ON shares (account_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS shares_status ON shares (status)`,
];

/** Columns added after the table first shipped. */
export const SHARES_COLUMNS: AddedColumn[] = [
  // link: only people with the link see it; public: also on the creator's profile (and the feed).
  { table: 'shares', column: 'visibility', definition: "TEXT NOT NULL DEFAULT 'link'" },
];

export type Visibility = 'link' | 'public';

/** pending: still on the Space only; ready: copied to R2; failed: the files were gone. */
export type ShareStatus = 'pending' | 'ready' | 'failed';

export interface ShareRow {
  id: string;
  job_id: string;
  owner: string;
  account_id: string | null;
  title: string | null;
  src_lang: string | null;
  tgt_lang: string;
  mode: string;
  duration: number | null;
  status: ShareStatus;
  size: number | null;
  has_thumb: number;
  copy_attempts: number;
  views: number;
  created_at: number;
  expires_at: number | null;
  visibility?: Visibility;
}

/** Still visible: not expired, and its files not lost. */
const LIVE = "status != 'failed' AND (expires_at IS NULL OR expires_at > ?)";

export const getShare = (env: Env, id: string) =>
  env.DB.prepare(`SELECT * FROM shares WHERE id = ? AND ${LIVE}`).bind(id, now()).first<ShareRow>();

export const shareForJob = (env: Env, jobId: string) =>
  env.DB.prepare(`SELECT * FROM shares WHERE job_id = ? AND ${LIVE}`).bind(jobId, now()).first<ShareRow>();

export async function insertShare(env: Env, share: ShareRow): Promise<boolean> {
  const cols = Object.keys(share);
  const res = await env.DB.prepare(`INSERT OR IGNORE INTO shares (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .bind(...cols.map((c) => (share as unknown as Record<string, unknown>)[c]))
    .run();
  return Boolean(res.meta.changes);
}

export const updateShare = (env: Env, id: string, patch: Partial<ShareRow>) => {
  const cols = Object.keys(patch);
  return env.DB.prepare(`UPDATE shares SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
    .bind(...cols.map((c) => (patch as Record<string, unknown>)[c]), id)
    .run();
};

export const countView = (env: Env, id: string) => env.DB.prepare('UPDATE shares SET views = views + 1 WHERE id = ?').bind(id).run();

/** A person's shares, newest first: by their account, or (no account) by the owner of the jobs. */
export async function listShares(env: Env, who: { accountId?: string | null; owner?: string | null }, limit = 100): Promise<ShareRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM shares WHERE (account_id = ?1 OR owner = ?2) AND ${LIVE.replace('?', '?3')} ORDER BY created_at DESC LIMIT ?4`,
  )
    .bind(who.accountId ?? '', who.owner ?? '', now(), limit)
    .all<ShareRow>();
  return results;
}

/** How many live links a person has and how often they were watched (all of them, not a page). */
export async function shareTotals(env: Env, who: { accountId?: string | null; owner?: string | null }): Promise<{ shared: number; views: number }> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS shared, COALESCE(SUM(views), 0) AS views FROM shares WHERE (account_id = ?1 OR owner = ?2) AND ${LIVE.replace('?', '?3')}`,
  )
    .bind(who.accountId ?? '', who.owner ?? '', now())
    .first<{ shared: number; views: number }>();
  return { shared: row?.shared ?? 0, views: row?.views ?? 0 };
}

/** An account's videos posted to its profile, newest first. */
export async function listPublicShares(env: Env, accountId: string, limit = 60): Promise<ShareRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM shares WHERE account_id = ?1 AND visibility = 'public' AND ${LIVE.replace('?', '?2')} ORDER BY created_at DESC LIMIT ?3`,
  )
    .bind(accountId, now(), limit)
    .all<ShareRow>();
  return results;
}

export async function setVisibility(env: Env, id: string, visibility: Visibility): Promise<void> {
  await env.DB.prepare('UPDATE shares SET visibility = ? WHERE id = ?').bind(visibility, id).run();
}

export async function deleteShareRow(env: Env, id: string): Promise<void> {
  await env.DB.prepare('DELETE FROM shares WHERE id = ?').bind(id).run();
}
