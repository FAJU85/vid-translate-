import { now, type Env } from '../../shared/env';
import type { JobRow } from '../jobs';

/**
 * 👍 / 👎 on a finished video: its translation and, for a dubbed one, its voice. One rating per
 * video and aspect (the person who made it may change their mind). Summed per language pair and
 * per voice, they show where KAVOX does well and where it needs correcting (admin, Learning).
 */
export const RATINGS_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS job_ratings (
    job_id TEXT NOT NULL,
    aspect TEXT NOT NULL,
    value INTEGER NOT NULL,
    src TEXT NOT NULL,
    tgt TEXT NOT NULL,
    voice TEXT,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (job_id, aspect)
  )`,
];

export type Aspect = 'translation' | 'voice';
export const ASPECTS: readonly Aspect[] = ['translation', 'voice'];

const voiceOf = (job: JobRow): string => {
  try {
    const voice = (JSON.parse(job.style || '{}') as { voice?: string }).voice;
    return voice === 'male' || voice === 'classic' ? voice : 'female';
  } catch {
    return 'female';
  }
};

/** Save (or change) a rating; false when the job cannot be rated that way. */
export async function rate(env: Env, job: JobRow, aspect: Aspect, value: 1 | -1): Promise<boolean> {
  if (job.status !== 'done' || (aspect === 'voice' && job.mode !== 'dub')) return false;
  const src = job.detected_lang || job.src_lang;
  await env.DB.prepare(
    `INSERT INTO job_ratings (job_id, aspect, value, src, tgt, voice, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (job_id, aspect) DO UPDATE SET value = excluded.value, created_at = excluded.created_at`,
  )
    .bind(job.id, aspect, value, src, job.tgt_lang, aspect === 'voice' ? voiceOf(job) : null, now())
    .run();
  return true;
}

/** A video's own ratings, to show which button is pressed. */
export async function ratingsOf(env: Env, jobId: string): Promise<Partial<Record<Aspect, number>>> {
  const { results } = await env.DB.prepare('SELECT aspect, value FROM job_ratings WHERE job_id = ?').bind(jobId).all<{ aspect: Aspect; value: number }>();
  return Object.fromEntries(results.map((r) => [r.aspect, r.value]));
}

export interface RatingSummary {
  aspect: Aspect;
  src: string;
  tgt: string;
  voice: string | null;
  up: number;
  down: number;
}

/** Thumbs up and down per language pair (translation) and per language and voice (dubbing). */
export async function ratingSummary(env: Env): Promise<RatingSummary[]> {
  const { results } = await env.DB.prepare(
    `SELECT aspect,
       CASE WHEN aspect = 'voice' THEN '' ELSE src END AS src, tgt, voice,
       SUM(value > 0) AS up, SUM(value < 0) AS down
     FROM job_ratings GROUP BY aspect, 2, tgt, voice
     ORDER BY SUM(value < 0) * 1.0 / COUNT(*) DESC, COUNT(*) DESC LIMIT 300`,
  ).all<RatingSummary>();
  return results;
}
