import type { Env } from '../../shared/env';
import { ownedBy, type Person } from '../../shared/person';
import { deleteShare } from './service';

/** A person's video pages (posted or link-only), for "Download my data". */
export async function exportShares(env: Env, p: Person) {
  const w = ownedBy(p);
  const { results } = await env.DB.prepare(
    `SELECT id, job_id, title, src_lang, tgt_lang, mode, duration, visibility, views, created_at, expires_at FROM shares WHERE ${w.sql} ORDER BY created_at DESC`,
  )
    .bind(...w.binds)
    .all();
  return results;
}

/** Delete a person's video pages and their files in storage (the video and its picture). */
export async function eraseShares(env: Env, p: Person): Promise<number> {
  const w = ownedBy(p);
  const { results } = await env.DB.prepare(`SELECT id FROM shares WHERE ${w.sql}`).bind(...w.binds).all<{ id: string }>();
  for (const { id } of results) await deleteShare(env, id);
  return results.length;
}
