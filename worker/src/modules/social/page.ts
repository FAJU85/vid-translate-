import type { Env } from '../../shared/env';
import { LANGUAGES } from '../../shared/languages';
import { reportDialog } from '../../shared/report-dialog';
import { FONT, brandHeader, chromeCss, headLinks } from '../../shared/page-chrome';
import { publicOrigin, publicSettings } from '../settings';
import { listPublicShares, publicTotals } from '../shares';
import { followCounts, isBlocked, profileByHandle } from './store';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const langName = (code: string) => LANGUAGES.find((l) => l.code === code)?.en ?? code;

/** A profile's address: /@<handle>. */
export const PROFILE_PATH = /^\/@([A-Za-z0-9_.]{1,40})\/?$/;

/** GET /@<handle>: the creator's public page, with the videos they posted. */
export async function handleProfilePage(request: Request, env: Env, path: string, origin: string): Promise<Response | null> {
  const m = path.match(PROFILE_PATH);
  if (!m || (request.method !== 'GET' && request.method !== 'HEAD')) return null;
  const base = await publicOrigin(env, origin);
  const handle = m[1].toLowerCase();
  // One address per profile: lower case, on the public address.
  if (m[1] !== handle || new URL(request.url).host !== new URL(base).host) return Response.redirect(`${base}/@${handle}`, 301);

  const site = await publicSettings(env).catch(() => null);
  const brand = site?.name || 'KAVOX';
  const accent = /^#[0-9a-f]{6}$/i.test(site?.accent ?? '') ? site!.accent : '#2AB8A1';
  const logo = site?.logo_url || undefined;
  const found = await profileByHandle(env, handle);
  const profile = found && !(await isBlocked(env, found.account_id)) ? found : null;
  if (!profile) {
    return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Not found · ${esc(brand)}</title><style>body{background:#131C31;color:#E2D6C6;font:16px ${FONT};padding:40px;text-align:center}</style><body><p>No one is called @${esc(handle)} on ${esc(brand)}.</p><p><a style="color:${accent}" href="/">${esc(brand)}</a></p>`, {
      status: 404,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
  const videos = await listPublicShares(env, profile.account_id);
  const totals = await publicTotals(env, profile.account_id); // every posted video, not just the ones listed
  const follows = await followCounts(env, profile.account_id);
  const views = totals.views;
  const name = profile.display_name || `@${profile.handle}`;
  const url = `${base}/@${profile.handle}`;
  const tiles = videos
    .map((v) => {
      const title = v.title || 'Translated video';
      const thumb = v.has_thumb ? `<img src="/v/${v.id}/thumb.jpg" alt="" loading="lazy">` : '<div class="blank"></div>';
      return `<a class="tile" href="/${v.id}" title="${esc(title)}">${thumb}<span class="badge">${v.mode === 'dub' ? 'Dubbed' : 'Subtitled'} · ${esc(langName(v.tgt_lang))}</span><span class="views">▶ ${v.views}</span></a>`;
    })
    .join('');
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(name)} (@${esc(profile.handle)}) · ${esc(brand)}</title>
${headLinks(logo)}
<meta name="description" content="${esc(profile.bio || `Translated and dubbed videos by @${profile.handle} on ${brand}.`)}">
<meta property="og:type" content="profile">
<meta property="og:site_name" content="${esc(brand)}">
<meta property="og:title" content="${esc(name)} (@${esc(profile.handle)})">
<meta property="og:url" content="${esc(url)}">
${videos[0]?.has_thumb ? `<meta property="og:image" content="${esc(`${base}/v/${videos[0].id}/thumb.jpg`)}">` : ''}
<link rel="canonical" href="${esc(url)}">
<style>
  :root { color-scheme: dark; --accent: ${accent}; }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  body { margin: 0; background: #131C31; color: #E2D6C6; font: 15px/1.55 ${FONT}; }
  header, main { max-width: 960px; margin: 0 auto; padding: 16px; }
${chromeCss}
  .head { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
  .avatar { width: 84px; height: 84px; border-radius: 50%; background: var(--accent); color: #131C31; display: grid; place-items: center; font-size: 36px; font-weight: 800; flex: none; }
  h1 { margin: 0; font-size: 22px; color: #F9EBD6; overflow-wrap: anywhere; }
  .handle { color: #ABA59E; }
  .bio { margin: 12px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
  .stats { display: flex; gap: 18px; margin-top: 10px; color: #CBC2B5; font-size: 14px; }
  .stats b { color: #F9EBD6; }
  .actions { margin-top: 14px; }
  .btn { padding: 8px 14px; border-radius: 10px; border: 1px solid #2E3D63; color: #F9EBD6; background: transparent; font: inherit; cursor: pointer; }
  .btn.primary { background: var(--accent); border-color: var(--accent); color: #131C31; font-weight: 700; }
  .btn.primary.on { background: transparent; color: #F9EBD6; border-color: #2E3D63; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; margin-top: 20px; }
  @media (min-width: 720px) { .grid { grid-template-columns: repeat(4, 1fr); } }
  .tile { position: relative; aspect-ratio: 9 / 16; background: #19243E; border-radius: 6px; overflow: hidden; display: block; }
  .tile img, .tile .blank { width: 100%; height: 100%; object-fit: cover; display: block; }
  .badge, .views { position: absolute; left: 6px; font-size: 11px; color: #F9EBD6; text-shadow: 0 1px 2px #000; }
  .badge { top: 6px; background: rgba(2, 6, 23, .6); padding: 1px 6px; border-radius: 6px; }
  .views { bottom: 6px; font-weight: 700; }
  footer { max-width: 960px; margin: 0 auto; padding: 16px; color: #8F8B88; font-size: 13px; }
  footer a { color: var(--accent); }
  .empty { color: #ABA59E; text-align: center; padding: 48px 0; }
</style>
</head>
<body>
${brandHeader(esc(brand), logo)}
<main>
  <div class="head">
    <div class="avatar">${esc(profile.handle[0].toUpperCase())}</div>
    <div>
      <h1>${esc(name)}</h1>
      <div class="handle">@${esc(profile.handle)}</div>
      <div class="stats"><span><b>${totals.videos}</b> video${totals.videos === 1 ? '' : 's'}</span><span><b id="followers">${follows.followers}</b> follower${follows.followers === 1 ? '' : 's'}</span><span><b>${follows.following}</b> following</span><span><b>${views}</b> view${views === 1 ? '' : 's'}</span></div>
    </div>
  </div>
  ${profile.bio ? `<p class="bio">${esc(profile.bio)}</p>` : ''}
  <div class="actions"><button class="btn primary" id="follow" type="button" hidden>Follow</button> <button class="btn" id="copy" type="button">Copy profile link</button> <button class="btn" type="button" onclick="kavoxReport('profile', ${esc(JSON.stringify(profile.handle))})">Report</button></div>
  ${videos.length ? `<div class="grid">${tiles}</div>` : '<p class="empty">No videos posted yet.</p>'}
</main>
<footer>Made with <a href="/">${esc(brand)}</a> · <a href="/terms">Terms</a></footer>
${reportDialog('profile', profile.handle)}
<script>
  // Follow: shown once we know who is looking (not on your own profile); signing in happens on the site.
  const followBtn = document.getElementById('follow');
  const api = ${JSON.stringify(`/api/follows/${profile.handle}`)};
  const show = (s) => {
    followBtn.hidden = s.self;
    followBtn.textContent = s.following ? 'Following' : 'Follow';
    followBtn.classList.toggle('on', s.following);
    document.getElementById('followers').textContent = s.followers;
  };
  let state = null;
  fetch(api, { credentials: 'same-origin' }).then((r) => r.json()).then((s) => { state = s; show(s); }).catch(() => {});
  followBtn.addEventListener('click', async () => {
    if (!state) return;
    if (!state.signed_in) { location.href = '/?tab=dashboard'; return; }
    followBtn.disabled = true;
    try {
      const r = await fetch(api, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ following: !state.following }) });
      if (r.ok) { state = { ...state, ...(await r.json()) }; show(state); }
    } finally { followBtn.disabled = false; }
  });
  document.getElementById('copy').addEventListener('click', async (e) => {
    try { await navigator.clipboard.writeText(${JSON.stringify(url)}); e.target.textContent = 'Copied'; }
    catch { prompt('Copy this link', ${JSON.stringify(url)}); }
  });
</script>
</body>
</html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
