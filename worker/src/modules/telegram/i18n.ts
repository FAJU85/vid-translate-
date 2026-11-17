import { BOT_TEXT } from '../../shared/content';
import { LANGUAGES } from '../../shared/languages';

export type UiLang = 'en' | 'ar';

export function langName(code: string, ui: UiLang): string {
  const lang = LANGUAGES.find((l) => l.code === code);
  return lang ? `${lang.flag} ${lang[ui]}` : code;
}

type Dict = Record<string, string>;

// The messages themselves live in content/bot.json, so they can be edited without touching code.
const dicts: Record<UiLang, Dict> = BOT_TEXT;
const en = dicts.en;

export const uiLang = (code?: string | null): UiLang => (code?.toLowerCase().startsWith('ar') ? 'ar' : 'en');

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Look up a message and fill {placeholders}. Values are inserted as-is: escape user text first. */
export function t(ui: UiLang, key: string, vars: Record<string, string | number> = {}): string {
  // An emptied message falls back to English, then to its key: Telegram rejects empty messages.
  const template = dicts[ui]?.[key] || en[key] || key;
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
}

export function errorText(ui: UiLang, code: string | null, detail: string | null): string {
  const key = code && (dicts[ui]?.[code] || en[code]) ? code : 'E_INTERNAL';
  return t(ui, 'failed', { reason: t(ui, key, { detail: esc(detail ?? '') }) });
}
