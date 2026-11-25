import { t } from './i18n';

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
  voice?: 'female' | 'male' | 'classic';
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
  /** The video's public page (/v/<id>), once a rendered video is done. */
  share_url?: string | null;
  /** 👍 (1) / 👎 (-1) given to its translation and, for a dubbed video, its voice. */
  ratings?: Partial<Record<RatingAspect, 1 | -1>>;
}

export type RatingAspect = 'translation' | 'voice';

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
  /** The version of the Terms and Privacy Policy people agree to. */
  legal_version?: string;
  /** Values saved on the /admin page; empty strings mean "use the default". */
  site?: SiteSettings;
}

export interface SiteSettings {
  name: string;
  accent: string;
  translate_title: string;
  translate_intro: string;
  logo_url: string;
  /** The logo's height in pixels; empty: the default. */
  logo_size?: string;
}

/** Everything the /admin page edits. `logo` is a data: URL to upload, '' to remove, absent to keep. */
export interface AdminSettings {
  name: string;
  accent: string;
  translate_title: string;
  translate_intro: string;
  welcome_en: string;
  welcome_ar: string;
  /** The address links are made with (e.g. kavox.to); empty: the Worker's own address. */
  public_domain: string;
  /** Where copyright owners send takedown notices (shown on the Terms page); empty: not set. */
  takedown_email: string;
  /** The logo's height in the headers, in pixels (LOGO_SIZE); empty: the default. */
  logo_size: string;
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

/** Fired when the server refuses the admin sign-in token (the /admin page shows the sign-in form). */
export const ADMIN_SIGNED_OUT = 'kavox-admin-signed-out';

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...(init?.headers as Record<string, string>) },
    });
  } catch {
    throw new ApiError('E_NETWORK', t('Could not reach the server. Check your connection and try again.'));
  }
  const data = await res.json().catch(() => null);
  // An admin sign-in that ended (12 hours, or the password changed): the /admin page asks again.
  if (res.status === 401 && path.startsWith('/api/admin/') && path !== '/api/admin/login' && typeof window !== 'undefined') {
    window.dispatchEvent(new Event(ADMIN_SIGNED_OUT));
  }
  // The server's messages are in English: shown in the interface language when translated (i18n/ar.ts).
  if (!res.ok) throw new ApiError(data?.error_code ?? 'E_HTTP', data?.message ? t(data.message) : t('Request failed ({n}).', { n: res.status }));
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
  /** The Terms and Privacy Policy version this person agreed to (null: not yet), and the current one. */
  consent_version?: string | null;
  legal_version?: string;
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
  payments?: { card: boolean; stars: boolean; bot_username: string | null; stars_prices: Record<string, number>; count: number } | null;
  sign_in: { telegram: boolean; email: boolean; google: boolean };
  /** The ending added to rendered videos (signed in only). */
  outro?: Outro | null;
}
export type OutroMode = 'kavox' | 'custom' | 'none';
export interface Outro {
  mode: OutroMode;
  /** An own ending is uploaded. */
  custom: boolean;
  /** A monthly plan: may use an own ending or none. */
  allowed: boolean;
  /** Storage for own endings is set up on the server. */
  storage: boolean;
  max_mb: number;
  max_seconds: number;
}
export interface LedgerEntry {
  id: number;
  job_id: string | null;
  kind: 'grant' | 'remove' | 'reserve' | 'refund' | string;
  seconds: number;
  detail: string | null;
  created_at: number;
}

/** A video's public page (shares). */
export interface Share {
  id: string;
  url: string;
  job_id: string;
  title: string | null;
  views: number;
  ready: boolean;
  thumb_url: string | null;
  created_at: number;
  /** null: kept until deleted (monthly plans). */
  expires_at: number | null;
  /** link: only people with the link; public: also on your profile. */
  visibility: 'link' | 'public';
}
export interface DashboardVideo {
  job_id: string;
  title: string | null;
  channel: 'web' | 'telegram' | string;
  status: string;
  mode: SubtitleMode;
  src_lang: string | null;
  tgt_lang: string;
  duration: number | null;
  created_at: number;
  rerender: boolean;
  can_open: boolean;
  share: Share | null;
}
export interface Dashboard {
  signed_in: boolean;
  stats: {
    videos: number;
    seconds: number;
    by_mode: Partial<Record<SubtitleMode, number>>;
    languages: { lang: string; videos: number }[];
    last_30_days: { videos: number; seconds: number };
    per_day: { day: string; videos: number }[];
    share_views: number;
    shared_videos: number;
  };
  videos: DashboardVideo[];
}
export const dashboardApi = {
  get: () => call<Dashboard>(`/api/dashboard?client_id=${clientId()}`),
  deleteShare: (id: string) => call<{ ok: true }>(`/api/shares/${id}?client_id=${clientId()}`, { method: 'DELETE' }),
  /** Post a video to your profile (public) or keep it for people with the link only. */
  setVisibility: (id: string, visibility: 'link' | 'public') =>
    call<Share>(`/api/shares/${id}?client_id=${clientId()}`, { method: 'POST', body: JSON.stringify({ visibility }) }),
  /** The caption shown on the video's page, your profile and the feed (#hashtags work). */
  setTitle: (id: string, title: string) =>
    call<Share>(`/api/shares/${id}?client_id=${clientId()}`, { method: 'POST', body: JSON.stringify({ title }) }),
};

/** Your public profile: a unique @handle, a name and a short bio. */
export interface Profile {
  handle: string;
  display_name: string | null;
  bio: string | null;
  created_at: number;
}

/** A video in the feed: the posted video, its creator, its likes and your own state. */
export interface FeedItem extends Share {
  video_url: string;
  src_lang: string | null;
  tgt_lang: string;
  mode: string;
  creator: { handle: string; display_name: string | null };
  likes: number;
  comments: number;
  liked: boolean;
  following: boolean;
  mine: boolean;
}

export interface Comment {
  id: number;
  text: string;
  created_at: number;
  author: { handle: string; display_name: string | null };
  can_delete: boolean;
}

export type ReportKind = 'video' | 'comment' | 'profile';
export type ReportReason = 'copyright' | 'spam' | 'abuse' | 'sexual' | 'violence' | 'other';
export const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: 'copyright', label: t('It uses my work (copyright)') },
  { value: 'abuse', label: t('Harassment, threats or hate') },
  { value: 'sexual', label: t('Sexual content') },
  { value: 'violence', label: t('Violence or dangerous acts') },
  { value: 'spam', label: t('Spam, scam or impersonation') },
  { value: 'other', label: t('Something else') },
];

export type FeedTab = 'foryou' | 'following';

export const socialApi = {
  feed: (tab: FeedTab, cursor: string | null) =>
    call<{ items: FeedItem[]; next: string | null; sign_in?: boolean }>(`/api/feed?tab=${tab}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`),
  /** A video watched in the feed (counted once per card). */
  view: (id: string) => call<{ ok: true }>(`/api/views/${id}`, { method: 'POST' }),
  like: (id: string, liked: boolean) => call<{ likes: number; liked: boolean }>(`/api/likes/${id}`, { method: 'POST', body: JSON.stringify({ liked }) }),
  follow: (handle: string, following: boolean) =>
    call<{ followers: number; following: boolean }>(`/api/follows/${encodeURIComponent(handle)}`, { method: 'POST', body: JSON.stringify({ following }) }),
  myProfile: () => call<{ profile: Profile | null; change_days: number }>('/api/profile/me'),
  saveProfile: (p: { handle: string; display_name: string; bio: string }) =>
    call<{ profile: Profile; url: string }>('/api/profile/me', { method: 'POST', body: JSON.stringify(p) }),
  handle: (h: string) =>
    call<{ handle?: string; available: boolean; reason: 'invalid' | 'reserved' | 'taken' | null }>(`/api/handles/${encodeURIComponent(h)}`),
  comments: (id: string, before: string | null) =>
    call<{ items: Comment[]; next: string | null }>(`/api/comments/${id}${before ? `?before=${encodeURIComponent(before)}` : ''}`),
  comment: (id: string, text: string) => call<{ id: number }>(`/api/comments/${id}`, { method: 'POST', body: JSON.stringify({ text }) }),
  deleteComment: (id: number) => call<{ ok: true }>(`/api/comments/${id}`, { method: 'DELETE' }),
  report: (r: { kind: ReportKind; target: string; reason: ReportReason; details: string }) =>
    call<{ ok: true }>('/api/reports', { method: 'POST', body: JSON.stringify(r) }),
};

export type Metric = 'views' | 'likes' | 'comments' | 'followers';
export interface Analytics {
  days: number;
  totals: { videos: number; posted: number; views: number; likes: number; comments: number; followers: number };
  period: Record<Metric, number>;
  series: ({ day: string } & Record<Metric, number>)[];
  videos: {
    id: string;
    title: string | null;
    url: string;
    thumb_url: string | null;
    visibility: 'link' | 'public';
    created_at: number;
    views: number;
    period_views: number;
    likes: number;
    comments: number;
  }[];
  languages: { code: string; name: string; views: number; share: number }[];
}
export const analyticsApi = {
  get: (days: number) => call<Analytics>(`/api/analytics?days=${days}`),
};

export interface CreatorHit {
  handle: string;
  display_name: string | null;
  bio: string | null;
  followers: number;
}
/** PDPL rights: download my data, delete my account, correct my name. */
export const privacyApi = {
  /** Everything linked to you, as a JSON file (a Blob, to save). */
  export: async (): Promise<Blob> => {
    let res: Response;
    try {
      res = await fetch(`${BASE}/api/me/export?client_id=${clientId()}`);
    } catch {
      throw new ApiError('E_NETWORK', t('Could not reach the server. Check your connection and try again.'));
    }
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new ApiError(data?.error_code ?? 'E_HTTP', data?.message ? t(data.message) : t('Request failed ({n}).', { n: res.status }));
    }
    return res.blob();
  },
  erase: () => call<{ ok: true; deleted: { videos: number; jobs: number } }>('/api/me/delete', { method: 'POST', body: JSON.stringify({ confirm: true, client_id: clientId() }) }),
  rename: (name: string) => call<{ ok: true; name: string | null }>('/api/me/name', { method: 'POST', body: JSON.stringify({ name }) }),
};

/** "I agree to the Terms and Privacy Policy": kept with the account. */
export const consentApi = {
  give: (version: string) => call<{ ok: true }>('/api/consent', { method: 'POST', body: JSON.stringify({ version, client_id: clientId() }) }),
};

/** "Send feedback": anyone can send it; the admin reads it on the /admin page. */
export const feedbackApi = {
  send: (text: string, page: string, lang: string) =>
    call<{ ok: true }>('/api/feedback', { method: 'POST', body: JSON.stringify({ text, page, lang }) }),
};

type FeatureSource = 'server' | 'panel' | null;
export interface AdminFeatures {
  two_step: { on: boolean; source: FeatureSource };
  credits: { on: boolean; source: FeatureSource };
  limits: { max_jobs_per_hour: number; max_upload_mb: number; source: FeatureSource };
  email: { ready: boolean; from: string; key: string | null; source: FeatureSource };
  google: { ready: boolean; client_id: string; secret: string | null; redirect_uri: string; source: FeatureSource };
  stripe: { ready: boolean; key: string | null; webhook_secret: string | null; webhook_url: string; source: FeatureSource };
  telegram: { bot: string | null };
  domain: { public_domain: string; https_note: boolean };
}

export interface AuditItem {
  id: number;
  at: number;
  actor: string;
  action: string;
  target: string | null;
  detail: string | null;
  conn: string | null;
}

export interface FeedbackItem {
  id: number;
  source: 'web' | 'telegram';
  account_id: string | null;
  text: string;
  page: string | null;
  lang: string | null;
  status: 'new' | 'done';
  created_at: number;
}

export const discoverApi = {
  search: (q: string) => call<{ q: string; creators: CreatorHit[]; videos: FeedItem[]; tag: string | null }>(`/api/search?q=${encodeURIComponent(q)}`),
  tag: (tag: string) => call<{ tag: string; items: FeedItem[] }>(`/api/tags/${encodeURIComponent(tag)}`),
  trending: () => call<{ videos: (FeedItem & { week_likes: number })[]; tags: { tag: string; videos: number }[] }>('/api/trending'),
};

export type NotificationKind = 'follow' | 'like' | 'comment' | 'post';
export interface Notification {
  id: number;
  kind: NotificationKind;
  created_at: number;
  actor: { handle: string; display_name: string | null };
  video: { id: string; title: string | null; url: string; thumb: string | null } | null;
  /** The comment, for kind "comment". */
  text: string | null;
}
export interface Inbox {
  items: Notification[];
  next: string | null;
  /** Notifications newer than this one are new. */
  seen_id: number;
  unread: number;
  telegram: { linked: boolean; on: boolean };
}

export const notificationsApi = {
  unread: () => call<{ count: number }>('/api/notifications/unread'),
  list: (before: string | null) => call<Inbox>(`/api/notifications${before ? `?before=${encodeURIComponent(before)}` : ''}`),
  read: () => call<{ ok: true }>('/api/notifications/read', { method: 'POST' }),
  telegram: (on: boolean) => call<{ telegram: Inbox['telegram'] }>('/api/notifications/settings', { method: 'POST', body: JSON.stringify({ telegram: on }) }),
};

/** Open reports about one thing, for the admin's moderation queue. */
export interface ReportGroup {
  kind: ReportKind;
  target: string;
  reports: number;
  reasons: string;
  details: string | null;
  first_at: number;
  last_at: number;
  preview: {
    gone?: boolean;
    title?: string | null;
    text?: string;
    status?: string;
    name?: string | null;
    bio?: string | null;
    url?: string;
    thumb?: string | null;
    owner?: string | null;
    account_id?: string | null;
  };
}
export interface BlockedAccount {
  account_id: string;
  reason: string | null;
  created_at: number;
  handle: string | null;
}
export type ModerationAction = 'dismiss' | 'hide' | 'remove' | 'block';

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
  setOutro: (mode: OutroMode) => call<Outro>('/api/account/outro', { method: 'POST', body: JSON.stringify({ mode }) }),
  uploadOutro: (file: File) =>
    call<Outro>('/api/account/outro/file', { method: 'PUT', body: file, headers: { 'Content-Type': file.type || 'video/mp4' } }),
  deleteOutro: () => call<Outro>('/api/account/outro/file', { method: 'DELETE' }),
  outroFileUrl: () => `${BASE}/api/account/outro/file`,
  logout: () => call<{ ok: true }>('/api/auth/logout', { method: 'POST', body: '{}' }),
};

export const api = {
  config: () => call<AppConfig>('/api/config'),
  /** How downloads from a link's site are going lately (learned from every download). */
  siteStatus: (link: string) =>
    call<{ host: string | null; status: 'working' | 'trouble' | 'unknown' }>(`/api/site-status?url=${encodeURIComponent(link)}`),
  job: (id: string) => call<Job>(`/api/jobs/${id}`),
  jobs: () => call<Job[]>(`/api/jobs?client_id=${clientId()}`),
  create: (body: Record<string, unknown>) =>
    call<Job>('/api/jobs', { method: 'POST', body: JSON.stringify({ ...body, client_id: clientId() }) }),
  start: (id: string, duration?: number | null) =>
    call<Job>(`/api/jobs/${id}/start`, { method: 'POST', body: JSON.stringify({ client_id: clientId(), duration }) }),
  /** Your corrections to a translation: they teach the translation memory (signed in). */
  corrections: (id: string, cues: Cue[]) =>
    call<{ learned: number; signed_in: boolean }>(`/api/jobs/${id}/corrections`, {
      method: 'POST',
      body: JSON.stringify({
        client_id: clientId(),
        cues: cues.map(({ start, end, text, translation }) => ({ start, end, text, translation })),
      }),
    }),
  /** 👍 / 👎 on a finished video's translation or voice. */
  rate: (id: string, aspect: RatingAspect, value: 1 | -1) =>
    call<{ ratings: Partial<Record<RatingAspect, 1 | -1>> }>(`/api/jobs/${id}/rating`, {
      method: 'POST',
      body: JSON.stringify({ client_id: clientId(), aspect, value }),
    }),
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
  login: (password: string, code = '') =>
    call<{ ok: true; token: string; expires_at: number; two_factor: boolean }>('/api/admin/login', { method: 'POST', headers: auth(password), body: JSON.stringify({ code }) }),
  features: (password: string) => call<AdminFeatures>('/api/admin/features', { headers: auth(password) }),
  feature: (password: string, body: Record<string, unknown>) =>
    call<{ ok: true; token?: string; secret?: string; uri?: string; result?: unknown }>('/api/admin/features', { method: 'POST', headers: auth(password), body: JSON.stringify(body) }),
  audit: (password: string, action = '', before: number | null = null) =>
    call<{ items: AuditItem[]; next: number | null }>(`/api/admin/audit?action=${encodeURIComponent(action)}${before ? `&before=${before}` : ''}`, { headers: auth(password) }),
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
  memory: (password: string, f: { status?: string; tgt?: string; q?: string } = {}) =>
    call<{ entries: MemoryEntry[]; counts: Record<string, number>; learn_votes: number }>(
      `/api/admin/memory?${new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][])}`,
      { headers: auth(password) },
    ),
  addMemory: (password: string, e: { kind: MemoryKind; src: string; tgt: string; source: string; translation: string; replaces?: number }) =>
    call<{ id: number }>('/api/admin/memory', { method: 'POST', headers: auth(password), body: JSON.stringify(e) }),
  judgeMemory: (password: string, id: number, status: 'approved' | 'rejected') =>
    call<{ ok: true }>(`/api/admin/memory/${id}`, { method: 'POST', headers: auth(password), body: JSON.stringify({ status }) }),
  ratings: (password: string) => call<{ ratings: RatingSummary[] }>('/api/admin/ratings', { headers: auth(password) }),
  sites: (password: string) => call<{ sites: SiteMethod[] }>('/api/admin/sites', { headers: auth(password) }),
  deleteMemory: (password: string, id: number) =>
    call<{ ok: true }>(`/api/admin/memory/${id}`, { method: 'DELETE', headers: auth(password) }),
  feedback: (password: string, status: 'new' | 'done' | '' = '') =>
    call<{ items: FeedbackItem[]; counts: { new: number; done: number } }>(`/api/admin/feedback?status=${status}`, { headers: auth(password) }),
  judgeFeedback: (password: string, id: number, action: 'done' | 'new' | 'delete') =>
    call<{ ok: true }>('/api/admin/feedback', { method: 'POST', headers: auth(password), body: JSON.stringify({ id, action }) }),
  moderation: (password: string) => call<{ reports: ReportGroup[]; blocked: BlockedAccount[] }>('/api/admin/moderation', { headers: auth(password) }),
  moderate: (password: string, body: { action: ModerationAction; kind: ReportKind; target: string; reason?: string } | { action: 'unblock'; account_id: string }) =>
    call<{ ok: true }>('/api/admin/moderation', { method: 'POST', headers: auth(password), body: JSON.stringify(body) }),
  act: (password: string, action: AdminAction, ids: string[]) =>
    call<{ results: AdminActionResult[] }>('/api/admin/jobs', {
      method: 'POST',
      headers: auth(password),
      body: JSON.stringify({ action, ids }),
    }),
};

/** A rule in the translation memory (a learned or written sentence, or a glossary term). */
/** fix: a speech fix, words the speech recognition mishears and what was said (src = tgt);
 * say: how the dubbing voice says a word (src = tgt). */
export type MemoryKind = 'sentence' | 'term' | 'fix' | 'say';
export interface MemoryEntry {
  id: number;
  kind: MemoryKind;
  src: string;
  tgt: string;
  source: string;
  translation: string;
  status: 'candidate' | 'learned' | 'approved' | 'rejected';
  votes: number;
  updated_at: number;
}

/** Thumbs up and down per language pair (translation) or per language and voice (dubbing). */
export interface RatingSummary {
  aspect: RatingAspect;
  src: string;
  tgt: string;
  voice: string | null;
  up: number;
  down: number;
}

/** How downloads from a site went with one method (the Space's download strategies). */
export interface SiteMethod {
  host: string;
  strategy: string;
  ok: number;
  fail: number;
  score: number;
  updated_at: number;
}

/** An account as the /admin page sees it. */
export interface AdminAccount extends Account {
  telegram_id: number | null;
  last_seen?: number;
  balance: Balance;
  history?: LedgerEntry[];
}
