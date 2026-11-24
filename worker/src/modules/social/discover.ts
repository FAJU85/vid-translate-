import { now, type Env } from '../../shared/env';
import { apiError, json } from '../../shared/http';
import { signedInAccount } from '../accounts';
import { publicOrigin } from '../settings';
import { listPostedVideos, searchPostedVideos, type ShareRow } from '../shares';
import { items } from './feed';
import { likesSince, searchProfiles } from './store';

/** A #hashtag: letters (any script), digits and "_", as written in a caption. */
const TAG = /#([\p{L}\p{N}_]{1,50})/gu;
const TAG_NAME = /^[\p{L}\p{N}_]{1,50}$/u;
const TRENDING_DAYS = 7;
/** Trending and tags look at the videos posted in this many days, at most this many of them. */
const POOL_DAYS = 30;
const POOL = 300;
const RESULTS = 30;

/** The #hashtags of a caption, lower-cased, each once. */
export function tagsOf(title: string | null | undefined): string[] {
  return [...new Set([...(title ?? '').matchAll(TAG)].map((m) => m[1].toLowerCase()))];
}

/** Posted videos whose caption has a hashtag, newest first (a word: #cat is not #catalog). */
async function videosWithTag(env: Env, tag: string, limit: number): Promise<ShareRow[]> {
  const found = await searchPostedVideos(env, `#${tag}`, limit * 3);
  return found.filter((v) => tagsOf(v.title).includes(tag)).slice(0, limit);
}

/**
 * GET /api/search?q= (creators by @handle or name, videos by caption; "#tag" searches a hashtag),
 * GET /api/tags/<tag> (the videos with a hashtag, newest first), and GET /api/trending (the most
 * liked videos of the week and the hashtags used most lately).
 */
export async function handleDiscover(request: Request, env: Env, path: string, origin: string): Promise<Response | null> {
  if (request.method !== 'GET') return null;
  const base = await publicOrigin(env, origin);
  const viewer = () => signedInAccount(env, request).then((a) => a?.id ?? null);

  if (path === '/api/search') {
    const q = (new URL(request.url).searchParams.get('q') ?? '').replace(/\s+/g, ' ').trim().slice(0, 50);
    if (!q) return json({ q, creators: [], videos: [], tag: null });
    if (q.startsWith('#')) {
      const tag = q.slice(1).toLowerCase();
      if (!TAG_NAME.test(tag)) return json({ q, creators: [], videos: [], tag: null });
      return json({ q, creators: [], videos: await items(env, await videosWithTag(env, tag, RESULTS), await viewer(), base), tag });
    }
    const name = q.replace(/^@/, '');
    const [creators, videos] = await Promise.all([
      searchProfiles(env, name, 20),
      q.startsWith('@') ? Promise.resolve([]) : searchPostedVideos(env, q, RESULTS),
    ]);
    return json({
      q,
      creators: creators.map((p) => ({ handle: p.handle, display_name: p.display_name, bio: p.bio, followers: p.followers })),
      videos: await items(env, videos, await viewer(), base),
      tag: null,
    });
  }

  const tagPath = path.match(/^\/api\/tags\/([^/]{1,200})$/);
  if (tagPath) {
    let tag: string;
    try {
      tag = decodeURIComponent(tagPath[1]).replace(/^#/, '').toLowerCase();
    } catch {
      return apiError(400, 'E_BAD_REQUEST', 'Not a hashtag.');
    }
    if (!TAG_NAME.test(tag)) return apiError(400, 'E_BAD_REQUEST', 'Not a hashtag.');
    return json({ tag, items: await items(env, await videosWithTag(env, tag, RESULTS), await viewer(), base) });
  }

  if (path === '/api/trending') {
    const ts = now();
    const pool = await listPostedVideos(env, { since: ts - POOL_DAYS * 86400, limit: POOL });
    // Videos: the most liked this week (then the most watched), from those posted in the last 30 days.
    const likes = await likesSince(env, pool.map((v) => v.id), ts - TRENDING_DAYS * 86400);
    const top = [...pool]
      .filter((v) => (likes.get(v.id) ?? 0) > 0 || v.created_at >= ts - TRENDING_DAYS * 86400)
      .sort((a, b) => (likes.get(b.id) ?? 0) - (likes.get(a.id) ?? 0) || b.views - a.views || b.created_at - a.created_at)
      .slice(0, 12);
    // Hashtags: in how many of those videos each one is used.
    const counts = new Map<string, number>();
    for (const v of pool) for (const t of tagsOf(v.title)) counts.set(t, (counts.get(t) ?? 0) + 1);
    const tags = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 15).map(([tag, videos]) => ({ tag, videos }));
    const shown = await items(env, top, await viewer(), base);
    return json({ videos: shown.map((v) => ({ ...v, week_likes: likes.get(v.id) ?? 0 })), tags });
  }
  return null;
}
