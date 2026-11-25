import type { Env } from '../../shared/env';
import { logoSize, readSettings } from './store';
import { FONT, brandHeader, chromeCss, headLinks } from '../../shared/page-chrome';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * GET /terms: the rules for posting on the platform and how to ask for something to be taken down.
 * Plain defaults with the platform's name and the admin's takedown address; not legal advice.
 */
export async function handleTermsPage(request: Request, env: Env, path: string): Promise<Response | null> {
  if (path !== '/terms' || (request.method !== 'GET' && request.method !== 'HEAD')) return null;
  const settings = (await readSettings(env).catch(() => null))?.settings;
  const brand = esc(settings?.name || 'KAVOX');
  const accent = /^#[0-9a-f]{6}$/i.test(settings?.accent ?? '') ? settings!.accent : '#2AB8A1';
  const logo = settings?.logo ? '/api/logo' : undefined;
  const email = settings?.takedown_email || '';
  const contact = email
    ? `<a href="mailto:${esc(email)}">${esc(email)}</a>`
    : 'the address the platform publishes here (not set yet)';
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Terms of use · ${brand}</title>
${headLinks(logo)}
<style>
  :root { color-scheme: dark; --accent: ${accent}; }
  body { margin: 0; background: #131C31; color: #CBC2B5; font: 15px/1.65 ${FONT}; }
  main { max-width: 760px; margin: 0 auto; padding: 24px 16px 48px; }
  h1 { color: #F9EBD6; font-size: 26px; } h2 { color: #F9EBD6; font-size: 18px; margin-top: 28px; }
  a { color: var(--accent); }
${chromeCss}
</style>
</head>
<body>
<main>
${brandHeader(brand, logo, logoSize(settings))}
<h1>Terms of use</h1>
<p>${brand} translates, subtitles and dubs videos, and lets people post the results on their profile. By using it, and above all by posting a video or a comment, you agree to these terms.</p>

<h2>Your content and other people's rights</h2>
<p>Only translate, post or share videos you have the right to use: your own videos, or videos whose owner allows it (or where the law of your country allows it). You are responsible for what you upload, link, post and comment. Translating a video does not make it yours.</p>

<h2>What is not allowed</h2>
<p>No content that sexualises minors; no sexual content without consent; no harassment, threats or hate against people for who they are; no incitement to violence; no spam, scams or impersonation (pretending to be a person, a brand or ${brand} staff); nothing illegal where you live or where ${brand} operates.</p>

<h2>Reporting and moderation</h2>
<p>Every posted video, comment and profile has a <b>Report</b> button. ${brand} reviews reports and may hide or remove content and block accounts that break these terms, without notice. Removed videos are deleted.</p>

<h2>Copyright and takedown requests</h2>
<p>If a video or comment on ${brand} uses your work without permission, write to ${contact} with: the link to the content, the work you own, your contact details, and a statement that you believe in good faith that the use is not authorised and that your request is accurate. ${brand} removes the content once the request is confirmed, and blocks accounts that repeatedly post others' work.</p>

<h2>No guarantee</h2>
<p>Translations, subtitles and dubbing are made automatically and can contain mistakes. ${brand} is provided as it is, without any guarantee, and may change, limit or stop features at any time.</p>

<h2>Privacy</h2>
<p>${brand} keeps what it needs to run: your account, the videos you translate (for a limited time unless you keep them), what you post, like, follow and report. Reports made while signed out are linked to a keyed fingerprint of the connection, never the address itself. Posted videos, comments and profiles are public; link-only videos are seen only by people with the link.</p>

<p style="margin-top:32px"><a href="/">Back to ${brand}</a></p>
</main>
</body>
</html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
