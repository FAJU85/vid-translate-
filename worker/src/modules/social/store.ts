import { now, type Env } from '../../shared/env';

/**
 * Social brick storage: each signed-in account's public profile, found by its unique @handle.
 * (Feed, likes, follows and comments come in their own tables.)
 */
export const SOCIAL_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS profiles (
    account_id TEXT PRIMARY KEY,
    handle TEXT NOT NULL UNIQUE,
    display_name TEXT,
    bio TEXT,
    handle_changed_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  // Who follows whom (account ids).
  `CREATE TABLE IF NOT EXISTS follows (
    follower_id TEXT NOT NULL,
    followee_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (follower_id, followee_id)
  )`,
  `CREATE INDEX IF NOT EXISTS follows_followee ON follows (followee_id)`,
  // Likes on posted videos (share ids), one per account.
  `CREATE TABLE IF NOT EXISTS likes (
    share_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (share_id, account_id)
  )`,
  `CREATE INDEX IF NOT EXISTS likes_account ON likes (account_id, created_at)`,
  // Comments on posted videos. hidden: by an admin (still shown to its author's own moderation).
  `CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    share_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    text TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'visible',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS comments_share ON comments (share_id, status, created_at)`,
  `CREATE INDEX IF NOT EXISTS comments_account ON comments (account_id, created_at)`,
  // Reports of a video, a comment or a profile; one per reporter and target.
  `CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    target TEXT NOT NULL,
    reporter TEXT NOT NULL,
    reason TEXT NOT NULL,
    details TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    created_at INTEGER NOT NULL,
    UNIQUE (kind, target, reporter)
  )`,
  `CREATE INDEX IF NOT EXISTS reports_status ON reports (status, kind, target)`,
  // Accounts an admin blocked: hidden from everyone, and they cannot comment, like or follow.
  `CREATE TABLE IF NOT EXISTS blocked_accounts (
    account_id TEXT PRIMARY KEY,
    reason TEXT,
    created_at INTEGER NOT NULL
  )`,
  // Someone's inbox: kind follow | like | comment | post (a creator they follow posted a video).
  // tg_sent: 1 once sent to Telegram, or when it will never be.
  `CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    share_id TEXT,
    comment_id INTEGER,
    created_at INTEGER NOT NULL,
    tg_sent INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS notifications_account ON notifications (account_id, id)`,
  `CREATE INDEX IF NOT EXISTS notifications_tg ON notifications (tg_sent, created_at)`,
  // Per account: the newest notification seen (unread = newer ones) and Telegram messages on/off.
  `CREATE TABLE IF NOT EXISTS notify_prefs (
    account_id TEXT PRIMARY KEY,
    seen_id INTEGER NOT NULL DEFAULT 0,
    telegram INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  )`,
];

export interface Profile {
  account_id: string;
  handle: string;
  display_name: string | null;
  bio: string | null;
  handle_changed_at: number;
  created_at: number;
  updated_at: number;
}

export const profileByAccount = (env: Env, accountId: string) =>
  env.DB.prepare('SELECT * FROM profiles WHERE account_id = ?').bind(accountId).first<Profile>();

export const profileByHandle = (env: Env, handle: string) =>
  env.DB.prepare('SELECT * FROM profiles WHERE handle = ?').bind(handle.toLowerCase()).first<Profile>();

/** ok; taken: someone else has the handle; changed: the profile changed since it was read. */
export type SaveResult = 'ok' | 'taken' | 'changed';

const uniqueClash = (err: unknown) => /UNIQUE/i.test(String((err as Error).message));

/**
 * Write a profile, guarded against requests running at the same time: a new profile only if the
 * account still has none; a new handle only if the handle and its change time are still the ones
 * read (so two quick changes cannot both pass the once-a-week rule, and an older request never
 * puts back an older handle); name and bio alone never touch the handle. The unique index decides
 * between two people claiming one handle at once.
 */
export async function saveProfile(
  env: Env,
  accountId: string,
  read: Profile | null,
  fields: { handle: string; display_name: string | null; bio: string | null },
): Promise<SaveResult> {
  const ts = now();
  try {
    if (!read) {
      const res = await env.DB.prepare(
        `INSERT INTO profiles (account_id, handle, display_name, bio, handle_changed_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?5) ON CONFLICT (account_id) DO NOTHING`,
      )
        .bind(accountId, fields.handle, fields.display_name, fields.bio, ts)
        .run();
      return res.meta.changes ? 'ok' : 'changed';
    }
    if (read.handle !== fields.handle) {
      const res = await env.DB.prepare(
        `UPDATE profiles SET handle = ?1, display_name = ?2, bio = ?3, handle_changed_at = ?4, updated_at = ?4
         WHERE account_id = ?5 AND handle = ?6 AND handle_changed_at = ?7`,
      )
        .bind(fields.handle, fields.display_name, fields.bio, ts, accountId, read.handle, read.handle_changed_at)
        .run();
      return res.meta.changes ? 'ok' : 'changed';
    }
    await env.DB.prepare('UPDATE profiles SET display_name = ?1, bio = ?2, updated_at = ?3 WHERE account_id = ?4')
      .bind(fields.display_name, fields.bio, ts, accountId)
      .run();
    return 'ok';
  } catch (err) {
    if (uniqueClash(err)) return 'taken';
    throw err;
  }
}

/** D1 takes at most 100 values per query: lists are looked up in parts of this size. */
const PART = 90;
async function inParts<T>(ids: string[], run: (part: string[], marks: string) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += PART) {
    const part = ids.slice(i, i + PART);
    out.push(...(await run(part, part.map(() => '?').join(', '))));
  }
  return out;
}

export async function profilesByAccounts(env: Env, ids: string[]): Promise<Map<string, Profile>> {
  const rows = await inParts(ids, async (part, marks) =>
    (await env.DB.prepare(`SELECT * FROM profiles WHERE account_id IN (${marks})`).bind(...part).all<Profile>()).results,
  );
  return new Map(rows.map((p) => [p.account_id, p]));
}

// --- follows -------------------------------------------------------------------------------

export async function setFollow(env: Env, follower: string, followee: string, on: boolean): Promise<void> {
  await (on
    ? env.DB.prepare('INSERT OR IGNORE INTO follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)').bind(follower, followee, now())
    : env.DB.prepare('DELETE FROM follows WHERE follower_id = ? AND followee_id = ?').bind(follower, followee)
  ).run();
}

export async function followCounts(env: Env, accountId: string): Promise<{ followers: number; following: number }> {
  const row = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM follows WHERE followee_id = ?1) AS followers, (SELECT COUNT(*) FROM follows WHERE follower_id = ?1) AS following`,
  )
    .bind(accountId)
    .first<{ followers: number; following: number }>();
  return { followers: row?.followers ?? 0, following: row?.following ?? 0 };
}

export const isFollowing = async (env: Env, follower: string, followee: string) =>
  Boolean(await env.DB.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?').bind(follower, followee).first());

/** The accounts someone follows (for the Following feed). */
export async function followees(env: Env, follower: string, limit = 500): Promise<string[]> {
  const { results } = await env.DB.prepare('SELECT followee_id FROM follows WHERE follower_id = ? ORDER BY created_at DESC LIMIT ?')
    .bind(follower, limit)
    .all<{ followee_id: string }>();
  return results.map((r) => r.followee_id);
}

/** Of these accounts, the ones someone follows. */
export async function followingAmong(env: Env, follower: string, ids: string[]): Promise<Set<string>> {
  const rows = await inParts(ids, async (part, marks) =>
    (await env.DB.prepare(`SELECT followee_id FROM follows WHERE follower_id = ? AND followee_id IN (${marks})`)
      .bind(follower, ...part)
      .all<{ followee_id: string }>()).results,
  );
  return new Set(rows.map((r) => r.followee_id));
}

// --- likes ---------------------------------------------------------------------------------

export async function setLike(env: Env, shareId: string, accountId: string, on: boolean): Promise<void> {
  await (on
    ? env.DB.prepare('INSERT OR IGNORE INTO likes (share_id, account_id, created_at) VALUES (?, ?, ?)').bind(shareId, accountId, now())
    : env.DB.prepare('DELETE FROM likes WHERE share_id = ? AND account_id = ?').bind(shareId, accountId)
  ).run();
}

/** Likes each video got since a time (for "Trending"). */
export async function likesSince(env: Env, shareIds: string[], since: number): Promise<Map<string, number>> {
  const rows = await inParts(shareIds, async (part, marks) =>
    (await env.DB.prepare(`SELECT share_id, COUNT(*) AS n FROM likes WHERE share_id IN (${marks}) AND created_at >= ? GROUP BY share_id`)
      .bind(...part, since)
      .all<{ share_id: string; n: number }>()).results,
  );
  return new Map(rows.map((r) => [r.share_id, r.n]));
}

/** Creators whose @handle starts with, or whose name contains, a text; blocked ones left out. */
export async function searchProfiles(env: Env, text: string, limit: number): Promise<(Profile & { followers: number })[]> {
  const esc = text.replace(/[\\%_]/g, (c) => `\\${c}`);
  const { results } = await env.DB.prepare(
    `SELECT p.*, (SELECT COUNT(*) FROM follows f WHERE f.followee_id = p.account_id) AS followers FROM profiles p
     WHERE (p.handle LIKE ?1 ESCAPE '\\' OR p.display_name LIKE ?2 ESCAPE '\\')
       AND NOT EXISTS (SELECT 1 FROM blocked_accounts b WHERE b.account_id = p.account_id)
     ORDER BY (p.handle = ?3) DESC, followers DESC, p.handle LIMIT ?4`,
  )
    .bind(`${esc}%`, `%${esc}%`, text.toLowerCase(), limit)
    .all<Profile & { followers: number }>();
  return results;
}

/** Likes of each video, and which of them someone liked. */
export async function likesOf(env: Env, shareIds: string[], viewer: string | null): Promise<{ counts: Map<string, number>; liked: Set<string> }> {
  const [counts, mine] = await Promise.all([
    inParts(shareIds, async (part, marks) =>
      (await env.DB.prepare(`SELECT share_id, COUNT(*) AS n FROM likes WHERE share_id IN (${marks}) GROUP BY share_id`)
        .bind(...part)
        .all<{ share_id: string; n: number }>()).results,
    ),
    viewer
      ? inParts(shareIds, async (part, marks) =>
          (await env.DB.prepare(`SELECT share_id FROM likes WHERE account_id = ? AND share_id IN (${marks})`)
            .bind(viewer, ...part)
            .all<{ share_id: string }>()).results,
        )
      : Promise.resolve([] as { share_id: string }[]),
  ]);
  return { counts: new Map(counts.map((r) => [r.share_id, r.n])), liked: new Set(mine.map((r) => r.share_id)) };
}

// --- comments ------------------------------------------------------------------------------

export interface CommentRow {
  id: number;
  share_id: string;
  account_id: string;
  text: string;
  status: 'visible' | 'hidden';
  created_at: number;
}

export async function addComment(env: Env, shareId: string, accountId: string, text: string): Promise<number> {
  const row = await env.DB.prepare('INSERT INTO comments (share_id, account_id, text, created_at) VALUES (?, ?, ?, ?) RETURNING id')
    .bind(shareId, accountId, text, now())
    .first<{ id: number }>();
  return row!.id;
}

export const getComment = (env: Env, id: number) => env.DB.prepare('SELECT * FROM comments WHERE id = ?').bind(id).first<CommentRow>();

/** A video's visible comments by accounts that are not blocked, newest first, before a comment id. */
export async function listComments(env: Env, shareId: string, beforeId: number | null, limit: number): Promise<CommentRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT c.* FROM comments c WHERE c.share_id = ?1 AND c.status = 'visible' AND (?2 IS NULL OR c.id < ?2)
       AND NOT EXISTS (SELECT 1 FROM blocked_accounts b WHERE b.account_id = c.account_id)
     ORDER BY c.id DESC LIMIT ?3`,
  )
    .bind(shareId, beforeId, limit)
    .all<CommentRow>();
  return results;
}

export const deleteComment = (env: Env, id: number) => env.DB.prepare('DELETE FROM comments WHERE id = ?').bind(id).run();
export const setCommentStatus = (env: Env, id: number, status: CommentRow['status']) =>
  env.DB.prepare('UPDATE comments SET status = ? WHERE id = ?').bind(status, id).run();

/** Comments someone wrote recently (the rate limit). */
export async function recentComments(env: Env, accountId: string, seconds: number): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM comments WHERE account_id = ? AND created_at > ?')
    .bind(accountId, now() - seconds)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Visible comments of each video. */
export async function commentCounts(env: Env, shareIds: string[]): Promise<Map<string, number>> {
  const rows = await inParts(shareIds, async (part, marks) =>
    (await env.DB.prepare(
      `SELECT share_id, COUNT(*) AS n FROM comments c WHERE share_id IN (${marks}) AND status = 'visible'
         AND NOT EXISTS (SELECT 1 FROM blocked_accounts b WHERE b.account_id = c.account_id) GROUP BY share_id`,
    )
      .bind(...part)
      .all<{ share_id: string; n: number }>()).results,
  );
  return new Map(rows.map((r) => [r.share_id, r.n]));
}

// --- reports and blocks --------------------------------------------------------------------

export type ReportKind = 'video' | 'comment' | 'profile';
export const REPORT_KINDS: readonly ReportKind[] = ['video', 'comment', 'profile'];
export const REPORT_REASONS = ['copyright', 'spam', 'abuse', 'sexual', 'violence', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** File a report; false when this reporter already reported this target. */
export async function addReport(
  env: Env,
  r: { kind: ReportKind; target: string; reporter: string; reason: ReportReason; details: string | null },
): Promise<boolean> {
  const res = await env.DB.prepare(
    `INSERT INTO reports (kind, target, reporter, reason, details, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (kind, target, reporter) DO NOTHING`,
  )
    .bind(r.kind, r.target, r.reporter, r.reason, r.details, now())
    .run();
  return Boolean(res.meta.changes);
}

/** Reports filed by one reporter recently (the rate limit). */
export async function recentReports(env: Env, reporter: string, seconds: number): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM reports WHERE reporter = ? AND created_at > ?')
    .bind(reporter, now() - seconds)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export interface ReportGroup {
  kind: ReportKind;
  target: string;
  reports: number;
  reasons: string;
  first_at: number;
  last_at: number;
  details: string | null;
}

/** Open reports grouped by what they are about, the most reported first. */
export async function openReports(env: Env, limit = 100): Promise<ReportGroup[]> {
  const { results } = await env.DB.prepare(
    `SELECT kind, target, COUNT(*) AS reports, GROUP_CONCAT(DISTINCT reason) AS reasons, MIN(created_at) AS first_at,
       MAX(created_at) AS last_at, (SELECT details FROM reports r2 WHERE r2.kind = r.kind AND r2.target = r.target AND details IS NOT NULL ORDER BY id DESC LIMIT 1) AS details
     FROM reports r WHERE status = 'open' GROUP BY kind, target ORDER BY reports DESC, last_at DESC LIMIT ?`,
  )
    .bind(limit)
    .all<ReportGroup>();
  return results;
}

/** Close every open report about a target. */
export const closeReports = (env: Env, kind: ReportKind, target: string, status: 'actioned' | 'dismissed') =>
  env.DB.prepare("UPDATE reports SET status = ? WHERE kind = ? AND target = ? AND status = 'open'").bind(status, kind, target).run();

export const blockAccount = (env: Env, accountId: string, reason: string | null) =>
  env.DB.prepare('INSERT INTO blocked_accounts (account_id, reason, created_at) VALUES (?, ?, ?) ON CONFLICT (account_id) DO NOTHING')
    .bind(accountId, reason, now())
    .run();
export const unblockAccount = (env: Env, accountId: string) => env.DB.prepare('DELETE FROM blocked_accounts WHERE account_id = ?').bind(accountId).run();
export const isBlocked = async (env: Env, accountId: string) =>
  Boolean(await env.DB.prepare('SELECT 1 FROM blocked_accounts WHERE account_id = ?').bind(accountId).first());

/** Of these accounts, the blocked ones. */
export async function blockedAmong(env: Env, ids: string[]): Promise<Set<string>> {
  const rows = await inParts(ids, async (part, marks) =>
    (await env.DB.prepare(`SELECT account_id FROM blocked_accounts WHERE account_id IN (${marks})`).bind(...part).all<{ account_id: string }>()).results,
  );
  return new Set(rows.map((r) => r.account_id));
}

export async function listBlocked(env: Env): Promise<{ account_id: string; reason: string | null; created_at: number; handle: string | null }[]> {
  const { results } = await env.DB.prepare(
    'SELECT b.account_id, b.reason, b.created_at, p.handle FROM blocked_accounts b LEFT JOIN profiles p ON p.account_id = b.account_id ORDER BY b.created_at DESC LIMIT 200',
  ).all<{ account_id: string; reason: string | null; created_at: number; handle: string | null }>();
  return results;
}
