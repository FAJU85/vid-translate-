import type { Env } from '../../shared/env';
import type { Person } from '../../shared/person';

/** The bot's settings for a person's Telegram chat (target language, subtitle style, consent). */
export async function exportTelegram(env: Env, p: Person) {
  if (!p.telegramId) return null;
  return env.DB.prepare('SELECT chat_id, tgt_lang, style, consent, updated_at FROM chats WHERE chat_id = ?').bind(p.telegramId).first();
}

export async function eraseTelegram(env: Env, p: Person): Promise<void> {
  if (p.telegramId) await env.DB.prepare('DELETE FROM chats WHERE chat_id = ?').bind(p.telegramId).run();
}
