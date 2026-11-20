export type JobStatus = 'awaiting_upload' | 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
/** soft: subtitle files; hard: subtitles burned into the video; dub: the translation spoken over it. */
export type SubtitleMode = 'soft' | 'hard' | 'dub';
/** 'rerender': burn edited subtitles into the video kept from an earlier job (`source` = its id). */
export type SourceKind = 'url' | 'telegram' | 'upload' | 'rerender';
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
  /** JSON of the burned-in subtitle style (see style.ts), or null for the default. */
  style: string | null;
  /** 'rerender' jobs: JSON of the edited subtitles [{start, end, text, translation}]. */
  cues: string | null;
  status: JobStatus;
  stage: string;
  /** Place in the Space's queue (1 = next, 0 = running) and seconds until done, while active. */
  queue_position: number | null;
  eta: number | null;
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
  queue_position?: number | null;
  eta_seconds?: number | null;
}

export const TERMINAL: JobStatus[] = ['done', 'failed', 'cancelled'];
