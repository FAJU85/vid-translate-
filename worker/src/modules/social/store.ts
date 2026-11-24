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
