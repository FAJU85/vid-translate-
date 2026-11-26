import type { AddedColumn } from '../../shared/db';
import { now, type Env } from '../../shared/env';

/**
 * Shares brick storage. Every finished video (subtitles burned in, or dubbed) gets a public page
 * at /v/<id>. Its files are copied from the Space (which keeps them a day) to R2, where they stay
 * until their owner deletes them (or their account): KAVOX never deletes a video by itself.
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
  // Views per video, per day (UTC) and per viewer language (the browser's, e.g. "ar"): numbers only.
  `CREATE TABLE IF NOT EXISTS share_views (
    share_id TEXT NOT NULL,
    day TEXT NOT NULL,
    lang TEXT NOT NULL,
    views INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (share_id, day, lang)
  )`,
];

/** Columns added after the table first shipped. */
export const SHARES_COLUMNS: AddedColumn[] = [
  // link: only people with the link see it; public: also on the creator's profile (and the feed).
  { table: 'shares', column: 'visibility', definition: "TEXT NOT NULL DEFAULT 'link'" },
];

export type Visibility = 'link' | 'public';

/**
 * pending: still on the Space only; ready: copied to R2; failed: the files were gone; removed:
 * taken down after a report (hidden from everyone but its owner, never deleted by KAVOX).
 */
export type ShareStatus = 'pending' | 'ready' | 'failed' | 'removed';

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

/** Visible to others: its files not lost, not taken down (and no end date passed, from older rules). */
const LIVE = "status IN ('pending', 'ready') AND (expires_at IS NULL OR expires_at > ?)";
/** Still its owner's: everything but lost files (a video taken down stays theirs to see and delete). */
const OWNED = "status != 'failed' AND (expires_at IS NULL OR expires_at > ?)";

export const getShare = (env: Env, id: string) =>
  env.DB.prepare(`SELECT * FROM shares WHERE id = ? AND ${LIVE}`).bind(id, now()).first<ShareRow>();

/** A share as its owner sees it: also when taken down after a report. */
export const getOwnShare = (env: Env, id: string) =>
  env.DB.prepare(`SELECT * FROM shares WHERE id = ? AND ${OWNED}`).bind(id, now()).first<ShareRow>();

/** Take a video down after a report: off its page, the profile and the feed, but kept for its owner. */
export const takeDownShare = (env: Env, id: string) =>
  env.DB.prepare("UPDATE shares SET status = 'removed', visibility = 'link' WHERE id = ?").bind(id).run();

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

/** The viewer's language from Accept-Language ("ar-SA,ar;q=0.9" → "ar"); "und" when unknown. */
export function viewerLang(request: Request): string {
  const first = (request.headers.get('Accept-Language') ?? '').split(',')[0].trim().split(/[-_;]/)[0].toLowerCase();
  return /^[a-z]{2,3}$/.test(first) ? first : 'und';
}

/** One more view: the total, and the day's count for the viewer's language. */
export async function countView(env: Env, id: string, lang = 'und'): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('UPDATE shares SET views = views + 1 WHERE id = ?').bind(id),
    env.DB.prepare(
      `INSERT INTO share_views (share_id, day, lang, views) VALUES (?, date('now'), ?, 1)
       ON CONFLICT (share_id, day, lang) DO UPDATE SET views = views + 1`,
    ).bind(id, lang),
  ]);
}

/** Views of some videos since a day ("YYYY-MM-DD"), by day, by video and by language (for analytics). */
export async function viewsSince(env: Env, shareIds: string[], sinceDay: string): Promise<{ share_id: string; day: string; lang: string; views: number }[]> {
  const out: { share_id: string; day: string; lang: string; views: number }[] = [];
  for (let i = 0; i < shareIds.length; i += 90) {
    const part = shareIds.slice(i, i + 90);
    const { results } = await env.DB.prepare(
      `SELECT share_id, day, lang, views FROM share_views WHERE share_id IN (${part.map(() => '?').join(', ')}) AND day >= ?`,
    )
      .bind(...part, sinceDay)
      .all<{ share_id: string; day: string; lang: string; views: number }>();
    out.push(...results);
  }
  return out;
}

/** A person's shares, newest first: by their account, or (no account) by the owner of the jobs. */
export async function listShares(env: Env, who: { accountId?: string | null; owner?: string | null }, limit = 100): Promise<ShareRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM shares WHERE (account_id = ?1 OR owner = ?2) AND ${OWNED.replace('?', '?3')} ORDER BY created_at DESC LIMIT ?4`,
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

/**
 * Posted videos for a feed, newest first: from the given accounts only (null: everyone), after
 * `before` (the last video of the previous page) and created since `since`.
 */
export async function listPostedVideos(
  env: Env,
  f: { accountIds?: string[] | null; before?: { at: number; id: string } | null; since?: number | null; limit: number },
): Promise<ShareRow[]> {
  if (f.accountIds && !f.accountIds.length) return [];
  // D1 takes at most 100 values per query: many accounts are asked in parts, then merged.
  if (f.accountIds && f.accountIds.length > 90) {
    const parts: ShareRow[][] = [];
    for (let i = 0; i < f.accountIds.length; i += 90) parts.push(await listPostedVideos(env, { ...f, accountIds: f.accountIds.slice(i, i + 90) }));
    return parts.flat().sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? 1 : -1)).slice(0, f.limit);
  }
  const where = [`visibility = 'public'`, `account_id IS NOT NULL`, LIVE];
  const binds: unknown[] = [now()];
  if (f.accountIds) (where.push(`account_id IN (${f.accountIds.map(() => '?').join(', ')})`), binds.push(...f.accountIds));
  // After the last one of the previous page (same second: by id, so none is skipped or repeated).
  if (f.before) (where.push('(created_at < ? OR (created_at = ? AND id < ?))'), binds.push(f.before.at, f.before.at, f.before.id));
  if (f.since) (where.push('created_at >= ?'), binds.push(f.since));
  const { results } = await env.DB.prepare(`SELECT * FROM shares WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT ?`)
    .bind(...binds, f.limit)
    .all<ShareRow>();
  return results;
}

/** A posted, live video by its id (what a like is allowed on). */
export const getPostedVideo = (env: Env, id: string) =>
  env.DB.prepare(`SELECT * FROM shares WHERE id = ? AND visibility = 'public' AND ${LIVE}`).bind(id, now()).first<ShareRow>();

/** How many videos an account posted, and how often they were watched (all of them). */
export async function publicTotals(env: Env, accountId: string): Promise<{ videos: number; views: number }> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS videos, COALESCE(SUM(views), 0) AS views FROM shares WHERE account_id = ?1 AND visibility = 'public' AND ${LIVE.replace('?', '?2')}`,
  )
    .bind(accountId, now())
    .first<{ videos: number; views: number }>();
  return { videos: row?.videos ?? 0, views: row?.views ?? 0 };
}

/** `%`, `_` and `\` matched as themselves in a LIKE pattern (with ESCAPE '\'). */
export const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Posted, live videos whose title contains a text (case-insensitive for Latin letters), newest first. */
export async function searchPostedVideos(env: Env, text: string, limit: number): Promise<ShareRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM shares WHERE visibility = 'public' AND account_id IS NOT NULL AND ${LIVE} AND title LIKE ? ESCAPE '\\'
     ORDER BY created_at DESC, id DESC LIMIT ?`,
  )
    .bind(now(), `%${likeEscape(text)}%`, limit)
    .all<ShareRow>();
  return results;
}

/** A video's title (its caption on the profile and in the feed). */
export async function setTitle(env: Env, id: string, title: string | null): Promise<void> {
  await env.DB.prepare('UPDATE shares SET title = ? WHERE id = ?').bind(title, id).run();
}

export async function setVisibility(env: Env, id: string, visibility: Visibility): Promise<void> {
  await env.DB.prepare('UPDATE shares SET visibility = ? WHERE id = ?').bind(visibility, id).run();
}

export async function deleteShareRow(env: Env, id: string): Promise<void> {
  await env.DB.batch([env.DB.prepare('DELETE FROM shares WHERE id = ?').bind(id), env.DB.prepare('DELETE FROM share_views WHERE share_id = ?').bind(id)]);
}
