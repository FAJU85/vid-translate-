export type JobStatus = 'awaiting_upload' | 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
export type SubtitleMode = 'soft' | 'hard';

export interface Job {
  id: string;
  channel: 'web' | 'telegram';
  status: JobStatus;
  stage: string;
  progress: number;
  title: string | null;
  source_url: string | null;
  duration: number | null;
  src_lang: string;
  detected_lang: string | null;
  tgt_lang: string;
  mode: SubtitleMode;
  error_code: string | null;
  error_message: string | null;
  created_at: number;
  updated_at: number;
  outputs: Partial<Record<'srt_url' | 'vtt_url' | 'original_srt_url' | 'cues_url' | 'mp4_url', string>>;
  upload_url?: string;
}

export interface Cue {
  index: number;
  start: number;
  end: number;
  text: string;
  translation: string;
}

export interface Language {
  code: string;
  flag: string;
  en: string;
  ar: string;
}

export interface AppConfig {
  bot_username: string | null;
  languages: Language[];
  max_upload_mb: number;
  max_jobs_per_hour: number;
}

const BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

/** Anonymous per-browser id: it is what lets this browser list and cancel its own jobs. */
export function clientId(): string {
  const key = 'tarjim_client_id';
  try {
    let id = localStorage.getItem(key);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    return (sessionId ??= crypto.randomUUID());
  }
}
let sessionId: string | undefined;

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    });
  } catch {
    throw new ApiError('E_NETWORK', 'Could not reach the server. Check your connection and try again.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(data?.error_code ?? 'E_HTTP', data?.message ?? `Request failed (${res.status}).`);
  return data as T;
}

export const api = {
  config: () => call<AppConfig>('/api/config'),
  job: (id: string) => call<Job>(`/api/jobs/${id}`),
  jobs: () => call<Job[]>(`/api/jobs?client_id=${clientId()}`),
  create: (body: Record<string, unknown>) =>
    call<Job>('/api/jobs', { method: 'POST', body: JSON.stringify({ ...body, client_id: clientId() }) }),
  start: (id: string) =>
    call<Job>(`/api/jobs/${id}/start`, { method: 'POST', body: JSON.stringify({ client_id: clientId() }) }),
  cancel: (id: string) =>
    call<Job>(`/api/jobs/${id}/cancel`, { method: 'POST', body: JSON.stringify({ client_id: clientId() }) }),
};

function putFile(url: string, file: File, onProgress: (fraction: number) => void): Promise<number> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => resolve(xhr.status);
    xhr.onerror = () => resolve(0);
    xhr.send(file);
  });
}

/**
 * Uploads straight to the translation server. A sleeping Hugging Face Space answers the first
 * requests with errors while it boots, so keep retrying for a few minutes.
 */
export async function uploadFile(
  url: string,
  file: File,
  onProgress: (fraction: number) => void,
  onWaking: () => void,
): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const status = await putFile(url, file, onProgress);
    if (status === 200) return;
    if (status === 413) throw new ApiError('E_FILE_TOO_LARGE', 'The file is too large.');
    if (status === 403 || status === 409) throw new ApiError('E_UPLOAD', 'The upload link expired. Please try again.');
    onWaking();
    await new Promise((r) => setTimeout(r, 10_000));
  }
  throw new ApiError('E_BACKEND_DOWN', 'The translation server is not responding. Please try again later.');
}

export const RTL = new Set(['ar', 'fa', 'ur', 'he']);

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

export function timestamp(seconds: number, sep = ','): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}${sep}${pad(ms % 1000, 3)}`;
}

export function cuesToSrt(cues: Cue[]): string {
  return cues.map((c, i) => `${i + 1}\n${timestamp(c.start)} --> ${timestamp(c.end)}\n${c.translation}\n`).join('\n');
}

export const STAGE_LABEL: Record<string, string> = {
  awaiting_upload: 'Uploading…',
  queued: 'Waiting in the queue…',
  waking: 'Waking up the translation server (can take a couple of minutes)…',
  downloading: 'Downloading the video…',
  transcribing: 'Transcribing speech…',
  translating: 'Translating…',
  rendering: 'Burning subtitles into the video…',
  done: 'Done',
};

const ERROR_TEXT: Record<string, string> = {
  E_URL_INVALID: 'That link is not supported.',
  E_SITE_BLOCKED:
    'The site refused our server (bot check or login required). Download the video yourself and upload the file instead.',
  E_DOWNLOAD_FAILED: 'The video could not be downloaded.',
  E_VIDEO_TOO_LONG: 'The video is too long.',
  E_FILE_TOO_LARGE: 'The file is too large.',
  E_MEDIA_INVALID: 'The file is not a readable video or audio file.',
  E_NO_SPEECH: 'No speech was detected in the video.',
  E_ASR_FAILED: 'Speech recognition failed.',
  E_NMT_FAILED: 'The translation step failed.',
  E_RENDER_FAILED: 'The subtitled video could not be rendered.',
  E_BACKEND_DOWN: 'The translation server is not responding. Please try again in a few minutes.',
  E_BACKEND_RESTARTED: 'The translation server restarted in the middle of the job. Please submit the video again.',
  E_CANCELLED: 'Cancelled.',
};

export function jobError(job: Job): string {
  const base = ERROR_TEXT[job.error_code ?? ''] ?? 'Something went wrong.';
  const detail = ['E_DOWNLOAD_FAILED', 'E_VIDEO_TOO_LONG', 'E_NMT_FAILED'].includes(job.error_code ?? '') ? job.error_message : '';
  return detail ? `${base} ${detail}` : base;
}
