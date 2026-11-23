import { now, type Env } from '../../shared/env';
import type { DownloadTry, JobRow } from '../jobs';

/**
 * How downloads from each site go, by method (the Space's media.STRATEGIES: plain, chrome, ipv4,
 * chrome-ipv4). Mechanical and in the open: counts of tries that worked and failed, nothing more.
 * Older tries weigh less (the counts are halved once a method has DECAY_AT tries), so when a site
 * changes what it accepts, KAVOX follows.
 */
export const SITES_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS site_methods (
    host TEXT NOT NULL,
    strategy TEXT NOT NULL,
    ok REAL NOT NULL DEFAULT 0,
    fail REAL NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (host, strategy)
  )`,
];

const STRATEGY = /^[a-z0-9-]{1,20}$/;
const DECAY_AT = 40;

export interface SiteMethod {
  host: string;
  strategy: string;
  ok: number;
  fail: number;
  updated_at: number;
}

/** The site a link belongs to: its host without "www." or "m." (m.facebook.com is facebook.com). */
export function siteOf(link: string): string | null {
  try {
    const host = new URL(link).hostname.toLowerCase();
    return host.replace(/^(www|m|mobile|web)\./, '') || null;
  } catch {
    return null;
  }
}

/** How likely a method is to work, from its tries (one imagined success and failure each, so a
 * method tried once is not judged on that alone). */
export const score = (m: { ok: number; fail: number }) => (m.ok + 1) / (m.ok + m.fail + 2);

/** Count a finished link job's download tries for its site. */
export async function recordDownloads(env: Env, job: JobRow): Promise<void> {
  if (job.source_kind !== 'url' || !job.downloads) return;
  const host = siteOf(job.source);
  if (!host) return;
  let tries: DownloadTry[];
  try {
    tries = JSON.parse(job.downloads) as DownloadTry[];
  } catch {
    return;
  }
  tries = Array.isArray(tries) ? tries.filter((t) => t && typeof t.strategy === 'string' && STRATEGY.test(t.strategy)) : [];
  // A failed try says something about the method only when the site refused it, or another
  // method then worked: when every try failed the same way, the link itself is bad (a 404).
  const someWorked = tries.some((t) => t.ok);
  tries = tries.filter((t) => t.ok || someWorked || t.code === 'E_SITE_BLOCKED');
  const ts = now();
  const statements = tries
    .slice(0, 8)
    .map((t) =>
      env.DB.prepare(
        `INSERT INTO site_methods (host, strategy, ok, fail, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (host, strategy) DO UPDATE SET
           ok = CASE WHEN site_methods.ok + site_methods.fail >= ${DECAY_AT} THEN site_methods.ok / 2 ELSE site_methods.ok END + excluded.ok,
           fail = CASE WHEN site_methods.ok + site_methods.fail >= ${DECAY_AT} THEN site_methods.fail / 2 ELSE site_methods.fail END + excluded.fail,
           updated_at = excluded.updated_at`,
      ).bind(host, t.strategy, t.ok ? 1 : 0, t.ok ? 0 : 1, ts),
    );
  if (statements.length) await env.DB.batch(statements);
}

/**
 * The download methods to try first for a link job: those that worked more often than not for
 * its site, the best first. The Space tries its built-in order after them.
 */
export async function downloadPlanFor(env: Env, job: JobRow): Promise<string[] | null> {
  const host = job.source_kind === 'url' ? siteOf(job.source) : null;
  if (!host) return null;
  const { results } = await env.DB.prepare('SELECT * FROM site_methods WHERE host = ?').bind(host).all<SiteMethod>();
  const good = results.filter((m) => m.ok > m.fail).sort((a, b) => score(b) - score(a) || b.ok - a.ok);
  return good.length ? good.map((m) => m.strategy) : null;
}

export type SiteStatus = 'working' | 'trouble' | 'unknown';
/** Tries a site needs before its status is said. */
const STATUS_MIN_TRIES = 3;

/**
 * How downloads from a link's site are going, from the counts: "working" when its best method
 * works at least 60% of the time, "trouble" when none works even 40% of the time, otherwise (or
 * with fewer than STATUS_MIN_TRIES tries) "unknown".
 */
export async function siteStatus(env: Env, link: string): Promise<{ host: string | null; status: SiteStatus }> {
  const host = siteOf(link);
  if (!host) return { host: null, status: 'unknown' };
  const { results } = await env.DB.prepare('SELECT * FROM site_methods WHERE host = ?').bind(host).all<SiteMethod>();
  const tries = results.reduce((n, m) => n + m.ok + m.fail, 0);
  if (tries < STATUS_MIN_TRIES) return { host, status: 'unknown' };
  const best = Math.max(...results.map((m) => m.ok / Math.max(1, m.ok + m.fail)));
  return { host, status: best >= 0.6 ? 'working' : best < 0.4 ? 'trouble' : 'unknown' };
}

/** Every site's methods, for the admin page (most used sites first). */
export async function listSites(env: Env, limit = 300): Promise<SiteMethod[]> {
  const { results } = await env.DB.prepare(
    `SELECT m.* FROM site_methods m
     JOIN (SELECT host, SUM(ok + fail) AS n FROM site_methods GROUP BY host) t ON t.host = m.host
     ORDER BY t.n DESC, m.host, m.ok DESC LIMIT ?`,
  )
    .bind(limit)
    .all<SiteMethod>();
  return results;
}

/** A job listener: a link job's download tries are counted once it has finished or failed. */
export const sitesJobListener = {
  changed: async (env: Env, job: JobRow) => {
    if (job.status === 'failed') await recordDownloads(env, job);
  },
  finished: recordDownloads,
};
