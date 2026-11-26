import { now, type Env } from '../../shared/env';
import { apiError, json } from '../../shared/http';
import { signedInAccount } from '../accounts';
import { isBlocked, profileByAccount, profileByHandle, type Profile } from './store';

/** The largest photo accepted (the website sends a 256×256 JPEG of about 20–40 KB). */
const MAX_BYTES = 300 * 1024;
const TYPES: Record<string, (b: Uint8Array) => boolean> = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'image/webp': (b) => b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
};

const avatarKey = (accountId: string) => `avatars/${accountId}`;

/** Where a profile's photo is (its version in the address, so it can be kept for long), or null. */
export const avatarUrl = (p: Pick<Profile, 'handle' | 'avatar' | 'avatar_hidden'>): string | null =>
  p.avatar && !p.avatar_hidden ? `/api/avatars/${encodeURIComponent(p.handle)}?v=${p.avatar}` : null;

/**
 * Take a profile photo down after a report: shown to no one any more, but never deleted (it
 * stays the owner's, to replace or delete). A new photo from its owner clears it.
 */
export async function hideAvatar(env: Env, accountId: string, version: number): Promise<boolean> {
  // Only the photo the moderator looked at: a newer one (uploaded meanwhile) is left alone.
  const res = await env.DB.prepare('UPDATE profiles SET avatar_hidden = 1 WHERE account_id = ? AND avatar = ? AND avatar_hidden = 0')
    .bind(accountId, version)
    .run();
  return res.meta.changes > 0;
}

/** Delete a person's photo from storage (Delete my account). */
export async function eraseAvatar(env: Env, accountId: string): Promise<void> {
  if (env.MEDIA) await env.MEDIA.delete(avatarKey(accountId));
}

/**
 * POST /api/profile/avatar (the image itself as the body: JPEG, PNG or WebP) sets your profile
 * photo, DELETE removes it; GET /api/avatars/<handle> shows someone's photo.
 */
export async function handleAvatar(request: Request, env: Env, path: string): Promise<Response | null> {
  const method = request.method;
  if (path === '/api/profile/avatar' && (method === 'POST' || method === 'DELETE')) {
    if (!env.MEDIA) return apiError(501, 'E_NOT_CONFIGURED', 'Photos cannot be stored here.');
    const account = await signedInAccount(env, request);
    if (!account) return apiError(401, 'E_SIGN_IN', 'Sign in first.');
    const profile = await profileByAccount(env, account.id);
    if (!profile) return apiError(400, 'E_NO_PROFILE', 'Choose your @handle first.');
    if (method === 'DELETE') {
      await env.MEDIA.delete(avatarKey(account.id));
      await env.DB.prepare('UPDATE profiles SET avatar = NULL, avatar_hidden = 0, updated_at = ? WHERE account_id = ?').bind(now(), account.id).run();
      return json({ avatar_url: null });
    }
    const type = (request.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
    if (!TYPES[type]) return apiError(400, 'E_BAD_REQUEST', 'The photo must be a JPEG, PNG or WebP image.');
    const declared = Number(request.headers.get('Content-Length'));
    if (declared > MAX_BYTES) return apiError(413, 'E_FILE_TOO_LARGE', 'The photo is too large.');
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_BYTES) return apiError(413, 'E_FILE_TOO_LARGE', 'The photo is too large.');
    if (!TYPES[type](bytes)) return apiError(400, 'E_BAD_REQUEST', 'That file is not the image it says it is.');
    await env.MEDIA.put(avatarKey(account.id), bytes, { httpMetadata: { contentType: type } });
    const version = now();
    await env.DB.prepare('UPDATE profiles SET avatar = ?, avatar_hidden = 0, updated_at = ? WHERE account_id = ?').bind(version, version, account.id).run();
    return json({ avatar_url: avatarUrl({ handle: profile.handle, avatar: version }) });
  }
  const m = path.match(/^\/api\/avatars\/([^/]{1,40})$/);
  if (m && method === 'GET') {
    const profile = await profileByHandle(env, decodeURIComponent(m[1]));
    if (!profile?.avatar || profile.avatar_hidden || !env.MEDIA || (await isBlocked(env, profile.account_id))) return apiError(404, 'E_NOT_FOUND', 'No photo.');
    const object = await env.MEDIA.get(avatarKey(profile.account_id));
    if (!object) return apiError(404, 'E_NOT_FOUND', 'No photo.');
    return new Response(object.body, {
      headers: {
        'Content-Type': object.httpMetadata?.contentType ?? 'image/jpeg',
        // Kept briefly, then asked again: a photo taken down after a report stops showing within
        // minutes (a new photo has a new address anyway).
        'Cache-Control': 'public, max-age=300, must-revalidate',
        'Content-Security-Policy': "default-src 'none'",
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }
  return null;
}
