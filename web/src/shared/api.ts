/** Baseplate: the typed client for the Worker's /api and the types every brick shares. */
export type JobStatus = 'awaiting_upload' | 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
/** soft: subtitle files; hard: subtitles burned in; dub: the translation spoken over the video. */
export type SubtitleMode = 'soft' | 'hard' | 'dub';

/** How burned-in subtitles look (only used with SubtitleMode 'hard'). */
export interface SubtitleStyle {
  size: 'small' | 'medium' | 'large' | 'xlarge';
  position: 'bottom' | 'middle' | 'top';
  color: string; // #RRGGBB
  background: 'outline' | 'box';
  font: 'modern' | 'classic' | 'bold';
  /** Also show the original text, smaller, next to the translation. */
  bilingual?: boolean;
  /** Dubbing: the voice that speaks the translation. */
  voice?: 'female' | 'male';
  /** Dynamic captions: none, highlight (the spoken word lights up), pop (a few words at a time). */
  animation?: 'none' | 'highlight' | 'pop';
}

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
  /** While waiting: place in line (1 = next); 0 while running; null otherwise. */
  queue_position?: number | null;
  /** Estimated seconds until the translation is ready, while queued or running. */
  eta_seconds?: number | null;
  /** "Try again" makes sense (the same link or Telegram file can be fetched again). */
  can_retry?: boolean;
  /** A burned-in video whose source is still kept: edited subtitles can be rendered into it. */
  can_rerender?: boolean;
  created_at: number;
  updated_at: number;
  outputs: Partial<
    Record<'srt_url' | 'vtt_url' | 'original_srt_url' | 'bilingual_srt_url' | 'transcript_url' | 'cues_url' | 'mp4_url' | 'dubbed_url', string>
  >;
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

/** Credits: 1 credit = 60 seconds of video. Balances come in whole seconds. */
export type Bucket = 'daily' | 'monthly' | 'bonus' | 'topup';
export interface Balance {
  total_seconds: number;
  buckets: { bucket: Bucket; seconds: number; expires_at: number | null }[];
}
export interface Account {
  id: string;
  name: string | null;
  email: string | null;
  email_verified: boolean;
  linked: { telegram: boolean; google: boolean; email: boolean };
  /** Has paid by card: Stripe's page can manage the subscription. */
  card_customer?: boolean;
  created_at: number;
}
export interface Me {
  account: Account | null;
  credits_enabled: boolean;
  seconds_per_credit: number;
  balance: Balance | null;
  /** The free credits and limits that apply now (credits on only). */
  free: {
    paid: boolean;
    verified: boolean;
    daily_seconds: number;
    next_daily_at: number | null;
    /** Longest video allowed without bought credits; null when there are bought credits. */
    max_video_seconds: number | null;
    dub_preview_available: boolean;
    dub_preview_max_seconds: number;
  } | null;
  allowances?: { guest_trial: number; signup_bonus: number; daily: number; daily_period: number };
  /** How to pay (credits on only): card (Stripe) and Telegram Stars (the bot). */
  payments?: { card: boolean; stars: boolean; bot_username: string | null; stars_prices: Record<string, number> } | null;
  sign_in: { telegram: boolean; email: boolean; google: boolean };
}
export interface LedgerEntry {
  id: number;
  job_id: string | null;
  kind: 'grant' | 'remove' | 'reserve' | 'refund' | string;
  seconds: number;
  detail: string | null;
  created_at: number;
}

export const accountApi = {
  me: () => call<Me>(`/api/me?client_id=${clientId()}`),
  history: () => call<LedgerEntry[]>(`/api/me/history?client_id=${clientId()}`),
  telegramStart: () => call<{ code: string; url: string }>('/api/auth/telegram/start', { method: 'POST', body: '{}' }),
  telegramCheck: (code: string) =>
    call<{ status: 'waiting' } | ({ status: 'signed_in' } & Me)>('/api/auth/telegram/check', { method: 'POST', body: JSON.stringify({ code }) }),
  email: (email: string) => call<{ ok: true }>('/api/auth/email', { method: 'POST', body: JSON.stringify({ email }) }),
  googleUrl: () => `${BASE}/api/auth/google`,
  portal: () => call<{ url: string }>('/api/billing/portal', { method: 'POST', body: '{}' }),
  checkout: (product: string) => call<{ url: string }>('/api/billing/checkout', { method: 'POST', body: JSON.stringify({ product }) }),
  logout: () => call<{ ok: true }>('/api/auth/logout', { method: 'POST', body: '{}' }),
};

export const api = {
  config: () => call<AppConfig>('/api/config'),
  job: (id: string) => call<Job>(`/api/jobs/${id}`),
  jobs: () => call<Job[]>(`/api/jobs?client_id=${clientId()}`),
  create: (body: Record<string, unknown>) =>
    call<Job>('/api/jobs', { method: 'POST', body: JSON.stringify({ ...body, client_id: clientId() }) }),
  start: (id: string, duration?: number | null) =>
    call<Job>(`/api/jobs/${id}/start`, { method: 'POST', body: JSON.stringify({ client_id: clientId(), duration }) }),
  render: (id: string, cues: Cue[]) =>
    call<Job>(`/api/jobs/${id}/render`, {
      method: 'POST',
      body: JSON.stringify({
        client_id: clientId(),
        cues: cues.map(({ start, end, text, translation }) => ({ start, end, text, translation })),
      }),
    }),
  retry: (id: string) =>
    call<Job>(`/api/jobs/${id}/retry`, { method: 'POST', body: JSON.stringify({ client_id: clientId() }) }),
  cancel: (id: string) =>
    call<Job>(`/api/jobs/${id}/cancel`, { method: 'POST', body: JSON.stringify({ client_id: clientId() }) }),
};

/** A job as the /admin dashboard sees it. */
export interface AdminJob {
  id: string;
  channel: 'web' | 'telegram';
  owner: string;
  source_kind: 'url' | 'telegram' | 'upload';
  source: string | null;
  title: string | null;
  status: JobStatus;
  stage: string;
  progress: number;
  waking: boolean;
  dispatch_attempts: number;
  duration: number | null;
  src_lang: string;
  detected_lang: string | null;
  tgt_lang: string;
  mode: SubtitleMode;
  style: SubtitleStyle | null;
  error_code: string | null;
  error_message: string | null;
  created_at: number;
  updated_at: number;
  outputs: Partial<Record<'srt' | 'vtt' | 'original_srt' | 'bilingual_srt' | 'transcript' | 'mp4', string>>;
}

/** Link downloads per site over the last `days` days (the /admin Insights page). */
export interface SiteStats {
  days: number;
  sites: {
    site: string;
    done: number;
    failed: number;
    last_error: string | null;
    last_failed_at: number | null;
    last_done_at: number | null;
  }[];
}

export type AdminAction = 'cancel' | 'retry' | 'delete';

export interface AdminActionResult {
  id: string;
  ok: boolean;
  error?: string;
  /** The job after the action; for a retry, the new job that replaces `id`. */
  job?: AdminJob | null;
}

const auth = (password: string) => ({ Authorization: `Bearer ${password}` });

export const adminApi = {
  login: (password: string) => call<{ ok: true }>('/api/admin/login', { method: 'POST', headers: auth(password) }),
  load: (password: string) => call<AdminSettings>('/api/admin/settings', { headers: auth(password) }),
  save: (password: string, settings: Partial<AdminSettings>) =>
    call<{ ok: true }>('/api/admin/settings', { method: 'POST', headers: auth(password), body: JSON.stringify(settings) }),
  jobs: (password: string) => call<AdminJob[]>('/api/admin/jobs', { headers: auth(password) }),
  stats: (password: string) => call<SiteStats>('/api/admin/stats', { headers: auth(password) }),
  job: (password: string, id: string) => call<AdminJob>(`/api/admin/jobs/${id}`, { headers: auth(password) }),
  accounts: (password: string, q = '') =>
    call<AdminAccount[]>(`/api/admin/accounts?q=${encodeURIComponent(q)}`, { headers: auth(password) }),
  account: (password: string, id: string) => call<AdminAccount>(`/api/admin/accounts/${id}`, { headers: auth(password) }),
  grant: (password: string, id: string, body: { seconds: number; bucket: Bucket; days?: number; note?: string }) =>
    call<AdminAccount>(`/api/admin/accounts/${id}/credits`, { method: 'POST', headers: auth(password), body: JSON.stringify(body) }),
  act: (password: string, action: AdminAction, ids: string[]) =>
    call<{ results: AdminActionResult[] }>('/api/admin/jobs', {
      method: 'POST',
      headers: auth(password),
      body: JSON.stringify({ action, ids }),
    }),
};

/** An account as the /admin page sees it. */
export interface AdminAccount extends Account {
  telegram_id: number | null;
  last_seen?: number;
  balance: Balance;
  history?: LedgerEntry[];
}
