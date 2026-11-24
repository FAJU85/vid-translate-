import { now, type Env } from '../../shared/env';
import { apiError, json } from '../../shared/http';
import { LANGUAGES } from '../../shared/languages';
import { signedInAccount } from '../accounts';
import { publicOrigin } from '../settings';
import { listShares, viewsSince } from '../shares';

const PERIODS = [7, 30, 90];

/** A language's English name: the app's list first, then the runtime's (a browser can send any). */
function langName(code: string): string {
  if (code === 'und') return 'Unknown';
  const known = LANGUAGES.find((l) => l.code === code)?.en;
  if (known) return known;
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}
const PART = 90;

/** "YYYY-MM-DD" (UTC) of a time. */
const dayOf = (sec: number) => new Date(sec * 1000).toISOString().slice(0, 10);

/** Count rows per video per day since a time, from a table with share_id and created_at. */
async function perDay(env: Env, table: 'likes' | 'comments', ids: string[], since: number) {
  const out: { share_id: string; day: string; n: number }[] = [];
  const visible = table === 'comments' ? "AND status = 'visible'" : '';
  for (let i = 0; i < ids.length; i += PART) {
    const part = ids.slice(i, i + PART);
    const { results } = await env.DB.prepare(
      `SELECT share_id, date(created_at, 'unixepoch') AS day, COUNT(*) AS n FROM ${table}
       WHERE share_id IN (${part.map(() => '?').join(', ')}) AND created_at >= ? ${visible} GROUP BY share_id, day`,
    )
      .bind(...part, since)
      .all<{ share_id: string; day: string; n: number }>();
    out.push(...results);
  }
  return out;
}

/** All-time likes and comments of some videos. */
async function totals(env: Env, table: 'likes' | 'comments', ids: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const visible = table === 'comments' ? "AND status = 'visible'" : '';
  for (let i = 0; i < ids.length; i += PART) {
    const part = ids.slice(i, i + PART);
    const { results } = await env.DB.prepare(
      `SELECT share_id, COUNT(*) AS n FROM ${table} WHERE share_id IN (${part.map(() => '?').join(', ')}) ${visible} GROUP BY share_id`,
    )
      .bind(...part)
      .all<{ share_id: string; n: number }>();
    for (const r of results) counts.set(r.share_id, r.n);
  }
  return counts;
}

/**
 * GET /api/analytics?days=7|30|90: a creator's numbers for their videos. Totals (views, likes,
 * comments, followers), a day-by-day series for the period (views, likes, comments, new
 * followers), each video's numbers, and the languages their viewers' browsers use.
 * Daily views exist from when they started being counted; older views are only in the totals.
 */
export async function handleAnalytics(request: Request, env: Env, path: string, origin: string): Promise<Response | null> {
  if (path !== '/api/analytics' || request.method !== 'GET') return null;
  const account = await signedInAccount(env, request);
  if (!account) return apiError(401, 'E_SIGN_IN', 'Sign in to see your numbers.');
  const asked = Number(new URL(request.url).searchParams.get('days'));
  const days = PERIODS.includes(asked) ? asked : 30;
  const ts = now();
  const since = Math.floor(ts / 86400) * 86400 - (days - 1) * 86400; // midnight UTC, `days` days with today
  const sinceDay = dayOf(since);

  const videos = (await listShares(env, { accountId: account.id }, 500)).filter((s) => s.account_id === account.id);
  const ids = videos.map((v) => v.id);
  const [views, likes, comments, likeTotals, commentTotals, follows] = await Promise.all([
    viewsSince(env, ids, sinceDay),
    perDay(env, 'likes', ids, since),
    perDay(env, 'comments', ids, since),
    totals(env, 'likes', ids),
    totals(env, 'comments', ids),
    env.DB.prepare(
      `SELECT date(created_at, 'unixepoch') AS day, COUNT(*) AS n FROM follows WHERE followee_id = ? AND created_at >= ? GROUP BY day`,
    )
      .bind(account.id, since)
      .all<{ day: string; n: number }>(),
  ]);
  const followers = await env.DB.prepare('SELECT COUNT(*) AS n FROM follows WHERE followee_id = ?').bind(account.id).first<{ n: number }>();

  // The series: one row per day of the period, oldest first.
  const series = Array.from({ length: days }, (_, i) => ({ day: dayOf(since + i * 86400), views: 0, likes: 0, comments: 0, followers: 0 }));
  const at = new Map(series.map((d) => [d.day, d]));
  const periodViews = new Map<string, number>();
  const langs = new Map<string, number>();
  for (const v of views) {
    const d = at.get(v.day);
    if (d) d.views += v.views;
    periodViews.set(v.share_id, (periodViews.get(v.share_id) ?? 0) + v.views);
    langs.set(v.lang, (langs.get(v.lang) ?? 0) + v.views);
  }
  for (const l of likes) at.get(l.day) && (at.get(l.day)!.likes += l.n);
  for (const c of comments) at.get(c.day) && (at.get(c.day)!.comments += c.n);
  for (const f of follows.results) at.get(f.day) && (at.get(f.day)!.followers += f.n);

  const base = await publicOrigin(env, origin);
  const langTotal = [...langs.values()].reduce((a, b) => a + b, 0);
  const sum = (k: 'views' | 'likes' | 'comments' | 'followers') => series.reduce((a, d) => a + d[k], 0);
  return json({
    days,
    totals: {
      videos: videos.length,
      posted: videos.filter((v) => v.visibility === 'public').length,
      views: videos.reduce((a, v) => a + v.views, 0),
      likes: [...likeTotals.values()].reduce((a, b) => a + b, 0),
      comments: [...commentTotals.values()].reduce((a, b) => a + b, 0),
      followers: followers?.n ?? 0,
    },
    period: { views: sum('views'), likes: sum('likes'), comments: sum('comments'), followers: sum('followers') },
    series,
    videos: videos
      .map((v) => ({
        id: v.id,
        title: v.title,
        url: `${base}/${v.id}`,
        thumb_url: v.has_thumb ? `${base}/v/${v.id}/thumb.jpg` : null,
        visibility: v.visibility ?? 'link',
        created_at: v.created_at,
        views: v.views,
        period_views: periodViews.get(v.id) ?? 0,
        likes: likeTotals.get(v.id) ?? 0,
        comments: commentTotals.get(v.id) ?? 0,
      }))
      .sort((a, b) => b.period_views - a.period_views || b.views - a.views || b.created_at - a.created_at),
    languages: [...langs]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([code, n]) => ({
        code,
        name: langName(code),
        views: n,
        share: langTotal ? n / langTotal : 0,
      })),
  });
}
