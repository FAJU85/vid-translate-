import { now, type Env } from '../../shared/env';

/** Per-chat settings and the request waiting for the user's choice. Only this file writes SQL against it. */
export const CHATS_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS chats (
    chat_id INTEGER PRIMARY KEY,
    tgt_lang TEXT NOT NULL DEFAULT 'ar',
    pending TEXT,
    updated_at INTEGER NOT NULL
  )`,
];

export interface ChatRow {
  chat_id: number;
  tgt_lang: string;
  pending: string | null;
}

export async function getChat(env: Env, chatId: number, defaultLang: string): Promise<ChatRow> {
  const row = await env.DB.prepare('SELECT * FROM chats WHERE chat_id = ?').bind(chatId).first<ChatRow>();
  return row ?? { chat_id: chatId, tgt_lang: defaultLang, pending: null };
}

export async function saveChat(env: Env, chat: ChatRow): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO chats (chat_id, tgt_lang, pending, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (chat_id) DO UPDATE SET tgt_lang = excluded.tgt_lang, pending = excluded.pending, updated_at = excluded.updated_at`,
  )
    .bind(chat.chat_id, chat.tgt_lang, chat.pending, now())
    .run();
}
