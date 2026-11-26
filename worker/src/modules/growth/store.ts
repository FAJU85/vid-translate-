import { now, type Env } from '../../shared/env';

/**
 * Growth counts: how people arrive and spread KAVOX, as daily totals per source only. Nothing
 * about a person is kept: no cookie, no IP address, no account, just "12 visits from WhatsApp
 * on 26 Nov". Kept GROWTH_DAYS days.
 */
export const GROWTH_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS growth_daily (
    day TEXT NOT NULL,
    kind TEXT NOT NULL,
    source TEXT NOT NULL,
    n INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, kind, source)
  )`,
];

export const GROWTH_DAYS = 400;
/** visit: someone opened the site; share: a share button was used; install: the app was installed. */
export const KINDS = ['visit', 'share', 'install'] as const;
export type GrowthKind = (typeof KINDS)[number];

const day = (sec: number) => new Date(sec * 1000).toISOString().slice(0, 10);

/** A source as the browser sent it: a short lowercase name, or "other". */
export function cleanSource(raw: unknown): string {
  const s = String(raw ?? '').toLowerCase().trim();
  return /^[a-z0-9][a-z0-9_.-]{0,39}$/.test(s) ? s : 'other';
}

export async function countGrowth(env: Env, kind: GrowthKind, source: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO growth_daily (day, kind, source, n) VALUES (?, ?, ?, 1)
     ON CONFLICT (day, kind, source) DO UPDATE SET n = n + 1`,
  )
    .bind(day(now()), kind, source)
    .run();
}

export interface GrowthRow {
  day: string;
  kind: GrowthKind;
  source: string;
  n: number;
}

/** Every count of the last `days` days (today included). */
export async function growthSince(env: Env, days: number): Promise<GrowthRow[]> {
  const from = day(now() - (days - 1) * 86400);
  const { results } = await env.DB.prepare('SELECT day, kind, source, n FROM growth_daily WHERE day >= ? ORDER BY day').bind(from).all<GrowthRow>();
  return results;
}

/** Counts older than GROWTH_DAYS go (the daily sweep). */
export async function sweepGrowth(env: Env): Promise<void> {
  await env.DB.prepare('DELETE FROM growth_daily WHERE day < ?').bind(day(now() - GROWTH_DAYS * 86400)).run();
}
