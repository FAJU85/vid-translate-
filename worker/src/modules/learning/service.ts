import type { Env } from '../../shared/env';
import { fileLink, type JobRow } from '../jobs';
import { activeEntries, norm, vote, type Vote } from './store';

/** At most this many rules go with a job (the most taught first). */
const MAX_SENTENCES = 3000;
const MAX_TERMS = 500;
/** Longer "corrections" are rewrites of a whole passage, not something to reuse. */
const MAX_SOURCE_CHARS = 300;
// Written in one database batch; a longer edit counts its first 100 corrected lines.
const MAX_CORRECTIONS_PER_EDIT = 100;

interface Cue {
  start: number;
  end: number;
  text: string;
  translation: string;
}

/** The subtitles a job produced (its cues.json on the Space, kept a day). */
async function originalCues(env: Env, job: JobRow): Promise<{ src: string; cues: Cue[] } | null> {
  const outputs = JSON.parse(job.outputs || '{}') as Record<string, string>;
  if (!outputs.cues) return null;
  const res = await fetch(await fileLink(env, job.id, outputs.cues, 600), { signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!res?.ok) return null;
  const data = (await res.json().catch(() => null)) as { src_lang?: string; cues?: Cue[] } | null;
  return data?.cues ? { src: data.src_lang || job.detected_lang || job.src_lang, cues: data.cues } : null;
}

/**
 * Learn from a person's corrections of a job's translation: each subtitle whose translation they
 * changed (the spoken text and timing unchanged) is one vote for "this text translates like that".
 * Returns how many corrections were counted. Only signed-in accounts teach (one vote each).
 */
export async function learnFromEdit(env: Env, job: JobRow, edited: unknown[], contributor: string | null): Promise<number> {
  if (!contributor || job.status !== 'done') return 0;
  const original = await originalCues(env, job);
  if (!original || !original.src || original.src === 'auto' || original.src === job.tgt_lang) return 0;
  const votes: Vote[] = [];
  for (const [i, raw] of edited.entries()) {
    if (votes.length >= MAX_CORRECTIONS_PER_EDIT) break;
    const before = original.cues[i];
    const after = raw as Partial<Cue> | null;
    if (!before || !after || typeof after.translation !== 'string' || typeof after.text !== 'string') continue;
    const sameLine = norm(after.text) === norm(before.text) && Math.abs(Number(after.start) - before.start) < 0.5;
    const changed = norm(after.translation) !== norm(before.translation);
    if (!sameLine || !changed || !norm(after.translation) || before.text.length > MAX_SOURCE_CHARS) continue;
    votes.push({ kind: 'sentence', src: original.src, tgt: job.tgt_lang, source: before.text, translation: after.translation, contributor });
  }
  await vote(env, votes);
  return votes.length;
}

/** The translation memory sent with a job (backend translation.Memory payload), or none. */
export async function memoryFor(env: Env, job: JobRow): Promise<Record<string, unknown> | null> {
  if (job.source_kind === 'rerender') return null; // nothing is translated again
  const [sentences, terms] = await Promise.all([
    activeEntries(env, job.tgt_lang, 'sentence', MAX_SENTENCES),
    activeEntries(env, job.tgt_lang, 'term', MAX_TERMS),
  ]);
  if (!sentences.length && !terms.length) return null;
  const pack = (e: { src: string; source: string; translation: string }) => ({ src: e.src, source: e.source, translation: e.translation });
  return { sentences: sentences.map(pack), terms: terms.map(pack) };
}
