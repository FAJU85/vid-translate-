import { hmacHex } from '../../shared/crypto';
import type { Env } from '../../shared/env';
import { apiError, json } from '../../shared/http';
import { isAdmin } from './admin-auth';
import { LOGO_SIZE, TEXT_FIELDS, readSettings, writeSettings, type Settings } from './store';

const MAX_LOGO_BYTES = 256 * 1024;
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'];
const MAX_TEXT = 2000;

/** A host name such as kavox.to or links.kavox.app (no scheme, path or port). */
const DOMAIN = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** This KAVOX's fingerprint: the same for every address that reaches this Worker, secret-derived. */
export const instanceId = async (env: Env) => (await hmacHex(env.SHARED_SECRET || 'kavox', 'public-domain-check')).slice(0, 24);

/** GET /api/instance: lets the admin page (and a domain check) see which KAVOX an address reaches. */
export async function serveInstance(env: Env): Promise<Response> {
  return json({ service: 'kavox', instance: await instanceId(env) });
}

/** Does https://<domain> reach this very Worker? (A domain saved before it does would break every link.) */
async function reachesThisWorker(env: Env, domain: string): Promise<boolean> {
  try {
    const res = await fetch(`https://${domain}/api/instance`, { signal: AbortSignal.timeout(8000), redirect: 'manual' });
    const body = (await res.json().catch(() => null)) as { instance?: string } | null;
    return res.ok && body?.instance === (await instanceId(env));
  } catch {
    return false;
  }
}

/**
 * The address links are made with: https://<public domain> when the admin set one, else the
 * address the request came in on (the Worker's own workers.dev address).
 */
export async function publicOrigin(env: Env, fallback: string): Promise<string> {
  const { settings } = await readSettings(env).catch(() => ({ settings: { public_domain: '' } }));
  return settings.public_domain ? `https://${settings.public_domain}` : fallback.replace(/\/$/, '');
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

/** GET returns every saved value (welcome messages included); POST saves the fields sent. */
export async function handleAdminSettings(request: Request, env: Env): Promise<Response> {
  if (!(await isAdmin(request, env))) return apiError(401, 'E_UNAUTHORIZED', 'Wrong password.');
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
  if ('logo_size' in body) {
    // A height in pixels; empty (or the default) goes back to the default size.
    const raw = String(body.logo_size ?? '').trim();
    const size = Number(raw);
    if (raw && (!Number.isInteger(size) || size < LOGO_SIZE.min || size > LOGO_SIZE.max)) {
      return apiError(400, 'E_BAD_REQUEST', `The logo size must be ${LOGO_SIZE.min} to ${LOGO_SIZE.max} pixels.`);
    }
    patch.logo_size = raw && size !== LOGO_SIZE.default ? String(size) : '';
  }
  if ('takedown_email' in body) {
    const email = String(body.takedown_email ?? '').trim();
    if (email && !/^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[a-z]{2,63}$/i.test(email)) return apiError(400, 'E_BAD_REQUEST', 'The takedown address must be an email address.');
    patch.takedown_email = email;
  }
  if ('public_domain' in body) {
    // Accept "https://kavox.to/" as well as "kavox.to".
    const domain = String(body.public_domain ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
    if (domain && !DOMAIN.test(domain)) return apiError(400, 'E_BAD_REQUEST', 'The address must look like kavox.to (no https://, no path).');
    const saved = (await readSettings(env)).settings.public_domain;
    if (domain && domain !== saved && !(await reachesThisWorker(env, domain))) {
      return apiError(
        400,
        'E_DOMAIN_NOT_READY',
        `${domain} does not reach this KAVOX yet. In Cloudflare, add it to the Worker as a Custom Domain, wait until it opens, then save again.`,
      );
    }
    patch.public_domain = domain;
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
