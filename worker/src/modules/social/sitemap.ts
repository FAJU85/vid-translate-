import type { Env } from '../../shared/env';
import { landingPaths } from '../landing';
import { publicOrigin } from '../settings';
import { listPostedVideos } from '../shares';
import { blockedAmong, profilesByAccounts } from './store';

/** At most this many videos in the sitemap (the newest); the limit for one file is 50,000 addresses. */
const MAX_VIDEOS = 5000;

const xml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
const day = (sec: number) => new Date(sec * 1000).toISOString().slice(0, 10);

/**
 * GET /robots.txt and /sitemap.xml, so search engines find what people posted: every posted
 * video's page and its creator's profile (blocked accounts left out). Link-only videos are never
 * listed and their pages say noindex. Also /google….html, Search Console's ownership check.
 */
export async function handleSeo(request: Request, env: Env, path: string, origin: string): Promise<Response | null> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  // Google Search Console's ownership check (the HTML file method): the file name set on /admin.
  const verify = env.GOOGLE_SITE_VERIFICATION;
  if (verify && path === `/${verify}.html`) {
    return new Response(`google-site-verification: ${verify}.html`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
  const base = await publicOrigin(env, origin);

  if (path === '/robots.txt') {
    const body = ['User-agent: *', 'Disallow: /admin', 'Disallow: /api/', 'Allow: /', '', `Sitemap: ${base}/sitemap.xml`, ''].join('\n');
    return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
  }

  if (path === '/sitemap.xml') {
    const videos = await listPostedVideos(env, { limit: MAX_VIDEOS });
    const owners = [...new Set(videos.map((v) => v.account_id!).filter(Boolean))];
    const blocked = await blockedAmong(env, owners);
    const profiles = await profilesByAccounts(env, owners.filter((id) => !blocked.has(id)));
    const latest = new Map<string, number>(); // a profile changes when its creator posts
    const urls: string[] = [`<url><loc>${xml(`${base}/`)}</loc></url>`, `<url><loc>${xml(`${base}/terms`)}</loc></url>`, `<url><loc>${xml(`${base}/privacy`)}</loc></url>`];
    // The landing pages, each with its other-language version (hreflang).
    for (const p of landingPaths()) {
      const en = p.replace(/^\/ar\//, '/');
      const alts = [['en', en], ['ar', `/ar${en}`]].map(([l, q]) => `<xhtml:link rel="alternate" hreflang="${l}" href="${xml(`${base}${q}`)}"/>`).join('');
      urls.push(`<url><loc>${xml(`${base}${p}`)}</loc>${alts}</url>`);
    }
    for (const v of videos) {
      if (!v.account_id || !profiles.has(v.account_id)) continue;
      latest.set(v.account_id, Math.max(latest.get(v.account_id) ?? 0, v.created_at));
      urls.push(`<url><loc>${xml(`${base}/${v.id}`)}</loc><lastmod>${day(v.created_at)}</lastmod></url>`);
    }
    for (const [id, at] of latest) urls.push(`<url><loc>${xml(`${base}/@${profiles.get(id)!.handle}`)}</loc><lastmod>${day(at)}</lastmod></url>`);
    const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`;
    return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
  }
  return null;
}
