/**
 * Default bot messages: content/bot.json at the repository root. {placeholders} in a message are
 * filled in by the bot. The welcome message can also be replaced on the website's /admin page.
 */
import bot from '../../../content/bot.json';

export type BotTexts = Record<'en' | 'ar', Record<string, string>>;

export const BOT_TEXT: BotTexts = bot;
