import type { AddedColumn } from '../../shared/db';
import { now, type Env } from '../../shared/env';

/** Per-chat settings and the request waiting for the user's choice. Only this file writes SQL against it. */
export const CHATS_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS chats (
    chat_id INTEGER PRIMARY KEY,
    tgt_lang TEXT NOT NULL DEFAULT 'ar',
    pending TEXT,
    style TEXT,
    updated_at INTEGER NOT NULL
  )`,
];

/** Columns added after the first release, for databases created before them. */
export const CHATS_COLUMNS: AddedColumn[] = [
  { table: 'chats', column: 'style', definition: 'TEXT' },
  // The version of the Terms and Privacy Policy this chat agreed to (asked before the first video).
  { table: 'chats', column: 'consent', definition: 'TEXT' },
];

export interface ChatRow {
  chat_id: number;
  tgt_lang: string;
  pending: string | null;
  /** JSON of the chat's burned-in subtitle style (/style), or null for the default. */
  style: string | null;
  /** The Terms and Privacy Policy version agreed to, and null before that. */
  consent?: string | null;
}

export async function getChat(env: Env, chatId: number, defaultLang: string): Promise<ChatRow> {
  const row = await env.DB.prepare('SELECT * FROM chats WHERE chat_id = ?').bind(chatId).first<ChatRow>();
  return row ?? { chat_id: chatId, tgt_lang: defaultLang, pending: null, style: null };
}

type ChatField = 'tgt_lang' | 'pending' | 'style' | 'consent';

/**
 * Save only the given settings of a chat. Each button handler changes one setting, so two taps
 * handled at the same time (say /style and "Video with subtitles") can never undo each other.
 */
export async function updateChat(
  env: Env,
  chatId: number,
  defaultLang: string,
  patch: Partial<Pick<ChatRow, ChatField>>,
): Promise<void> {
  const fields = (Object.keys(patch) as ChatField[]).filter((f) => ['tgt_lang', 'pending', 'style', 'consent'].includes(f));
  if (!fields.length) return;
  const row = { tgt_lang: defaultLang, pending: null, style: null, consent: null, ...patch };
  await env.DB.prepare(
    `INSERT INTO chats (chat_id, tgt_lang, pending, style, consent, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (chat_id) DO UPDATE SET ${fields.map((f) => `${f} = excluded.${f}`).join(', ')},
       updated_at = excluded.updated_at`,
  )
    .bind(chatId, row.tgt_lang, row.pending ?? null, row.style ?? null, row.consent ?? null, now())
    .run();
}
