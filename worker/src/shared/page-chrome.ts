/**
 * What every server-rendered page (a video's page, a profile, the Terms) shares with the website:
 * the KAVOX palette, the fonts, the tab icon and the header with the logo.
 */

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
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&family=Noto+Sans+Arabic:wght@400;600&display=swap" rel="stylesheet">`;

/** The page font stack (Arabic falls back to Noto Sans Arabic). */
export const FONT = `"Plus Jakarta Sans", "Noto Sans Arabic", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;

/** Styles for the header and the background glow; `brand` is already escaped. */
export const chromeCss = `
  body { background-color: ${PALETTE.navy}; background-image: radial-gradient(circle at 12% 0%, rgba(42,184,161,.10), transparent 38%), radial-gradient(circle at 90% 6%, rgba(232,124,106,.08), transparent 40%); background-attachment: fixed; }
  .kx-head { display: flex; align-items: center; }
  .kx-brand { display: inline-flex; align-items: center; gap: 10px; color: ${PALETTE.cream}; font-weight: 800; letter-spacing: .14em; text-decoration: none; font-size: 18px; }
  .kx-brand img { width: 34px; height: 34px; object-fit: contain; }
  ::selection { background: ${PALETTE.teal}; color: ${PALETTE.navy}; }`;

/** The header: logo and name, linking home. `brand` is already escaped. */
export const brandHeader = (brand: string, logo = DEFAULT_LOGO) =>
  `<header class="kx-head"><a class="kx-brand" href="/"><img src="${logo}" alt=""><span>${brand}</span></a></header>`;
