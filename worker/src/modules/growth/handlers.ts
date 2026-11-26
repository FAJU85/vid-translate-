import type { Env } from '../../shared/env';
import { apiError, json } from '../../shared/http';
import { KINDS, cleanSource, countGrowth, growthSince, type GrowthKind } from './store';

/** Jobs started per day and journey, from the jobs brick (registered by the Worker's entry). */
export type JobsPerDay = (env: Env, days: number) => Promise<{ day: string; journey: string; n: number }[]>;
let jobsPerDay: JobsPerDay | null = null;
export function registerJobsPerDay(fn: JobsPerDay): void {
  jobsPerDay = fn;
}

/**
 * POST /api/growth {kind, source}: one anonymous count (a visit and where it came from, a share and
 * to which app, an install). Anyone may send it; nothing about the sender is kept.
 */
export async function handleGrowth(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return apiError(405, 'E_BAD_REQUEST', 'POST only.');
  const body = (await request.json().catch(() => null)) as { kind?: unknown; source?: unknown } | null;
  const kind = String(body?.kind ?? '') as GrowthKind;
  if (!KINDS.includes(kind)) return apiError(400, 'E_BAD_REQUEST', 'Unknown kind.');
  await countGrowth(env, kind, cleanSource(body?.source));
  return json({ ok: true });
}

/** GET /api/admin/growth?days=30: the counts and jobs per day (the caller checked the admin). */
export async function handleGrowthAdmin(request: Request, env: Env): Promise<Response> {
  const days = Math.min(365, Math.max(1, Number(new URL(request.url).searchParams.get('days')) || 30));
  const [counts, jobs] = await Promise.all([growthSince(env, days), jobsPerDay ? jobsPerDay(env, days) : Promise.resolve([])]);
  return json({ days, counts, jobs });
}
