import type { Env } from '../../shared/env';
import { reportDialog } from '../../shared/report-dialog';
import { MESSAGES, htmlAttrs, languageName, pageLang, plural, translator, type PageLang } from '../../shared/page-i18n';
import { FONT, brandHeader, chromeCss, ctaCss, headLinks, makeYourOwn, tileCss, videoTile } from '../../shared/page-chrome';
import { fileLink } from '../jobs';
import { logoSize, publicOrigin, publicSettings } from '../settings';
import { creatorOf, thumbKey, videoFile, videoKey } from './service';
import { countView, getShare, listPublicShares, viewerLang, type ShareRow } from './store';

/** #hashtags in (escaped) text as links to their videos on the site. */
const tagLinks = (html: string) =>
  html.replace(/(?<!&)#([\p{L}\p{N}_]{1,50})/gu, (m, t: string) => `<a class="tag" href="/?tab=feed&amp;tag=${encodeURIComponent(t.toLowerCase())}">${m}</a>`);

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** The public page of a shared video: the player, what it is, and a download. */
async function page(env: Env, share: ShareRow, origin: string, lang: PageLang): Promise<Response> {
  const tr = translator(lang);
  const langName = (code: string) => languageName(code, lang);
  const site = await publicSettings(env).catch(() => null);
  const brand = site?.name || 'KAVOX';
  const accent = /^#[0-9a-f]{6}$/i.test(site?.accent ?? '') ? site!.accent : '#2AB8A1';
  const logo = site?.logo_url || undefined;
  const url = `${origin}/${share.id}`;
  const files = `${origin}/v/${share.id}`;
  const creator = await creatorOf(env, share);
  const title = share.title || tr('Translated video');
  const what = tr(share.mode === 'dub' ? 'Dubbed' : 'Subtitled');
  const from = share.src_lang && share.src_lang !== 'auto' && share.src_lang !== share.tgt_lang ? `${langName(share.src_lang)} ${lang === 'ar' ? '←' : '→'} ` : '';
  const langs = `${from}${langName(share.tgt_lang)}`;
  const description = tr('{what} in {lang} with {brand}.', { what, lang: langName(share.tgt_lang), brand });
  const thumb = share.has_thumb ? `${files}/thumb.jpg` : '';
  // Posted videos are for everyone, search engines included; link-only ones stay out of search.
  const posted = share.visibility === 'public' && Boolean(share.account_id);
  const ldJson = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name: title,
    description,
    uploadDate: new Date(share.created_at * 1000).toISOString(),
    ...(thumb ? { thumbnailUrl: thumb } : {}),
    contentUrl: `${files}/video.mp4`,
    ...(share.duration ? { duration: `PT${Math.round(share.duration)}S` } : {}),
    inLanguage: share.tgt_lang,
    interactionStatistic: { '@type': 'InteractionCounter', interactionType: { '@type': 'WatchAction' }, userInteractionCount: share.views },
  }).replace(/</g, '\\u003c');
  // More from the same creator (a posted video only): up to six of their other posted videos.
  const more = creator && share.account_id ? (await listPublicShares(env, share.account_id, 7)).filter((v) => v.id !== share.id).slice(0, 6) : [];
  const html = `<!doctype html>
<html ${htmlAttrs(lang)}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · ${esc(brand)}</title>
${headLinks(logo)}
<meta name="description" content="${esc(description)}">
<meta property="og:type" content="video.other">
<meta property="og:site_name" content="${esc(brand)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}">
${thumb ? `<meta property="og:image" content="${esc(thumb)}">` : ''}
<meta property="og:video" content="${esc(files)}/video.mp4">
<meta property="og:video:type" content="video/mp4">
<meta name="twitter:card" content="${thumb ? 'summary_large_image' : 'summary'}">
${posted ? `<link rel="canonical" href="${esc(url)}">
<script type="application/ld+json">${ldJson}</script>` : '<meta name="robots" content="noindex">'}
<style>
  :root { color-scheme: dark; --accent: ${accent}; }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  body { margin: 0; background: #131C31; color: #E2D6C6; font: 15px/1.55 ${FONT}; }
  header, main, footer { max-width: 960px; margin: 0 auto; padding: 16px; }
${chromeCss}
  .player { background: #000; border-radius: 14px; overflow: hidden; display: flex; justify-content: center; }
  video { width: 100%; max-height: 75vh; display: block; background: #000; }
  h1 { font-size: 20px; margin: 16px 0 4px; color: #F9EBD6; overflow-wrap: anywhere; }
  .byline { display: flex; align-items: center; gap: 12px; margin-top: 14px; }
  .creator { display: inline-flex; align-items: center; gap: 8px; color: #F9EBD6; text-decoration: none; font-weight: 600; }
  #follow { padding: 6px 14px; border-radius: 999px; }
  #follow.on { background: transparent; color: #F9EBD6; border-color: #2E3D63; }
  .link { background: none; border: 0; padding: 8px 4px; color: #8F8B88; font: inherit; font-size: 13px; cursor: pointer; }
  .link:hover { color: #E2D6C6; text-decoration: underline; }
  .more h2 { font-size: 17px; color: #F9EBD6; margin: 28px 0 0; }
${tileCss}
${ctaCss}
  #comment-list li { display: grid; grid-template-columns: 32px 1fr; gap: 10px; }
  #comment-list .av { width: 32px; height: 32px; border-radius: 50%; background: #223052; color: #F9EBD6; display: grid; place-items: center; font-weight: 700; font-size: 13px; text-decoration: none; }
  .creator .avatar { width: 32px; height: 32px; border-radius: 50%; background: var(--accent); color: #131C31; display: grid; place-items: center; font-weight: 800; }
  .creator:hover span:last-child { text-decoration: underline; }
  .meta { color: #ABA59E; font-size: 14px; display: flex; flex-wrap: wrap; gap: 6px 14px; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
  .btn { display: inline-flex; align-items: center; gap: 6px; padding: 9px 14px; border-radius: 10px; border: 1px solid #2E3D63; color: #F9EBD6; background: transparent; text-decoration: none; font: inherit; cursor: pointer; }
  .btn:hover { background: #223052; }
  .primary { background: var(--accent); border-color: var(--accent); color: #131C31; font-weight: 700; }
  .primary:hover { filter: brightness(1.1); background: var(--accent); }
  #like[aria-pressed="true"] { border-color: #E87C6A; color: #EE9D8C; }
  #comments { margin-top: 24px; }
  #comments h2 { font-size: 17px; color: #F9EBD6; margin: 0 0 10px; }
  #comment-form { display: flex; gap: 8px; align-items: flex-start; }
  #comment-form textarea { flex: 1; background: #19243E; color: #F9EBD6; border: 1px solid #2E3D63; border-radius: 10px; padding: 8px; font: inherit; resize: vertical; }
  #comment-list { list-style: none; padding: 0; margin: 12px 0 0; }
  #comment-list li { padding: 10px 0; border-top: 1px solid #223052; }
  #comment-list .who { font-size: 13px; color: #ABA59E; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  #comment-list .who a { color: #E2D6C6; font-weight: 600; text-decoration: none; }
  #comment-list .who button { background: none; border: 0; color: #8F8B88; font: inherit; cursor: pointer; padding: 0; }
  #comment-list p { margin: 4px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
  .note { font-size: 13px; color: #ABA59E; }
  h1 .tag { color: var(--accent); text-decoration: none; }
  footer { color: #8F8B88; font-size: 13px; }
  footer a { color: var(--accent); }
</style>
</head>
<body>
${brandHeader(esc(brand), logo, logoSize(site))}
<main>
  <div class="player"><video controls playsinline preload="metadata" src="/v/${share.id}/video.mp4"${thumb ? ` poster="/v/${share.id}/thumb.jpg"` : ''}></video></div>
  ${creator ? `<div class="byline"><a class="creator" href="/@${esc(creator.handle)}"><span class="avatar">${esc(creator.handle[0].toUpperCase())}</span><span dir="ltr">@${esc(creator.handle)}</span></a><button class="btn primary" id="follow" type="button" hidden>${tr('Follow')}</button></div>` : ''}
  <h1>${tagLinks(esc(title))}</h1>
  <div class="meta"><span>${esc(what)} · ${esc(langs)}</span><span>${plural(tr, share.views + 1, '{n} view', '{n} views')}</span></div>
  <div class="actions">
    <button class="btn" id="like" type="button" hidden aria-pressed="false">♡ <span id="likes">0</span></button>
    <button class="btn primary" id="copy" type="button">${tr('Copy link')}</button>
    <a class="btn" href="/v/${share.id}/video.mp4?download=1">${tr('Download')}</a>
    <button class="link" type="button" onclick="kavoxReport('video', ${esc(JSON.stringify(share.id))})">${tr('Report')}</button>
  </div>
  <section id="comments" hidden>
    <h2>${tr('Comments')} <span id="comment-count"></span></h2>
    <form id="comment-form" hidden><textarea id="comment-text" rows="2" maxlength="500" placeholder="${tr('Add a comment')}"></textarea><button class="btn primary" type="submit">${tr('Post')}</button></form>
    <p id="comment-note" class="note"></p>
    <ul id="comment-list"></ul>
    <button class="btn" id="comment-more" type="button" hidden>${tr('More comments')}</button>
  </section>
  ${more.length ? `<section class="more"><h2>${tr('More from {handle}', { handle: `<bdi dir="ltr">@${esc(creator!.handle)}</bdi>` })}</h2><div class="grid">${more.map((v) => videoTile({ ...v, has_thumb: Number(v.has_thumb), language: langName(v.tgt_lang) }, tr)).join('')}</div></section>` : ''}
  ${makeYourOwn(esc(brand), tr)}
</main>
<footer>${tr('Translated with {brand}: subtitles and dubbing for any video, in minutes.', { brand: `<a href="/">${esc(brand)}</a>` })} · <a href="/terms">${tr('Terms')}</a></footer>
${reportDialog('video', share.id, tr)}
${creator ? `<script>
  // Follow the creator from their video (hidden on your own video); signing in happens on the site.
  (() => {
    const btn = document.getElementById('follow');
    const api = ${JSON.stringify(`/api/follows/${creator.handle}`)};
    let state = null;
    const show = (s) => { btn.hidden = s.self; btn.textContent = s.following ? ${JSON.stringify(tr('Following'))} : ${JSON.stringify(tr('Follow'))}; btn.classList.toggle('on', s.following); };
    fetch(api, { credentials: 'same-origin' }).then((r) => r.json()).then((s) => { state = s; show(s); }).catch(() => {});
    btn.addEventListener('click', async () => {
      if (!state) return;
      if (!state.signed_in) { location.href = '/?tab=dashboard'; return; }
      btn.disabled = true;
      try {
        const r = await fetch(api, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ following: !state.following }) });
        if (r.ok) { state = { ...state, ...(await r.json()) }; show(state); }
      } finally { btn.disabled = false; }
    });
  })();
</script>` : ''}
<script>
  // Likes (a posted video only): shown once we know who is looking; signing in happens on the site.
  (() => {
    const btn = document.getElementById('like');
    const api = ${JSON.stringify(`/api/likes/${share.id}`)};
    let state = null;
    const show = (s) => {
      btn.hidden = !s.posted;
      btn.setAttribute('aria-pressed', String(s.liked));
      btn.firstChild.textContent = s.liked ? '♥ ' : '♡ ';
      document.getElementById('likes').textContent = s.likes;
    };
    fetch(api, { credentials: 'same-origin' }).then((r) => r.json()).then((s) => { state = s; show(s); if (s.posted) comments(s.signed_in); }).catch(() => {});
    btn.addEventListener('click', async () => {
      if (!state) return;
      if (!state.signed_in) { location.href = '/?tab=feed'; return; }
      btn.disabled = true;
      try {
        const r = await fetch(api, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ liked: !state.liked }) });
        if (r.ok) { state = { ...state, ...(await r.json()) }; show(state); }
      } finally { btn.disabled = false; }
    });
  })();
  // Comments (a posted video only): anyone reads them; writing needs an account with an @handle.
  function comments(signedIn) {
    const api = ${JSON.stringify(`/api/comments/${share.id}`)};
    const messages = ${JSON.stringify(Object.fromEntries(MESSAGES.map((m) => [m, tr(m)])))};
    const $ = (id) => document.getElementById(id);
    const list = $('comment-list'), more = $('comment-more'), note = $('comment-note');
    let next = null;
    $('comments').hidden = false;
    $('comment-form').hidden = !signedIn;
    if (!signedIn) note.innerHTML = ${JSON.stringify(`<a href="/?tab=dashboard" style="color:var(--accent)">${tr('Sign in')}</a> ${tr('to comment.')}`)};
    // "now", "5m", "3h", "2d", then the date.
    const when = (t) => {
      const d = Date.now() / 1000 - t;
      const n = (u, s) => ({ m: ${JSON.stringify(tr('{n}m'))}, h: ${JSON.stringify(tr('{n}h'))}, d: ${JSON.stringify(tr('{n}d'))} })[u].replace('{n}', Math.floor(d / s));
      if (d < 60) return ${JSON.stringify(tr('now'))};
      if (d < 3600) return n('m', 60);
      if (d < 86400) return n('h', 3600);
      if (d < 7 * 86400) return n('d', 86400);
      return new Date(t * 1000).toLocaleDateString(${JSON.stringify(lang === 'ar' ? 'ar-u-nu-latn-ca-gregory' : 'en')});
    };
    const row = (c) => {
      const li = document.createElement('li');
      const who = document.createElement('div'); who.className = 'who';
      const a = document.createElement('a'); a.href = '/@' + c.author.handle; a.textContent = '@' + c.author.handle; a.dir = 'ltr';
      const d = document.createElement('span'); d.textContent = when(c.created_at);
      const rep = document.createElement('button'); rep.type = 'button'; rep.textContent = ${JSON.stringify(tr('Report'))}; rep.onclick = () => kavoxReport('comment', c.id);
      who.append(a, d, rep);
      if (c.can_delete) {
        const del = document.createElement('button'); del.type = 'button'; del.textContent = ${JSON.stringify(tr('Delete'))};
        del.onclick = async () => {
          if (!confirm(${JSON.stringify(tr('Delete this comment?'))})) return;
          const r = await fetch('/api/comments/' + c.id, { method: 'DELETE', credentials: 'same-origin' }).catch(() => null);
          if (r && r.ok) li.remove();
        };
        who.append(del);
      }
      const p = document.createElement('p'); p.textContent = c.text;
      const av = document.createElement('a'); av.className = 'av'; av.href = '/@' + c.author.handle; av.textContent = c.author.handle[0].toUpperCase(); av.setAttribute('aria-hidden', 'true');
      const body = document.createElement('div'); body.append(who, p);
      li.append(av, body);
      return li;
    };
    const load = async (reset) => {
      const r = await fetch(api + (next && !reset ? '?before=' + next : ''), { credentials: 'same-origin' }).catch(() => null);
      if (!r || !r.ok) return;
      const page = await r.json();
      if (reset) list.textContent = '';
      page.items.forEach((c) => list.append(row(c)));
      next = page.next;
      more.hidden = !next;
      if (!list.children.length && !signedIn) note.innerHTML = ${JSON.stringify(`${tr('No comments yet.')} <a href="/?tab=dashboard" style="color:var(--accent)">${tr('Sign in')}</a> ${tr('to write the first.')}`)};
    };
    more.onclick = () => load(false);
    $('comment-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = $('comment-text').value.trim();
      if (!text) return;
      const btn = e.target.querySelector('button'); btn.disabled = true;
      try {
        const r = await fetch(api, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
        if (r.ok) { $('comment-text').value = ''; note.textContent = ''; next = null; await load(true); }
        else {
          const said = ((await r.json().catch(() => null)) || {}).message;
          note.textContent = (said && said in messages ? messages[said] : said) || ${JSON.stringify(tr('Could not post the comment.'))};
        }
      } finally { btn.disabled = false; }
    });
    load(true);
  }
  document.getElementById('copy').addEventListener('click', async (e) => {
    try { await navigator.clipboard.writeText(${JSON.stringify(url)}); e.target.textContent = ${JSON.stringify(tr('Copied'))}; }
    catch { prompt(${JSON.stringify(tr('Copy this link'))}, ${JSON.stringify(url)}); }
  });
</script>
</body>
</html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

/** A file of a share from R2, with byte ranges (seeking in the player). */
async function fromR2(env: Env, request: Request, key: string, download: string | null): Promise<Response | null> {
  const object = await env.MEDIA!.get(key, { range: request.headers, onlyIf: request.headers });
  if (!object) return null;
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('ETag', object.httpEtag);
  headers.set('Accept-Ranges', 'bytes');
  if (download) headers.set('Content-Disposition', `attachment; filename="${download}"`);
  if (!('body' in object)) return new Response(null, { status: 304, headers }); // not modified
  const range = object.range as { offset?: number; length?: number } | undefined;
  if (range && request.headers.has('Range')) {
    const offset = range.offset ?? 0;
    const length = range.length ?? object.size - offset;
    headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set('Content-Length', String(length));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set('Content-Length', String(object.size));
  return new Response(object.body, { headers });
}

/** A share's short address: /<10 characters> (the ids never use 0, O, 1, l or I). */
export const SHORT_PATH = /^\/([A-HJ-NP-Za-km-z2-9]{10})\/?$/;

/**
 * GET /<id> (the page), /v/<id>/video.mp4 (?download=1) and /v/<id>/thumb.jpg. The page's old
 * address /v/<id> sends people to /<id> on the public address.
 */
export async function handleSharePage(request: Request, env: Env, path: string, origin: string): Promise<Response | null> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const short = path.match(SHORT_PATH);
  const m = short ? ([path, short[1], undefined] as const) : path.match(/^\/v\/([A-Za-z0-9]{10})(\/video\.mp4|\/thumb\.jpg)?$/);
  if (!m) return null;
  const base = await publicOrigin(env, origin);
  // The page lives on the public address: an old /v/<id> link, or one on the Worker's own address
  // once a domain is set, is sent there (the files themselves are served on any address).
  if (!m[2] && (!short || new URL(request.url).host !== new URL(base).host)) return Response.redirect(`${base}/${m[1]}`, 301);
  const share = env.MEDIA ? await getShare(env, m[1]) : null;
  if (!share) {
    return new Response(translator(pageLang(request))('This video is not available any more.'), { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  if (!m[2]) {
    await countView(env, share.id, viewerLang(request));
    return page(env, share, base, pageLang(request));
  }
  const isVideo = m[2] === '/video.mp4';
  const download = isVideo && new URL(request.url).searchParams.has('download')
    ? `${(share.title || 'video').replace(/[^\p{L}\p{N} ._-]+/gu, '').slice(0, 80) || 'video'}.${share.tgt_lang}.mp4`
    : null;
  if (share.status === 'ready') {
    const res = await fromR2(env, request, isVideo ? videoKey(share.id) : thumbKey(share.id), download);
    if (res) return res;
  }
  // Not copied yet: the Space still has it (for a day).
  const job = await env.DB.prepare('SELECT mode, outputs FROM jobs WHERE id = ?').bind(share.job_id).first<{ mode: string; outputs: string | null }>();
  const name = isVideo ? (job ? videoFile(job as never) : null) : 'thumb.jpg';
  if (!name) return new Response('Not found.', { status: 404 });
  return Response.redirect(await fileLink(env, share.job_id, name, 3600, download ?? undefined), 302);
}
