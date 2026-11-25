/**
 * The interface language: English or Arabic (right to left).
 *
 * Every text on screen is written in English and passed through t(); in Arabic it is looked up in
 * ar.ts (the English is shown for anything not translated yet). The choice is kept in this
 * browser and in a cookie (so the server-made pages follow it); switching reloads the page, so
 * every text, including those set when the page loads, is in one language.
 */
import { AR } from './ar';

export type Lang = 'en' | 'ar';
const KEY = 'kavox_lang';

function detect(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'ar' || saved === 'en') return saved;
  } catch {
    /* storage blocked: the browser's language decides */
  }
  const asked = typeof navigator !== 'undefined' ? navigator.languages?.[0] ?? navigator.language ?? '' : '';
  return asked.toLowerCase().startsWith('ar') ? 'ar' : 'en';
}

/** The admin dashboard stays in English (and must not change the visitor's choice). */
const ADMIN = typeof location !== 'undefined' && location.pathname.startsWith('/admin');

/** The language of this page view (fixed until the next load). */
export const LANG: Lang = ADMIN ? 'en' : detect();
export const RTL = LANG === 'ar';

if (typeof document !== 'undefined' && !ADMIN) {
  document.documentElement.lang = LANG;
  document.documentElement.dir = RTL ? 'rtl' : 'ltr';
  // The server-made pages (a video, a profile, the Terms) read it from here.
  document.cookie = `${KEY}=${LANG}; path=/; max-age=31536000; samesite=lax`;
}

/** Switch the interface language (the page reloads in it). */
export function setLang(lang: Lang): void {
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    /* storage blocked: the cookie still carries it */
  }
  document.cookie = `${KEY}=${lang}; path=/; max-age=31536000; samesite=lax`;
  window.location.reload();
}

/**
 * A text in the interface language. `vars` fill {name} placeholders:
 * t('Dub into {lang}', { lang: 'Arabic' }).
 */
export function t(text: string, vars?: Record<string, string | number>): string {
  let out = RTL ? AR[text] ?? text : text;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
  return out;
}

/** "1 video" / "3 videos" in English; Arabic uses one form with the number. */
export const plural = (n: number, one: string, many: string) => t(n === 1 ? one : many, { n });

/** A date, in the interface language (Gregorian calendar, Western digits). */
export const formatDate = (sec: number, opts?: Intl.DateTimeFormatOptions) =>
  new Date(sec * 1000).toLocaleDateString(RTL ? 'ar-u-nu-latn-ca-gregory' : undefined, opts);

/** A language's name in the interface language ("Arabic" / "العربية"), from the app's list or the browser. */
export function languageName(code: string | null | undefined, known?: { en: string; ar?: string } | null): string {
  if (!code) return '';
  if (known) return RTL && known.ar ? known.ar : known.en;
  try {
    return new Intl.DisplayNames([LANG], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** The locale for dates and numbers: Gregorian calendar and Western digits in Arabic. */
export const LOCALE = RTL ? 'ar-u-nu-latn-ca-gregory' : undefined;
