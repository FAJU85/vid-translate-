import { apiError, json } from '../../shared/http';
import type { Env } from '../../shared/env';
import { publicOrigin } from '../settings';
import { deleteShare } from './service';
import { getShare, listShares, setVisibility, type ShareRow } from './store';

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

/** GET /api/shares (yours), DELETE /api/shares/<id>, and POST /api/shares/<id> {visibility}. */
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
  const body = (await request.json().catch(() => null)) as { visibility?: string } | null;
  if (body?.visibility !== 'link' && body?.visibility !== 'public') return apiError(400, 'E_BAD_REQUEST', 'visibility is link or public.');
  // Posting puts the video on its account's profile: only that account, signed in, may do it (the
  // browser that made the video is not enough). Taking it back to link-only stays open to both.
  if (body.visibility === 'public' && (!share.account_id || viewer.accountId !== share.account_id || !viewer.signedIn)) {
    return apiError(403, 'E_NO_ACCOUNT', share.account_id ? 'Sign in with the account that made this video to post it.' : 'Sign in to post videos to your profile.');
  }
  await setVisibility(env, share.id, body.visibility);
  return json(publicShare({ ...share, visibility: body.visibility }, await publicOrigin(env, origin)));
}
