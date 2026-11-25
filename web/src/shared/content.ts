/**
 * Site content. Defaults come from content/site.json; values saved on the /admin page arrive with
 * /api/config and are applied on top by applySiteSettings().
 */
import site from '../../../content/site.json';
import type { SiteSettings } from './api';
import { RTL } from './i18n';

export interface SiteContent {
  brand: { name: string; mark: string; logo: string; accent: string; footer: string; logoSize?: number };
  seo: { title: string; description: string };
  translate: { title: string; intro: string; link_hint: string };
  history: { title: string };
  telegram: { title: string; intro: string; steps: { title: string; body: string }[] };
}

/** The defaults in the interface language: content/site.json, with its "ar" texts in Arabic. */
function inLanguage(base: typeof site): SiteContent {
  const ar = (base as { ar?: Partial<Record<keyof SiteContent, object>> }).ar;
  if (!RTL || !ar) return base;
  const out = structuredClone(base) as unknown as Record<string, object>;
  for (const [k, v] of Object.entries(ar)) out[k] = { ...out[k], ...v };
  return out as unknown as SiteContent;
}

// A copy, so the defaults stay available when a saved value is cleared.
const DEFAULTS: SiteContent = inLanguage(site);
export const SITE: SiteContent = structuredClone(DEFAULTS);
/** The built-in logo (content/site.json), shown when no logo is uploaded on the /admin page. */
export const DEFAULT_LOGO = DEFAULTS.brand.logo;
/** The logo's height in the headers, in pixels: the admin chooses it within these bounds. */
export const LOGO_SIZE = { min: 24, max: 72, default: 36 } as const;
/** A saved size, or the default. */
export function logoSize(saved?: string | number): number {
  const n = Number(saved);
  return Number.isInteger(n) && n >= LOGO_SIZE.min && n <= LOGO_SIZE.max ? n : LOGO_SIZE.default;
}

/**
 * Apply the accent colour. The interface uses Tailwind's amber shades, which are CSS variables
 * in Tailwind 4, so overriding them recolours every button, badge and highlight at once.
 */
export function applyAccent(accent = SITE.brand.accent): void {
  if (!/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(accent.trim())) return; // keep the built-in colour on a typo
  const c = accent.trim();
  const style = document.documentElement.style;
  style.setProperty('--color-amber-400', c);
  style.setProperty('--color-amber-300', `color-mix(in oklab, ${c} 75%, white)`);
  style.setProperty('--color-amber-500', `color-mix(in oklab, ${c} 85%, black)`);
  style.setProperty('--color-amber-950', `color-mix(in oklab, ${c} 22%, black)`);
}

const ACCENT_KEY = 'tarjim_accent';

/** The colour saved last time, so the page does not flash the default colour while loading. */
export function rememberedAccent(): string {
  try {
    return localStorage.getItem(ACCENT_KEY) || SITE.brand.accent;
  } catch {
    return SITE.brand.accent;
  }
}

/** Apply the values saved on the /admin page; an empty value keeps the default. */
export function applySiteSettings(saved?: SiteSettings): void {
  if (!saved) return;
  SITE.brand.name = saved.name || DEFAULTS.brand.name;
  SITE.brand.logo = saved.logo_url || DEFAULTS.brand.logo;
  SITE.brand.logoSize = logoSize(saved.logo_size);
  SITE.brand.accent = saved.accent || DEFAULTS.brand.accent;
  SITE.translate.title = saved.translate_title || DEFAULTS.translate.title;
  SITE.translate.intro = saved.translate_intro || DEFAULTS.translate.intro;
  applyAccent(SITE.brand.accent);
  try {
    localStorage.setItem(ACCENT_KEY, SITE.brand.accent); // applied before the first paint next time
  } catch {
    /* storage blocked: the colour still applies once the settings load */
  }
  if (SITE.brand.logo) {
    let icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!icon) {
      icon = document.createElement('link');
      icon.rel = 'icon';
      document.head.appendChild(icon);
    }
    icon.href = SITE.brand.logo;
  }
}
