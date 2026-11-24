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
