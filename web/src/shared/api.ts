/** Baseplate: the typed client for the Worker's /api and the types every brick shares. */
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
  /** Values saved on the /admin page; empty strings mean "use the default". */
  site?: SiteSettings;
}

export interface SiteSettings {
  name: string;
  accent: string;
  translate_title: string;
  translate_intro: string;
  logo_url: string;
}

/** Everything the /admin page edits. `logo` is a data: URL to upload, '' to remove, absent to keep. */
export interface AdminSettings {
  name: string;
  accent: string;
  translate_title: string;
  translate_intro: string;
  welcome_en: string;
  welcome_ar: string;
  has_logo?: boolean;
  logo?: string;
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
      headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...(init?.headers as Record<string, string>) },
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

const auth = (password: string) => ({ Authorization: `Bearer ${password}` });

export const adminApi = {
  login: (password: string) => call<{ ok: true }>('/api/admin/login', { method: 'POST', headers: auth(password) }),
  load: (password: string) => call<AdminSettings>('/api/admin/settings', { headers: auth(password) }),
  save: (password: string, settings: Partial<AdminSettings>) =>
    call<{ ok: true }>('/api/admin/settings', { method: 'POST', headers: auth(password), body: JSON.stringify(settings) }),
};
