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

export type JobStatus = 'awaiting_upload' | 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
export type SubtitleMode = 'soft' | 'hard';
export type SourceKind = 'url' | 'telegram' | 'upload';

export interface JobRow {
  id: string;
  channel: 'web' | 'telegram';
  owner: string;
  ip: string | null;
  chat_id: number | null;
  status_message_id: number | null;
  ui_lang: string;
  source_kind: SourceKind;
  /** URL for url jobs, Telegram file_id for telegram jobs, original file name for uploads. */
  source: string;
  title: string | null;
  duration: number | null;
  src_lang: string;
  tgt_lang: string;
  detected_lang: string | null;
  mode: SubtitleMode;
  status: JobStatus;
  stage: string;
  progress: number;
  error_code: string | null;
  error_message: string | null;
  outputs: string | null;
  origin: string;
  dispatched: number;
  dispatch_attempts: number;
  delivered: number;
  notified: string | null;
  created_at: number;
  updated_at: number;
}

export interface BackendState {
  job_id: string;
  status: string;
  stage: string;
  progress: number;
  title?: string | null;
  duration?: number | null;
  detected_lang?: string | null;
  outputs?: Record<string, string> | null;
  error?: { code: string; message: string } | null;
}

export const TERMINAL: JobStatus[] = ['done', 'failed', 'cancelled'];
export const now = () => Math.floor(Date.now() / 1000);
