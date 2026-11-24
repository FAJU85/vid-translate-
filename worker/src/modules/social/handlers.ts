import { now, type Env } from '../../shared/env';
import { apiError, json } from '../../shared/http';
import { signedInAccount } from '../accounts';
import { publicOrigin } from '../settings';
import { listPublicShares, publicShare } from '../shares';
import { HANDLE_CHANGE_DAYS, checkHandle } from './handles';
import { profileByAccount, profileByHandle, saveProfile, type Profile } from './store';

const MAX_NAME = 40;
const MAX_BIO = 160;

const publicProfile = (p: Profile) => ({ handle: p.handle, display_name: p.display_name, bio: p.bio, created_at: p.created_at });

const clean = (value: unknown, max: number): string | null | 'too_long' => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length > max ? 'too_long' : text;
};

/** The @handle and name of an account with a profile (shares brick's creator port). */
export async function creatorFor(env: Env, accountId: string) {
  const p = await profileByAccount(env, accountId);
  return p ? { handle: p.handle, name: p.display_name } : null;
}

/**
 * GET/POST /api/profile/me (your profile; signed-in accounts only), GET /api/handles/<h>
 * (is it free?) and GET /api/profiles/<handle> (a profile with its posted videos).
 */
export async function handleSocial(request: Request, env: Env, path: string, origin: string): Promise<Response | null> {
  const method = request.method;

  if (path === '/api/profile/me') {
    const account = await signedInAccount(env, request);
    if (!account) return apiError(401, 'E_SIGN_IN', 'Sign in to have a profile.');
    const current = await profileByAccount(env, account.id);
    if (method === 'GET') return json({ profile: current ? publicProfile(current) : null, change_days: HANDLE_CHANGE_DAYS });
    if (method !== 'POST') return null;

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return apiError(400, 'E_BAD_REQUEST', 'Expected JSON.');
    const checked = checkHandle(String(body.handle ?? current?.handle ?? ''));
    if ('problem' in checked) {
      return apiError(400, 'E_HANDLE_INVALID', checked.problem === 'reserved'
        ? 'That handle is reserved. Choose another one.'
        : 'A handle has 3 to 24 letters, digits, "_" or "." (not at the start or end).');
    }
    const name = 'display_name' in body ? clean(body.display_name, MAX_NAME) : (current?.display_name ?? null);
    const bio = 'bio' in body ? clean(body.bio, MAX_BIO) : (current?.bio ?? null);
    if (name === 'too_long') return apiError(400, 'E_BAD_REQUEST', `A name has at most ${MAX_NAME} characters.`);
    if (bio === 'too_long') return apiError(400, 'E_BAD_REQUEST', `A bio has at most ${MAX_BIO} characters.`);

    const changed = !current || current.handle !== checked.handle;
    if (current && changed) {
      const wait = current.handle_changed_at + HANDLE_CHANGE_DAYS * 86400 - now();
      if (wait > 0) {
        return apiError(429, 'E_HANDLE_RECENT', `You changed your handle recently. You can change it again in ${Math.ceil(wait / 86400)} day(s).`);
      }
    }
    if (!(await saveProfile(env, account.id, { handle: checked.handle, display_name: name, bio }, changed))) {
      return apiError(409, 'E_HANDLE_TAKEN', `@${checked.handle} is taken. Choose another one.`);
    }
    const saved = await profileByAccount(env, account.id);
    return json({ profile: saved ? publicProfile(saved) : null, url: `${await publicOrigin(env, origin)}/@${checked.handle}` });
  }

  const handleQuery = path.match(/^\/api\/handles\/([^/]{1,40})$/);
  if (handleQuery && method === 'GET') {
    const checked = checkHandle(decodeURIComponent(handleQuery[1]));
    if ('problem' in checked) return json({ available: false, reason: checked.problem });
    const owner = await profileByHandle(env, checked.handle);
    const account = owner ? await signedInAccount(env, request) : null;
    return json({ handle: checked.handle, available: !owner || owner.account_id === account?.id, reason: owner ? 'taken' : null });
  }

  const profileQuery = path.match(/^\/api\/profiles\/([^/]{1,40})$/);
  if (profileQuery && method === 'GET') {
    const profile = await profileByHandle(env, decodeURIComponent(profileQuery[1]).replace(/^@/, ''));
    if (!profile) return apiError(404, 'E_NOT_FOUND', 'No such profile.');
    const base = await publicOrigin(env, origin);
    const videos = await listPublicShares(env, profile.account_id);
    return json({ ...publicProfile(profile), url: `${base}/@${profile.handle}`, videos: videos.map((s) => publicShare(s, base)) });
  }
  return null;
}
