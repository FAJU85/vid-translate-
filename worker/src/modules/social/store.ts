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

/**
 * Create or change an account's profile. Returns false when the handle is taken (the unique index
 * decides, so two people claiming one handle at once cannot both get it).
 */
export async function saveProfile(
  env: Env,
  accountId: string,
  fields: { handle: string; display_name: string | null; bio: string | null },
  handleChanged: boolean,
): Promise<boolean> {
  const ts = now();
  try {
    await env.DB.prepare(
      `INSERT INTO profiles (account_id, handle, display_name, bio, handle_changed_at, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?5)
       ON CONFLICT (account_id) DO UPDATE SET handle = excluded.handle, display_name = excluded.display_name, bio = excluded.bio,
         handle_changed_at = CASE WHEN ?6 THEN excluded.handle_changed_at ELSE profiles.handle_changed_at END,
         updated_at = excluded.updated_at`,
    )
      .bind(accountId, fields.handle, fields.display_name, fields.bio, ts, handleChanged ? 1 : 0)
      .run();
    return true;
  } catch (err) {
    if (/UNIQUE/i.test(String((err as Error).message))) return false;
    throw err;
  }
}
