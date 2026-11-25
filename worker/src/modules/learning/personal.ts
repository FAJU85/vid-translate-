import type { Env } from '../../shared/env';
import type { Person } from '../../shared/person';

/** How many translation corrections a person contributed (the learned entries themselves are not personal). */
export async function exportLearning(env: Env, p: Person) {
  if (!p.accountId) return null;
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM memory_votes WHERE contributor = ?').bind(p.accountId).first<{ n: number }>();
  return { corrections_contributed: row?.n ?? 0 };
}

/** Remove a person's link to their corrections (what was learned from many people stays, unlinked). */
export async function eraseLearning(env: Env, p: Person): Promise<void> {
  if (p.accountId) await env.DB.prepare('DELETE FROM memory_votes WHERE contributor = ?').bind(p.accountId).run();
}
