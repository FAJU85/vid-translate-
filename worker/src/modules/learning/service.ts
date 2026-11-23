import type { Env } from '../../shared/env';
import { fileLink, type JobRow } from '../jobs';
import { activeEntries, norm, vote, type Vote } from './store';

/** At most this many rules go with a job (the most taught first). */
const MAX_SENTENCES = 3000;
const MAX_TERMS = 500;
const MAX_FIXES = 500;
const MAX_SAYS = 500;
/** A speech fix is a few words; a longer change is a rewrite, not a recognition mistake. */
const MAX_FIX_WORDS = 6;
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

/** Words without the punctuation around them (a fix is about words, not commas). */
const bare = (word: string) => word.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, '');

/**
 * The words a person corrected in a recognised line: what is left once the words before and after
 * that are the same in both are set aside. Null when nothing (or too much) changed.
 */
export function speechFix(before: string, after: string): { wrong: string; right: string } | null {
  const a = before.split(/\s+/).map(bare).filter(Boolean);
  const b = after.split(/\s+/).map(bare).filter(Boolean);
  let head = 0;
  while (head < a.length && head < b.length && norm(a[head]) === norm(b[head])) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && norm(a[a.length - 1 - tail]) === norm(b[b.length - 1 - tail])) tail++;
  const wrong = a.slice(head, a.length - tail);
  const right = b.slice(head, b.length - tail);
  if (!wrong.length || !right.length || wrong.length > MAX_FIX_WORDS || right.length > MAX_FIX_WORDS + 2) return null;
  const w = wrong.join(' ');
  const r = right.join(' ');
  return norm(w) && norm(r) && norm(w) !== norm(r) ? { wrong: w, right: r } : null;
}

/**
 * Learn from a person's corrections of a job's subtitles. Each subtitle (at the same time) whose
 * recognised text they changed is one vote for a speech fix ("these words were really those"),
 * and each whose translation they changed is one vote for "this text translates like that".
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
    if (Math.abs(Number(after.start) - before.start) >= 0.5 || before.text.length > MAX_SOURCE_CHARS) continue;
    if (norm(after.text) !== norm(before.text)) {
      const fix = speechFix(before.text, after.text);
      if (!fix) continue; // the line was rewritten, not corrected: nothing to learn from it
      votes.push({ kind: 'fix', src: original.src, tgt: original.src, source: fix.wrong, translation: fix.right, contributor });
    }
    if (norm(after.translation) !== norm(before.translation) && norm(after.translation) && after.text.length <= MAX_SOURCE_CHARS) {
      // The corrected spoken text is what the next job will hear once its speech fixes are applied.
      votes.push({ kind: 'sentence', src: original.src, tgt: job.tgt_lang, source: after.text, translation: after.translation, contributor });
    }
  }
  await vote(env, votes);
  return votes.length;
}

/** The translation memory sent with a job (backend translation.Memory payload), or none. */
export async function memoryFor(env: Env, job: JobRow): Promise<Record<string, unknown> | null> {
  if (job.source_kind === 'rerender') return null; // nothing is translated again
  const [sentences, terms, fixes, says] = await Promise.all([
    activeEntries(env, job.tgt_lang, 'sentence', MAX_SENTENCES),
    activeEntries(env, job.tgt_lang, 'term', MAX_TERMS),
    // Speech fixes are for the spoken language: every language's when it is detected later.
    activeEntries(env, null, 'fix', MAX_FIXES).then((all) =>
      job.src_lang && job.src_lang !== 'auto' ? all.filter((e) => e.src === job.src_lang) : all,
    ),
    // Pronunciations are for the dubbing voice, in the target language.
    job.mode === 'dub' ? activeEntries(env, job.tgt_lang, 'say', MAX_SAYS) : Promise.resolve([]),
  ]);
  if (!sentences.length && !terms.length && !fixes.length && !says.length) return null;
  const pack = (e: { src: string; source: string; translation: string }) => ({ src: e.src, source: e.source, translation: e.translation });
  return { sentences: sentences.map(pack), terms: terms.map(pack), fixes: fixes.map(pack), say: says.map(pack) };
}
