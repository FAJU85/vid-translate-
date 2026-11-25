import type { Env } from '../../shared/env';
import { ownedBy, type Person } from '../../shared/person';

/** A person's jobs, for "Download my data" (what was asked; the files are not kept here). */
export async function exportJobs(env: Env, p: Person) {
  const w = ownedBy(p);
  const { results } = await env.DB.prepare(
    `SELECT id, channel, source_kind, source, title, duration, src_lang, tgt_lang, mode, status, created_at FROM jobs WHERE ${w.sql} ORDER BY created_at DESC`,
  )
    .bind(...w.binds)
    .all();
  return results;
}

/** Delete a person's jobs (the translation server deletes its files within a day by itself). */
export async function eraseJobs(env: Env, p: Person): Promise<number> {
  const w = ownedBy(p);
  const res = await env.DB.prepare(`DELETE FROM jobs WHERE ${w.sql}`).bind(...w.binds).run();
  return res.meta.changes ?? 0;
}
