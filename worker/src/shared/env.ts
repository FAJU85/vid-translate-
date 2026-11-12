/** Bindings and settings of the Worker (see wrangler.toml and the README's secrets table). */
export interface Env {
  DB: D1Database;
  /** Base URL of the Hugging Face Space, e.g. https://user-space.hf.space */
  BACKEND_URL: string;
  /** Same value as the Space's SHARED_SECRET. */
  SHARED_SECRET: string;
  TELEGRAM_BOT_TOKEN: string;
  /** Random string; Telegram echoes it on every webhook call. */
  TELEGRAM_WEBHOOK_SECRET: string;
  TELEGRAM_API_BASE?: string;
  /** Public origin of this Worker, if it differs from the request origin. */
  PUBLIC_URL?: string;
  /** Comma-separated origins allowed to call /api (the Pages site). Default: any. */
  ALLOWED_ORIGINS?: string;
  /** Comma-separated Telegram chat ids allowed to use the bot. Default: anyone. */
  ALLOWED_CHAT_IDS?: string;
  MAX_JOBS_PER_HOUR?: string;
  MAX_UPLOAD_MB?: string;
  DEFAULT_TARGET_LANG?: string;
}

export const now = () => Math.floor(Date.now() / 1000);
