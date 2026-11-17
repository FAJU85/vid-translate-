import { safeEqual } from '../../shared/crypto';
import type { Env } from '../../shared/env';
import { apiError, json } from '../../shared/http';
import { TEXT_FIELDS, readSettings, writeSettings, type Settings } from './store';

const MAX_LOGO_BYTES = 256 * 1024;
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'];
const MAX_TEXT = 2000;

/** True when the request carries the admin password (Authorization: Bearer <ADMIN_PASSWORD>). */
function isAdmin(request: Request, env: Env): boolean {
  const password = env.ADMIN_PASSWORD ?? '';
  if (password.length < 8) return false; // unset or too short: the admin page stays locked
  return safeEqual(request.headers.get('Authorization') ?? '', `Bearer ${password}`);
}

/** What the website needs: the saved values, with the logo as a URL instead of its bytes. */
export async function publicSettings(env: Env): Promise<Omit<Settings, 'logo' | 'welcome_en' | 'welcome_ar'> & { logo_url: string }> {
  const { settings, updatedAt } = await readSettings(env);
  const { logo, welcome_en: _en, welcome_ar: _ar, ...rest } = settings;
  return { ...rest, logo_url: logo ? `/api/logo?v=${updatedAt}` : '' };
}

/** The saved bot welcome message for a language, or '' to use the default. */
export async function welcomeOverride(env: Env, ui: 'en' | 'ar'): Promise<string> {
  const { settings } = await readSettings(env);
  return ui === 'ar' ? settings.welcome_ar : settings.welcome_en;
}

/** POST /api/admin/login: lets the admin page check the password before showing the form. */
export function handleAdminLogin(request: Request, env: Env): Response {
  if (!env.ADMIN_PASSWORD) return apiError(503, 'E_ADMIN_DISABLED', 'Set the ADMIN_PASSWORD secret to enable this page.');
  return isAdmin(request, env) ? json({ ok: true }) : apiError(401, 'E_UNAUTHORIZED', 'Wrong password.');
}

/** GET returns every saved value (welcome messages included); POST saves the fields sent. */
export async function handleAdminSettings(request: Request, env: Env): Promise<Response> {
  if (!isAdmin(request, env)) return apiError(401, 'E_UNAUTHORIZED', 'Wrong password.');
  if (request.method === 'GET') {
    const { settings } = await readSettings(env);
    const { logo, ...rest } = settings;
    return json({ ...rest, has_logo: Boolean(logo) });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return apiError(400, 'E_BAD_REQUEST', 'Expected JSON.');
  const patch: Partial<Settings> = {};
  for (const field of TEXT_FIELDS) {
    if (!(field in body)) continue;
    const value = String(body[field] ?? '').trim();
    if (value.length > MAX_TEXT) return apiError(400, 'E_BAD_REQUEST', `${field} is too long.`);
    patch[field] = value;
  }
  if (patch.accent && !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(patch.accent)) {
    return apiError(400, 'E_BAD_REQUEST', 'The colour must look like #fbbf24.');
  }
  if ('logo' in body) {
    const logo = String(body.logo ?? '');
    if (logo) {
      const match = logo.match(/^data:([a-z+/-]+);base64,([A-Za-z0-9+/=]+)$/);
      if (!match || !LOGO_TYPES.includes(match[1])) {
        return apiError(400, 'E_BAD_REQUEST', 'The logo must be a PNG, JPEG, WebP, GIF or SVG image.');
      }
      if ((match[2].length * 3) / 4 > MAX_LOGO_BYTES) {
        return apiError(400, 'E_BAD_REQUEST', `The logo must be smaller than ${MAX_LOGO_BYTES / 1024} KB.`);
      }
    }
    patch.logo = logo;
  }
  await writeSettings(env, patch);
  return json({ ok: true, ...(await publicSettings(env)) });
}

/** GET /api/logo: the uploaded logo, served from the database. */
export async function serveLogo(env: Env): Promise<Response> {
  const { settings } = await readSettings(env);
  const match = settings.logo.match(/^data:([a-z+/-]+);base64,(.+)$/);
  if (!match) return apiError(404, 'E_NOT_FOUND', 'No logo.');
  const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
  return new Response(bytes, {
    headers: {
      'Content-Type': match[1],
      // The ?v= query changes on every save, so the image can be cached for a while.
      'Cache-Control': 'public, max-age=86400',
      // An SVG could carry scripts: never let it run anything if opened directly.
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
