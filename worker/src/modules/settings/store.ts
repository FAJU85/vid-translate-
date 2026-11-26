import { now, type Env } from '../../shared/env';

/**
 * Settings edited on the website's /admin page. Every field is optional: an empty value means
 * "use the default" (content/site.json for the website, content/bot.json for the bot).
 */
export interface Settings {
  name: string;
  accent: string;
  translate_title: string;
  translate_intro: string;
  welcome_en: string;
  welcome_ar: string;
  /** data: URL of the uploaded logo, or empty. */
  logo: string;
  /** The public address links are made with (e.g. "kavox.to"), or empty for the Worker's own. */
  public_domain: string;
  /** Where copyright owners and others send takedown requests (shown on the Terms page). */
  takedown_email: string;
  /** The logo's height in the headers, in CSS pixels (LOGO_SIZE.min to .max), or empty for the default. */
  logo_size: string;
  /** Banners and footer links (JSON, see blocks.ts); empty: the defaults. */
  blocks: string;
}

/** The logo's height in the site and page headers: chosen on the /admin page within these bounds. */
export const LOGO_SIZE = { min: 24, max: 72, default: 36 } as const;

/** The saved logo height, or the default. */
export function logoSize(settings: Pick<Settings, 'logo_size'> | null | undefined): number {
  const n = Number(settings?.logo_size);
  return Number.isInteger(n) && n >= LOGO_SIZE.min && n <= LOGO_SIZE.max ? n : LOGO_SIZE.default;
}

export const TEXT_FIELDS = ['name', 'accent', 'translate_title', 'translate_intro', 'welcome_en', 'welcome_ar'] as const;

export const SETTINGS_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS settings (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL,
     updated_at INTEGER NOT NULL
   )`,
];

const EMPTY: Settings = { name: '', accent: '', translate_title: '', translate_intro: '', welcome_en: '', welcome_ar: '', logo: '', public_domain: '', takedown_email: '', logo_size: '', blocks: '' };

export async function readSettings(env: Env): Promise<{ settings: Settings; updatedAt: number }> {
  const res = await env.DB.prepare('SELECT key, value, updated_at FROM settings').all<{ key: string; value: string; updated_at: number }>();
  const settings: Settings = { ...EMPTY };
  let updatedAt = 0;
  for (const row of res.results ?? []) {
    if (row.key in settings) settings[row.key as keyof Settings] = row.value;
    updatedAt = Math.max(updatedAt, row.updated_at);
  }
  return { settings, updatedAt };
}

/** Save the given fields; an empty string clears a field back to its default. */
export async function writeSettings(env: Env, patch: Partial<Settings>): Promise<void> {
  const ts = now();
  const statements = Object.entries(patch).map(([key, value]) =>
    value
      ? env.DB.prepare(
          'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
        ).bind(key, value, ts)
      : env.DB.prepare('DELETE FROM settings WHERE key = ?').bind(key),
  );
  if (statements.length) await env.DB.batch(statements);
  // Record the change time even when every field was cleared, so cached logos refresh.
  await env.DB.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES ('_saved', '1', ?) ON CONFLICT(key) DO UPDATE SET updated_at = excluded.updated_at",
  )
    .bind(ts)
    .run();
}
