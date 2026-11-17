/**
 * Editable site content: content/site.json at the repository root, edited with Pages CMS
 * (see .pages.yml). Uploaded images live in web/public/images and are served at /images/...
 */
import site from '../../../content/site.json';

export interface SiteContent {
  brand: { name: string; mark: string; logo: string; accent: string; footer: string };
  seo: { title: string; description: string };
  translate: { title: string; intro: string; link_hint: string };
  history: { title: string };
  telegram: { title: string; intro: string; steps: { title: string; body: string }[] };
}

export const SITE: SiteContent = site;

/**
 * Apply the accent colour. The interface uses Tailwind's amber shades, which are CSS variables
 * in Tailwind 4, so overriding them recolours every button, badge and highlight at once.
 */
export function applyAccent(accent = SITE.brand.accent): void {
  if (!/^#[0-9a-f]{3,8}$/i.test(accent.trim())) return; // keep the built-in colour on a typo
  const c = accent.trim();
  const style = document.documentElement.style;
  style.setProperty('--color-amber-400', c);
  style.setProperty('--color-amber-300', `color-mix(in oklab, ${c} 75%, white)`);
  style.setProperty('--color-amber-500', `color-mix(in oklab, ${c} 85%, black)`);
  style.setProperty('--color-amber-950', `color-mix(in oklab, ${c} 22%, black)`);
}
