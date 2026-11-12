export type JobStatus = 'awaiting_upload' | 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
export type SubtitleMode = 'soft' | 'hard';
export type SourceKind = 'url' | 'telegram' | 'upload';
export type Channel = 'web' | 'telegram';

export interface JobRow {
  id: string;
  channel: Channel;
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

/** A job's state as reported by the backend Space (callback body or /status reply). */
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
