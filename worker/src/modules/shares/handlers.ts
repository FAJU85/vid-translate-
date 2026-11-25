import { apiError, json } from '../../shared/http';
import type { Env } from '../../shared/env';
import { getAccount } from '../accounts';
import { publicOrigin } from '../settings';
import { announcePost, deleteShare } from './service';
import { getShare, listShares, setTitle, setVisibility, updateShare, type ShareRow } from './store';

/** A caption's longest length (titles from the source video are cut to it when edited). */
const MAX_TITLE = 150;

/** What the website shows of a share. */
export const publicShare = (s: ShareRow, origin: string) => ({
  id: s.id,
  url: `${origin}/${s.id}`,
  job_id: s.job_id,
  title: s.title,
  src_lang: s.src_lang,
  tgt_lang: s.tgt_lang,
  mode: s.mode,
  duration: s.duration,
  views: s.views,
  ready: s.status === 'ready',
  thumb_url: s.has_thumb ? `${origin}/v/${s.id}/thumb.jpg` : null,
  created_at: s.created_at,
  expires_at: s.expires_at,
  /** link: only people with the link; public: also on the creator's profile. */
  visibility: s.visibility ?? 'link',
});

/** Who is asking: their account (signed in, or this browser's guest account) and their jobs' owner. */
export interface ShareViewer {
  accountId: string | null;
  owner: string | null;
  /** accountId is a signed-in account (not this browser's guest account). */
  signedIn?: boolean;
}

/** GET /api/shares (yours), DELETE /api/shares/<id>, and POST /api/shares/<id> {visibility} or {title}. */
export async function handleShares(request: Request, env: Env, path: string, origin: string, viewer: ShareViewer): Promise<Response | null> {
  if (path === '/api/shares' && request.method === 'GET') {
    const base = await publicOrigin(env, origin);
    return json((await listShares(env, viewer)).map((s) => publicShare(s, base)));
  }
  const m = path.match(/^\/api\/shares\/([A-Za-z0-9]{10})$/);
  if (!m || (request.method !== 'DELETE' && request.method !== 'POST')) return null;
  const share = await getShare(env, m[1]);
  if (!share) return apiError(404, 'E_NOT_FOUND', 'This link does not exist any more.');
  const mine = (viewer.accountId && share.account_id === viewer.accountId) || (viewer.owner && share.owner === viewer.owner);
  if (!mine) return apiError(403, 'E_FORBIDDEN', 'This link belongs to someone else.');
  if (request.method === 'DELETE') {
    await deleteShare(env, share.id);
    return json({ ok: true });
  }
  const body = (await request.json().catch(() => null)) as { visibility?: string; title?: unknown } | null;
  // The caption: what the video is called on its page, the profile and the feed (#hashtags work).
  if (body && 'title' in body && !('visibility' in body)) {
    if (typeof body.title !== 'string') return apiError(400, 'E_BAD_REQUEST', 'title is text.');
    const title = body.title.replace(/\s+/g, ' ').trim();
    if (title.length > MAX_TITLE) return apiError(400, 'E_BAD_REQUEST', `A caption has at most ${MAX_TITLE} characters.`);
    await setTitle(env, share.id, title || null);
    return json(publicShare({ ...share, title: title || null }, await publicOrigin(env, origin)));
  }
  if (body?.visibility !== 'link' && body?.visibility !== 'public') return apiError(400, 'E_BAD_REQUEST', 'visibility is link or public.');
  // A video this browser made before signing in (no account, or this browser's guest account)
  // becomes the signed-in account's when it posts it: the browser proves it made it, as for deleting.
  if (body.visibility === 'public' && viewer.signedIn && viewer.accountId && share.account_id !== viewer.accountId && viewer.owner && share.owner === viewer.owner) {
    const before = share.account_id ? await getAccount(env, share.account_id) : null;
    if (!share.account_id || before?.guest_client) {
      await updateShare(env, share.id, { account_id: viewer.accountId });
      share.account_id = viewer.accountId;
    }
  }
  // Posting puts the video on its account's profile: only that account, signed in, may do it (the
  // browser that made the video is not enough). Taking it back to link-only stays open to both.
  if (body.visibility === 'public' && (!share.account_id || viewer.accountId !== share.account_id || !viewer.signedIn)) {
    return apiError(403, 'E_NO_ACCOUNT', share.account_id ? 'Sign in with the account that made this video to post it.' : 'Sign in to post videos to your profile.');
  }
  await setVisibility(env, share.id, body.visibility);
  if (body.visibility === 'public' && share.visibility !== 'public') await announcePost(env, share);
  return json(publicShare({ ...share, visibility: body.visibility }, await publicOrigin(env, origin)));
}
