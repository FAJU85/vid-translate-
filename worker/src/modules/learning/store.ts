import { now, type Env } from '../../shared/env';

/**
 * Learning brick storage: the translation memory. Mechanical, not AI: every entry is a plain rule
 * ("this sentence is translated like this", "this term always becomes that") that people taught
 * by correcting translations, or that an admin wrote. Every rule can be seen, edited and removed.
 */
export const LEARNING_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS memory_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    src TEXT NOT NULL,
    tgt TEXT NOT NULL,
    source TEXT NOT NULL,
    source_norm TEXT NOT NULL,
    translation TEXT NOT NULL,
    translation_norm TEXT NOT NULL,
    status TEXT NOT NULL,
    votes INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (kind, src, tgt, source_norm, translation_norm)
  )`,
  `CREATE INDEX IF NOT EXISTS memory_active ON memory_entries (tgt, status, kind)`,
  // Who taught an entry: one vote per signed-in account, so one person cannot teach a rule alone.
  `CREATE TABLE IF NOT EXISTS memory_votes (
    entry_id INTEGER NOT NULL,
    contributor TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (entry_id, contributor)
  )`,
];

/** sentence: a whole subtitle or sentence; term: a word or name in the glossary. */
export type EntryKind = 'sentence' | 'term';
/** candidate: taught, not yet trusted; learned: taught by enough people; approved: by an admin. */
export type EntryStatus = 'candidate' | 'learned' | 'approved' | 'rejected';
/** Different people who must make the same correction before it is used for everyone. */
export const LEARN_VOTES = 3;

export interface MemoryEntry {
  id: number;
  kind: EntryKind;
  src: string;
  tgt: string;
  source: string;
  source_norm: string;
  translation: string;
  translation_norm: string;
  status: EntryStatus;
  votes: number;
  created_at: number;
  updated_at: number;
}

/**
 * The form texts are compared in: lower case, without accents, diacritics (tashkeel), tatweel or
 * punctuation, single spaces (mirrors backend translation/memory.py norm).
 */
export const norm = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/ـ/g, '')
    .replace(/\p{M}/gu, '')
    .replace(/[\p{P}\p{S}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Count one person's correction; the entry is learned once LEARN_VOTES different people made it. */
export async function vote(env: Env, kind: EntryKind, src: string, tgt: string, source: string, translation: string, contributor: string) {
  const ts = now();
  const sn = norm(source);
  const tn = norm(translation);
  if (!sn || !tn || sn === tn) return;
  await env.DB.prepare(
    `INSERT INTO memory_entries (kind, src, tgt, source, source_norm, translation, translation_norm, status, votes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'candidate', 0, ?, ?)
     ON CONFLICT (kind, src, tgt, source_norm, translation_norm) DO NOTHING`,
  )
    .bind(kind, src, tgt, source.trim(), sn, translation.trim(), tn, ts, ts)
    .run();
  const entry = await env.DB.prepare(
    'SELECT id FROM memory_entries WHERE kind = ? AND src = ? AND tgt = ? AND source_norm = ? AND translation_norm = ?',
  )
    .bind(kind, src, tgt, sn, tn)
    .first<{ id: number }>();
  if (!entry) return;
  // One vote per person (a second edit of the same line by the same person changes nothing), then
  // the count and the status, in one batch.
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO memory_votes (entry_id, contributor, created_at) VALUES (?, ?, ?)').bind(entry.id, contributor, ts),
    env.DB.prepare(
      `UPDATE memory_entries SET votes = (SELECT COUNT(*) FROM memory_votes WHERE entry_id = ?1), updated_at = ?2,
         status = CASE WHEN status = 'candidate' AND (SELECT COUNT(*) FROM memory_votes WHERE entry_id = ?1) >= ?3 THEN 'learned' ELSE status END
       WHERE id = ?1`,
    ).bind(entry.id, ts, LEARN_VOTES),
  ]);
}

/**
 * The rules a job uses, for its target language: for each source text one translation (an
 * admin's first, then the one most people taught, then the newest).
 */
export async function activeEntries(env: Env, tgt: string, kind: EntryKind, limit: number): Promise<MemoryEntry[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM (
       SELECT *, ROW_NUMBER() OVER (
         PARTITION BY kind, src, source_norm
         ORDER BY CASE status WHEN 'approved' THEN 0 ELSE 1 END, votes DESC, updated_at DESC
       ) AS pick
       FROM memory_entries WHERE tgt = ? AND kind = ? AND status IN ('learned', 'approved')
     ) WHERE pick = 1 ORDER BY votes DESC, updated_at DESC LIMIT ?`,
  )
    .bind(tgt, kind, limit)
    .all<MemoryEntry>();
  return results;
}

export async function listEntries(env: Env, f: { status?: string; tgt?: string; q?: string }, limit = 200): Promise<MemoryEntry[]> {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (f.status) (where.push('status = ?'), binds.push(f.status));
  if (f.tgt) (where.push('tgt = ?'), binds.push(f.tgt));
  if (f.q) (where.push('(source LIKE ? OR translation LIKE ?)'), binds.push(`%${f.q}%`, `%${f.q}%`));
  const { results } = await env.DB.prepare(
    `SELECT * FROM memory_entries ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY CASE status WHEN 'candidate' THEN 0 ELSE 1 END, votes DESC, updated_at DESC LIMIT ?`,
  )
    .bind(...binds, limit)
    .all<MemoryEntry>();
  return results;
}

export const getEntry = (env: Env, id: number) => env.DB.prepare('SELECT * FROM memory_entries WHERE id = ?').bind(id).first<MemoryEntry>();

/** An admin's own rule (approved at once), or an existing one approved, edited or rejected. */
export async function saveByAdmin(env: Env, e: { kind: EntryKind; src: string; tgt: string; source: string; translation: string }): Promise<number | null> {
  const ts = now();
  const sn = norm(e.source);
  const tn = norm(e.translation);
  if (!sn || !tn) return null;
  await env.DB.prepare(
    `INSERT INTO memory_entries (kind, src, tgt, source, source_norm, translation, translation_norm, status, votes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', 0, ?, ?)
     ON CONFLICT (kind, src, tgt, source_norm, translation_norm) DO UPDATE SET status = 'approved', source = excluded.source,
       translation = excluded.translation, updated_at = excluded.updated_at`,
  )
    .bind(e.kind, e.src, e.tgt, e.source.trim(), sn, e.translation.trim(), tn, ts, ts)
    .run();
  const row = await env.DB.prepare('SELECT id FROM memory_entries WHERE kind = ? AND src = ? AND tgt = ? AND source_norm = ? AND translation_norm = ?')
    .bind(e.kind, e.src, e.tgt, sn, tn)
    .first<{ id: number }>();
  return row?.id ?? null;
}

export async function setStatus(env: Env, id: number, status: EntryStatus): Promise<void> {
  await env.DB.prepare('UPDATE memory_entries SET status = ?, updated_at = ? WHERE id = ?').bind(status, now(), id).run();
}

export async function deleteEntry(env: Env, id: number): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM memory_votes WHERE entry_id = ?').bind(id),
    env.DB.prepare('DELETE FROM memory_entries WHERE id = ?').bind(id),
  ]);
}

/** Counts per status, for the admin page. */
export async function counts(env: Env): Promise<Record<string, number>> {
  const { results } = await env.DB.prepare('SELECT status, COUNT(*) AS n FROM memory_entries GROUP BY status').all<{ status: string; n: number }>();
  return Object.fromEntries(results.map((r) => [r.status, r.n]));
}
