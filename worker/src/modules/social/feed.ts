import { avatarUrl } from './avatars';
import { now, type Env } from '../../shared/env';
import { apiError, json } from '../../shared/http';
import { signedInAccount } from '../accounts';
import { publicOrigin } from '../settings';
import { countView, getPostedVideo, listPostedVideos, publicShare, viewerLang, type ShareRow } from '../shares';
import { notify } from './notifications';
import {
  blockedAmong,
  commentCounts,
  followCounts,
  followees,
  followingAmong,
  isBlocked,
  isFollowing,
  likesOf,
  profileByHandle,
  profilesByAccounts,
  setFollow,
  setLike,
} from './store';

const PAGE = 10;
/** "For you" picks from the videos posted in this many days, at most this many of them. */
const FOR_YOU_DAYS = 30;
const FOR_YOU_POOL = 300;

/**
 * How high a video ranks in "For you": likes count most, then views, and a video fades with age
 * (a few hours old beats a few weeks old with the same numbers). Plain arithmetic, no profiling.
 */
export function rank(v: { likes: number; views: number; created_at: number }, at = now()): number {
  const hours = Math.max(0, (at - v.created_at) / 3600);
  return (1 + 3 * v.likes + 0.5 * v.views) / Math.pow(hours + 2, 1.3);
}

/** Videos as the feed shows them: the video, its creator, likes, and the viewer's own state. */
export async function items(env: Env, videos: ShareRow[], viewer: string | null, base: string) {
  const ids = videos.map((v) => v.id);
  const accounts = [...new Set(videos.map((v) => v.account_id!).filter(Boolean))];
  const [profiles, likes, following, blocked, comments] = await Promise.all([
    profilesByAccounts(env, accounts),
    likesOf(env, ids, viewer),
    viewer ? followingAmong(env, viewer, accounts) : Promise.resolve(new Set<string>()),
    blockedAmong(env, accounts),
    commentCounts(env, ids),
  ]);
  return videos
    // only creators with a profile, and none an admin blocked
    .filter((v) => v.account_id && profiles.has(v.account_id) && !blocked.has(v.account_id))
    .map((v) => {
      const p = profiles.get(v.account_id!)!;
      return {
        ...publicShare(v, base),
        video_url: `${base}/v/${v.id}/video.mp4`,
        creator: { handle: p.handle, display_name: p.display_name, avatar_url: avatarUrl(p) },
        likes: likes.counts.get(v.id) ?? 0,
        comments: comments.get(v.id) ?? 0,
        liked: likes.liked.has(v.id),
        following: following.has(v.account_id!),
        mine: viewer === v.account_id,
      };
    });
}

/**
 * GET /api/feed?tab=foryou|following&cursor=, POST /api/views/<id>, POST /api/likes/<id> {liked}, and
 * POST /api/follows/<handle> {following}. Liking and following need a signed-in account.
 */
export async function handleFeed(request: Request, env: Env, path: string, origin: string): Promise<Response | null> {
  const url = new URL(request.url);
  const base = await publicOrigin(env, origin);

  if (path === '/api/feed' && request.method === 'GET') {
    const viewer = (await signedInAccount(env, request))?.id ?? null;
    const cursor = url.searchParams.get('cursor') ?? '';
    if (url.searchParams.get('tab') === 'following') {
      if (!viewer) return json({ items: [], next: null, sign_in: true });
      const followed = await followees(env, viewer);
      const [at, id] = cursor.split('_');
      const before = Number(at) > 0 && id ? { at: Number(at), id } : null;
      const videos = await listPostedVideos(env, { accountIds: followed, before, limit: PAGE });
      const last = videos.at(-1);
      return json({ items: await items(env, videos, viewer, base), next: videos.length === PAGE && last ? `${last.created_at}_${last.id}` : null });
    }
    // For you: the recent pool, ranked, paged by position.
    const offset = Math.max(0, Math.min(FOR_YOU_POOL, Number(cursor) || 0));
    const pool = await listPostedVideos(env, { since: now() - FOR_YOU_DAYS * 86400, limit: FOR_YOU_POOL });
    const { counts } = await likesOf(env, pool.map((v) => v.id), null);
    const at = now();
    const ranked = pool
      .map((v) => ({ v, score: rank({ likes: counts.get(v.id) ?? 0, views: v.views, created_at: v.created_at }, at) }))
      .sort((a, b) => b.score - a.score || (a.v.id < b.v.id ? -1 : 1))
      .map((r) => r.v);
    const page = ranked.slice(offset, offset + PAGE);
    return json({ items: await items(env, page, viewer, base), next: offset + PAGE < ranked.length ? String(offset + PAGE) : null });
  }

  // A video watched in the feed (its page counts its own views): told once per card by the site.
  const view = path.match(/^\/api\/views\/([A-Za-z0-9]{10})$/);
  if (view && request.method === 'POST') {
    const video = await getPostedVideo(env, view[1]);
    if (video) await countView(env, video.id, viewerLang(request));
    return json({ ok: true });
  }

  const like = path.match(/^\/api\/likes\/([A-Za-z0-9]{10})$/);
  // A posted video's likes, and whether the signed-in viewer liked it (for its page's button).
  if (like && request.method === 'GET') {
    const video = await getPostedVideo(env, like[1]);
    if (!video) return json({ posted: false, likes: 0, liked: false });
    const viewer = (await signedInAccount(env, request))?.id ?? null;
    const { counts, liked } = await likesOf(env, [video.id], viewer);
    return json({ posted: true, likes: counts.get(video.id) ?? 0, liked: liked.has(video.id), signed_in: Boolean(viewer) });
  }
  if (like && request.method === 'POST') {
    const viewer = await signedInAccount(env, request);
    if (!viewer) return apiError(401, 'E_SIGN_IN', 'Sign in to like videos.');
    if (await isBlocked(env, viewer.id)) return apiError(403, 'E_BLOCKED', 'Your account cannot like videos.');
    const video = await getPostedVideo(env, like[1]);
    if (!video || (video.account_id && (await isBlocked(env, video.account_id)))) return apiError(404, 'E_NOT_FOUND', 'This video is not posted.');
    const body = (await request.json().catch(() => null)) as { liked?: unknown } | null;
    if (typeof body?.liked !== 'boolean') return apiError(400, 'E_BAD_REQUEST', 'liked is true or false.');
    await setLike(env, video.id, viewer.id, body.liked);
    if (body.liked) await notify(env, { to: video.account_id, kind: 'like', actor: viewer.id, shareId: video.id });
    const { counts, liked } = await likesOf(env, [video.id], viewer.id);
    return json({ likes: counts.get(video.id) ?? 0, liked: liked.has(video.id) });
  }

  const follow = path.match(/^\/api\/follows\/([A-Za-z0-9_.]{1,40})$/);
  // A profile's counts and whether the signed-in viewer follows it (for its page's button).
  if (follow && request.method === 'GET') {
    const profile = await profileByHandle(env, follow[1]);
    if (!profile) return apiError(404, 'E_NOT_FOUND', 'No such profile.');
    const viewer = (await signedInAccount(env, request))?.id ?? null;
    return json({
      ...(await followCounts(env, profile.account_id)),
      following: viewer ? await isFollowing(env, viewer, profile.account_id) : false,
      signed_in: Boolean(viewer),
      self: viewer === profile.account_id,
    });
  }
  if (follow && request.method === 'POST') {
    const viewer = await signedInAccount(env, request);
    if (!viewer) return apiError(401, 'E_SIGN_IN', 'Sign in to follow creators.');
    if (await isBlocked(env, viewer.id)) return apiError(403, 'E_BLOCKED', 'Your account cannot follow creators.');
    const profile = await profileByHandle(env, follow[1]);
    if (!profile || (await isBlocked(env, profile.account_id))) return apiError(404, 'E_NOT_FOUND', 'No such profile.');
    if (profile.account_id === viewer.id) return apiError(400, 'E_BAD_REQUEST', 'You cannot follow yourself.');
    const body = (await request.json().catch(() => null)) as { following?: unknown } | null;
    if (typeof body?.following !== 'boolean') return apiError(400, 'E_BAD_REQUEST', 'following is true or false.');
    await setFollow(env, viewer.id, profile.account_id, body.following);
    if (body.following) await notify(env, { to: profile.account_id, kind: 'follow', actor: viewer.id });
    return json({ ...(await followCounts(env, profile.account_id)), following: await isFollowing(env, viewer.id, profile.account_id) });
  }
  return null;
}
