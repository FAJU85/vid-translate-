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
  /** Password for the website's /admin page (at least 8 characters). Unset: the page stays locked. */
  ADMIN_PASSWORD?: string;
  /**
   * Two-step sign-in for /admin: a base32 secret shared with an authenticator app (Google
   * Authenticator, 1Password, Authy…). Set: signing in needs the password and the app's 6-digit
   * code. Make one with `node scripts/admin-2fa-secret.mjs`.
   */
  ADMIN_TOTP_SECRET?: string;
  /** Public origin of this Worker, if it differs from the request origin. */
  PUBLIC_URL?: string;
  /** Comma-separated origins allowed to call /api (the Pages site). Default: any. */
  ALLOWED_ORIGINS?: string;
  /** Comma-separated Telegram chat ids allowed to use the bot. Default: anyone. */
  ALLOWED_CHAT_IDS?: string;
  MAX_JOBS_PER_HOUR?: string;
  MAX_UPLOAD_MB?: string;
  DEFAULT_TARGET_LANG?: string;
  /** "1": count and charge credits (1 credit = 60 seconds of video). Off by default. */
  CREDITS_ENABLED?: string;
  /** "1": the site's logo goes in the corner of lyrics videos (switched on from the Features page). */
  LYRICS_LOGO?: string;
  /** "1": a friend's first video gives free minutes to both sides (Features page; needs credits on). */
  REFERRAL_REWARDS?: string;
  /** Free minutes per side for an invite (1–120; default 10). */
  REFERRAL_MINUTES?: string;
  /** Email sign-in links through Resend (resend.com): its API key and the sender address. */
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  /** Google sign-in: an OAuth client (Google Cloud console → APIs & Services → Credentials). */
  GOOGLE_CLIENT_ID?: string;
  /** Google Search Console's verification file name (google….html, without .html). */
  GOOGLE_SITE_VERIFICATION?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Card payments on the website (Stripe): the secret key and the webhook's signing secret. */
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  /** Telegram Stars per US dollar for prices in the bot (default 50). */
  STARS_PER_USD?: string;
  /** Cloudflare R2: subscribers' own video endings (and, later, shared videos). Optional. */
  MEDIA?: R2Bucket;
  /** The website's files (web/dist), for every page the Worker does not answer itself. */
  ASSETS?: Fetcher;
  /** The server's own settings, before the admin page's values were filled in (features brick). */
  SERVER_ENV?: Env;
  /** "1" when the admin page's saved settings could not be read: admin sign-in is refused, not weakened. */
  FEATURES_UNAVAILABLE?: string;
  /** Changes every time two-step sign-in is turned on or off from the admin page: ends every earlier sign-in. */
  ADMIN_TOKEN_EPOCH?: string;
}

export const now = () => Math.floor(Date.now() / 1000);
