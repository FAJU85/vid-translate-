/**
 * What every server-rendered page (a video's page, a profile, the Terms) shares with the website:
 * the KAVOX palette, the fonts, the tab icon and the header with the logo.
 */

import { english, type Tr } from './page-i18n';

/** The approved palette, and the shades between Deep Navy and Warm Cream the pages use. */
export const PALETTE = {
  navy: '#131C31', // Deep Navy: the background
  deep: '#0E1525', // fields, below the background
  panel: '#19243E', // cards
  line: '#2E3D63', // borders
  cream: '#F9EBD6', // Warm Cream: titles
  text: '#E2D6C6', // body text
  muted: '#ABA59E', // secondary text
  faint: '#8F8B88', // hints
  teal: '#2AB8A1', // Mint Teal: actions
  coral: '#E87C6A', // Coral Salmon: live, liked, warnings
} as const;

/** The default logo (web/public/assets/kavox-logo.svg), used when the admin has not uploaded one. */
export const DEFAULT_LOGO = '/assets/kavox-logo.svg';

/** Fonts and tab icon, for the <head>. */
export const headLinks = (logo = DEFAULT_LOGO) => `<link rel="icon" href="${logo}">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/assets/icons/apple-touch-icon.png">
<meta name="theme-color" content="${PALETTE.navy}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&family=Noto+Sans+Arabic:wght@400;600;700&display=swap" rel="stylesheet">`;

/** The page font stack (Arabic falls back to Noto Sans Arabic). */
export const FONT = `"Plus Jakarta Sans", "Noto Sans Arabic", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;

/** Styles for the header and the background glow; `brand` is already escaped. */
export const chromeCss = `
  body { background-color: ${PALETTE.navy}; background-image: radial-gradient(circle at 12% 0%, rgba(42,184,161,.10), transparent 38%), radial-gradient(circle at 90% 6%, rgba(232,124,106,.08), transparent 40%); background-attachment: fixed; }
  .kx-head { display: flex; align-items: center; }
  .kx-brand { display: inline-flex; align-items: center; gap: 10px; color: ${PALETTE.cream}; font-weight: 800; letter-spacing: .14em; text-decoration: none; font-size: 18px; }
  .kx-brand img { width: auto; object-fit: contain; }
  ::selection { background: ${PALETTE.teal}; color: ${PALETTE.navy}; }`;

/**
 * The header: logo and name, linking home. `brand` is already escaped; `size` is the logo's height
 * in pixels (the admin's setting; a wide logo keeps its shape, up to four times as wide).
 */
export const brandHeader = (brand: string, logo = DEFAULT_LOGO, size = 36) =>
  `<header class="kx-head"><a class="kx-brand" href="/"><img src="${logo}" alt="" style="height:${size}px;max-width:${size * 4}px"><span>${brand}</span></a></header>`;

/** A video as a tall tile: its picture, or (without one) its title on a soft brand gradient. */
export interface TileVideo {
  id: string;
  title: string | null;
  mode: string;
  views: number;
  has_thumb: number;
  /** "Arabic", already looked up. */
  language: string;
}
const escHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const videoTile = (v: TileVideo, tr: Tr = english) => {
  const title = escHtml(v.title || tr('Translated video'));
  const picture = v.has_thumb
    ? `<img src="/v/${v.id}/thumb.jpg" alt="" loading="lazy">`
    : `<span class="blank"><span class="play">▶</span><span class="t" dir="auto">${title}</span></span>`;
  return `<a class="tile" href="/${v.id}" title="${title}">${picture}<span class="badge">${tr(v.mode === 'dub' ? 'Dubbed' : 'Subtitled')} · ${escHtml(v.language)}</span><span class="views">▶ ${v.views}</span></a>`;
};
export const tileCss = `
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 16px; }
  @media (min-width: 720px) { .grid { grid-template-columns: repeat(4, 1fr); } }
  .tile { position: relative; aspect-ratio: 9 / 16; background: ${PALETTE.panel}; border-radius: 10px; overflow: hidden; display: block; text-decoration: none; }
  .tile:hover { outline: 2px solid ${PALETTE.teal}; outline-offset: 1px; }
  .tile img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .tile .blank { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 28px 10px; text-align: center;
    background: linear-gradient(160deg, rgba(42,184,161,.22), rgba(25,36,62,.9) 55%, rgba(232,124,106,.18)); }
  .tile .play { width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center; background: rgba(249,235,214,.12); color: ${PALETTE.cream}; font-size: 14px; }
  .tile .t { color: ${PALETTE.cream}; font-size: 12px; font-weight: 600; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .badge, .views { position: absolute; inset-inline-start: 6px; font-size: 11px; color: ${PALETTE.cream}; text-shadow: 0 1px 2px #000; }
  .badge { top: 6px; background: rgba(19,28,49,.7); padding: 1px 6px; border-radius: 6px; }
  .views { bottom: 6px; font-weight: 700; }`;

/** The invitation every public page ends with: make your own translated video. */
export const makeYourOwn = (brand: string, tr: Tr = english) => `<a class="kx-cta" href="/">
  <span class="kx-cta-icon">✦</span>
  <span><b>${tr('Watch any video in your language')}</b><span>${tr('Paste a link or upload a file: {brand} adds subtitles or a dubbed voice in minutes.', { brand })}</span></span>
  <span class="kx-cta-go">${tr('Try it →')}</span>
</a>`;
export const ctaCss = `
  .kx-cta { display: flex; align-items: center; gap: 14px; margin-top: 28px; padding: 16px; border-radius: 16px; text-decoration: none; color: ${PALETTE.text};
    border: 1px solid rgba(42,184,161,.35); background: linear-gradient(120deg, rgba(42,184,161,.14), rgba(232,124,106,.08)); }
  .kx-cta:hover { border-color: ${PALETTE.teal}; }
  .kx-cta b { display: block; color: ${PALETTE.cream}; font-size: 15px; }
  .kx-cta > span > span { display: block; font-size: 13px; color: ${PALETTE.muted}; margin-top: 2px; }
  .kx-cta-icon { width: 40px; height: 40px; flex: none; border-radius: 12px; display: grid; place-items: center; background: ${PALETTE.teal}; color: ${PALETTE.navy}; font-size: 18px; }
  .kx-cta-go { margin-inline-start: auto; flex: none; color: ${PALETTE.teal}; font-weight: 700; font-size: 14px; }`;

/** One-tap share links to WhatsApp, X and Telegram (each app's own share address; no script). */
export const shareRow = (url: string, text: string, tr: Tr = english) => {
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(text);
  const links: [string, string, string][] = [
    ['wa', 'WhatsApp', `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`],
    ['x', 'X', `https://x.com/intent/post?text=${t}&url=${u}`],
    ['tg', 'Telegram', `https://t.me/share/url?url=${u}&text=${t}`],
  ];
  return `<div class="kx-share">${links
    .map(([id, name, href]) => `<a class="kx-share-${id}" href="${escHtml(href)}" target="_blank" rel="noopener" aria-label="${escHtml(tr('Share on {app}', { app: name }))}">${name}</a>`)
    .join('')}</div>`;
};
export const shareCss = `
  .kx-share { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
  .kx-share a { padding: 7px 12px; border-radius: 10px; font-weight: 700; font-size: 13px; text-decoration: none; color: #fff; }
  .kx-share a:hover { filter: brightness(1.1); }
  .kx-share-wa { background: #25D366; color: #06210F; } .kx-share-x { background: #000; box-shadow: inset 0 0 0 1px #2E3D63; } .kx-share-tg { background: #229ED9; color: #04192A; }`;
