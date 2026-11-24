import { LANGUAGES } from '../../shared/languages';
import type { Env } from '../../shared/env';
import { fileLink } from '../jobs';
import { publicOrigin, publicSettings } from '../settings';
import { creatorOf, thumbKey, videoFile, videoKey } from './service';
import { countView, getShare, type ShareRow } from './store';

const langName = (code: string, _ui: 'en') => LANGUAGES.find((l) => l.code === code)?.en ?? code;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** The public page of a shared video: the player, what it is, and a download. */
async function page(env: Env, share: ShareRow, origin: string): Promise<Response> {
  const site = await publicSettings(env).catch(() => null);
  const brand = site?.name || 'KAVOX';
  const accent = /^#[0-9a-f]{6}$/i.test(site?.accent ?? '') ? site!.accent : '#fbbf24';
  const url = `${origin}/${share.id}`;
  const files = `${origin}/v/${share.id}`;
  const creator = await creatorOf(env, share);
  const title = share.title || 'Translated video';
  const what = share.mode === 'dub' ? 'Dubbed' : 'Subtitled';
  const from = share.src_lang && share.src_lang !== 'auto' && share.src_lang !== share.tgt_lang ? `${langName(share.src_lang, 'en')} → ` : '';
  const langs = `${from}${langName(share.tgt_lang, 'en')}`;
  const description = `${what} in ${langName(share.tgt_lang, 'en')} with ${brand}.`;
  const thumb = share.has_thumb ? `${files}/thumb.jpg` : '';
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · ${esc(brand)}</title>
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
<meta name="robots" content="noindex">
<style>
  :root { color-scheme: dark; --accent: ${accent}; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #020617; color: #e2e8f0; font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans Arabic", sans-serif; }
  header, main, footer { max-width: 960px; margin: 0 auto; padding: 16px; }
  header a { color: #fff; font-weight: 800; letter-spacing: .04em; text-decoration: none; font-size: 18px; }
  .player { background: #000; border-radius: 14px; overflow: hidden; display: flex; justify-content: center; }
  video { width: 100%; max-height: 75vh; display: block; background: #000; }
  h1 { font-size: 20px; margin: 16px 0 4px; color: #fff; overflow-wrap: anywhere; }
  .creator { display: inline-flex; align-items: center; gap: 8px; margin-top: 12px; color: #f1f5f9; text-decoration: none; font-weight: 600; }
  .creator .avatar { width: 32px; height: 32px; border-radius: 50%; background: var(--accent); color: #0f172a; display: grid; place-items: center; font-weight: 800; }
  .creator:hover span:last-child { text-decoration: underline; }
  .meta { color: #94a3b8; font-size: 14px; display: flex; flex-wrap: wrap; gap: 6px 14px; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
  .btn { display: inline-flex; align-items: center; gap: 6px; padding: 9px 14px; border-radius: 10px; border: 1px solid #334155; color: #f1f5f9; background: transparent; text-decoration: none; font: inherit; cursor: pointer; }
  .btn:hover { background: #1e293b; }
  .primary { background: var(--accent); border-color: var(--accent); color: #0f172a; font-weight: 700; }
  .primary:hover { filter: brightness(1.1); background: var(--accent); }
  #like[aria-pressed="true"] { border-color: #f43f5e; color: #fda4af; }
  footer { color: #64748b; font-size: 13px; }
  footer a { color: var(--accent); }
</style>
</head>
<body>
<header><a href="/">${esc(brand)}</a></header>
<main>
  <div class="player"><video controls playsinline preload="metadata" src="/v/${share.id}/video.mp4"${thumb ? ` poster="/v/${share.id}/thumb.jpg"` : ''}></video></div>
  ${creator ? `<a class="creator" href="/@${esc(creator.handle)}"><span class="avatar">${esc(creator.handle[0].toUpperCase())}</span><span>@${esc(creator.handle)}</span></a>` : ''}
  <h1>${esc(title)}</h1>
  <div class="meta"><span>${esc(what)} · ${esc(langs)}</span><span>${share.views + 1} view${share.views ? 's' : ''}</span></div>
  <div class="actions">
    <button class="btn" id="like" type="button" hidden aria-pressed="false">♡ <span id="likes">0</span></button>
    <button class="btn primary" id="copy" type="button">Copy link</button>
    <a class="btn" href="/v/${share.id}/video.mp4?download=1">Download</a>
  </div>
</main>
<footer>Translated with <a href="/">${esc(brand)}</a>: subtitles and dubbing for any video, in minutes.</footer>
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
    fetch(api, { credentials: 'same-origin' }).then((r) => r.json()).then((s) => { state = s; show(s); }).catch(() => {});
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
  document.getElementById('copy').addEventListener('click', async (e) => {
    try { await navigator.clipboard.writeText(${JSON.stringify(url)}); e.target.textContent = 'Copied'; }
    catch { prompt('Copy this link', ${JSON.stringify(url)}); }
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
    return new Response('This video is not available any more.', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  if (!m[2]) {
    await countView(env, share.id);
    return page(env, share, base);
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
