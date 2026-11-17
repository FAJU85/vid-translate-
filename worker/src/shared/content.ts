/**
 * Editable bot messages: content/bot.json at the repository root, edited with Pages CMS
 * (see .pages.yml). {placeholders} in a message are filled in by the bot.
 */
import bot from '../../../content/bot.json';

export type BotTexts = Record<'en' | 'ar', Record<string, string>>;

export const BOT_TEXT: BotTexts = bot;
