import { apiError, json } from '../../shared/http';
import type { Env } from '../../shared/env';
import { deleteShare } from './service';
import { getShare, listShares, type ShareRow } from './store';

/** What the website shows of a share. */
export const publicShare = (s: ShareRow, origin: string) => ({
  id: s.id,
  url: `${origin}/v/${s.id}`,
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
});

/** Who is asking: their account (signed in, or this browser's guest account) and their jobs' owner. */
export interface ShareViewer {
  accountId: string | null;
  owner: string | null;
}

/** GET /api/shares (yours) and DELETE /api/shares/<id>. */
export async function handleShares(request: Request, env: Env, path: string, origin: string, viewer: ShareViewer): Promise<Response | null> {
  if (path === '/api/shares' && request.method === 'GET') {
    return json((await listShares(env, viewer)).map((s) => publicShare(s, origin)));
  }
  const m = path.match(/^\/api\/shares\/([A-Za-z0-9]{10})$/);
  if (m && request.method === 'DELETE') {
    const share = await getShare(env, m[1]);
    if (!share) return apiError(404, 'E_NOT_FOUND', 'This link does not exist any more.');
    const mine = (viewer.accountId && share.account_id === viewer.accountId) || (viewer.owner && share.owner === viewer.owner);
    if (!mine) return apiError(403, 'E_FORBIDDEN', 'This link belongs to someone else.');
    await deleteShare(env, share.id);
    return json({ ok: true });
  }
  return null;
}
