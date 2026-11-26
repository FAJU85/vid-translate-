import type { Env } from '../../shared/env';
import { htmlAttrs, languageName, pageLang, plural, translator } from '../../shared/page-i18n';
import { reportDialog } from '../../shared/report-dialog';
import { FONT, brandHeader, chromeCss, ctaCss, headLinks, makeYourOwn, shareCss, shareRow, tileCss, videoTile, SHARE_IMAGE } from '../../shared/page-chrome';
import { logoSize, publicOrigin, publicSettings } from '../settings';
import { listPublicShares, publicTotals } from '../shares';
import { followCounts, isBlocked, profileByHandle } from './store';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

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

  const lang = pageLang(request);
  const tr = translator(lang);
  const langName = (code: string) => languageName(code, lang);
  const site = await publicSettings(env).catch(() => null);
  const brand = site?.name || 'KAVOX';
  const accent = /^#[0-9a-f]{6}$/i.test(site?.accent ?? '') ? site!.accent : '#2AB8A1';
  const logo = site?.logo_url || undefined;
  const found = await profileByHandle(env, handle);
  const profile = found && !(await isBlocked(env, found.account_id)) ? found : null;
  if (!profile) {
    return new Response(`<!doctype html><html ${htmlAttrs(lang)}><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${tr('Not found')} · ${esc(brand)}</title><style>body{background:#131C31;color:#E2D6C6;font:16px ${FONT};padding:40px;text-align:center}</style><body><p>${tr('No one is called {handle} on {brand}.', { handle: `<bdi dir="ltr">@${esc(handle)}</bdi>`, brand: esc(brand) })}</p><p><a style="color:${accent}" href="/">${esc(brand)}</a></p>`, {
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
  const tiles = videos.map((v) => videoTile({ ...v, has_thumb: Number(v.has_thumb), language: langName(v.tgt_lang) }, tr)).join('');
  const html = `<!doctype html>
<html ${htmlAttrs(lang)}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(name)} (@${esc(profile.handle)}) · ${esc(brand)}</title>
${headLinks(logo)}
<meta name="description" content="${esc(profile.bio || tr('Translated and dubbed videos by @{handle} on {brand}.', { handle: profile.handle, brand }))}">
<meta property="og:type" content="profile">
<meta property="og:site_name" content="${esc(brand)}">
<meta property="og:title" content="${esc(name)} (@${esc(profile.handle)})">
<meta property="og:url" content="${esc(url)}">
<meta property="og:description" content="${esc(profile.bio || tr('Translated and dubbed videos by @{handle} on {brand}.', { handle: profile.handle, brand }))}">
<meta name="twitter:card" content="${videos[0]?.has_thumb ? 'summary_large_image' : 'summary'}">
<meta property="og:image" content="${esc(videos[0]?.has_thumb ? `${base}/v/${videos[0].id}/thumb.jpg` : `${base}${SHARE_IMAGE}`)}">
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
${tileCss}
${shareCss}
${ctaCss}
  .link { background: none; border: 0; padding: 8px 4px; color: #8F8B88; font: inherit; font-size: 13px; cursor: pointer; }
  .link:hover { color: #E2D6C6; text-decoration: underline; }
  footer { max-width: 960px; margin: 0 auto; padding: 16px; color: #8F8B88; font-size: 13px; }
  footer a { color: var(--accent); }
  .empty { color: #ABA59E; text-align: center; padding: 48px 0; }
</style>
</head>
<body>
${brandHeader(esc(brand), logo, logoSize(site))}
<main>
  <div class="head">
    <div class="avatar">${esc(profile.handle[0].toUpperCase())}</div>
    <div>
      <h1>${esc(name)}</h1>
      <div class="handle"><bdi dir="ltr">@${esc(profile.handle)}</bdi></div>
      <div class="stats"><span>${plural(tr, totals.videos, '{n} video', '{n} videos').replace(String(totals.videos), `<b>${totals.videos}</b>`)}</span><span>${plural(tr, follows.followers, '{n} follower', '{n} followers').replace(String(follows.followers), `<b id="followers">${follows.followers}</b>`)}</span><span>${tr('{n} following', { n: `<b>${follows.following}</b>` })}</span><span>${plural(tr, views, '{n} view', '{n} views').replace(String(views), `<b>${views}</b>`)}</span></div>
    </div>
  </div>
  ${profile.bio ? `<p class="bio">${esc(profile.bio)}</p>` : ''}
  <div class="actions"><button class="btn primary" id="follow" type="button" hidden>${tr('Follow')}</button> <button class="btn" id="copy" type="button">${tr('Copy profile link')}</button> <button class="link" type="button" onclick="kavoxReport('profile', ${esc(JSON.stringify(profile.handle))})">${tr('Report')}</button></div>
  ${shareRow(url, tr('Videos by @{handle}, translated and dubbed', { handle: profile.handle }), tr)}
  ${videos.length ? `<div class="grid">${tiles}</div>` : `<p class="empty">${tr('No videos posted yet.')}</p>`}
  ${makeYourOwn(esc(brand), tr)}
</main>
<footer>${tr('Made with {brand}', { brand: `<a href="/">${esc(brand)}</a>` })} · <a href="/terms">${tr('Terms')}</a> · <a href="/privacy">${tr('Privacy')}</a></footer>
${reportDialog('profile', profile.handle, tr)}
<script>
  // Follow: shown once we know who is looking (not on your own profile); signing in happens on the site.
  const followBtn = document.getElementById('follow');
  const api = ${JSON.stringify(`/api/follows/${profile.handle}`)};
  const show = (s) => {
    followBtn.hidden = s.self;
    followBtn.textContent = s.following ? ${JSON.stringify(tr('Following'))} : ${JSON.stringify(tr('Follow'))};
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
    try { await navigator.clipboard.writeText(${JSON.stringify(url)}); e.target.textContent = ${JSON.stringify(tr('Copied'))}; }
    catch { prompt(${JSON.stringify(tr('Copy this link'))}, ${JSON.stringify(url)}); }
  });
</script>
</body>
</html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
