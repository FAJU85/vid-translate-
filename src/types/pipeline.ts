export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

export type PipelineStage = 'queued' | 'downloading' | 'transcribing' | 'translating' | 'rendering' | 'done';

export type SubtitleMode = 'soft' | 'hard';

export type Channel = 'web' | 'telegram';

export type CanonicalErrorCode =
  | 'E_URL_INVALID'
  | 'E_VIDEO_TOO_LONG'
  | 'E_FILE_TOO_LARGE'
  | 'E_RATE_LIMITED'
  | 'E_ASR_FAILED'
  | 'E_NMT_FAILED'
  | 'E_RENDER_FAILED'
  | 'E_BACKEND_DOWN'
  | 'E_JOB_NOT_FOUND'
  | 'E_CANCELLED';

export interface SubtitleCue {
  id: number;
  start: string; // "00:00:01,200"
  end: string;   // "00:00:04,500"
  startMs: number;
  endMs: number;
  originalText: string;
  translatedText: string;
}

export interface Job {
  id: string;
  channel: Channel;
  user_ref: string;
  video_url: string | null;
  video_title?: string;
  video_duration?: number; // seconds
  youtube_id?: string;
  thumbnail_url?: string;
  r2_input_key: string | null;
  src_lang: string;
  tgt_lang: string;
  subtitle_mode: SubtitleMode;
  status: JobStatus;
  stage: PipelineStage;
  progress: number; // 0..100
  srt_key: string | null;
  soft_key: string | null;
  hard_key: string | null;
  error_code: CanonicalErrorCode | null;
  error_message?: string | null;
  created_at: number; // epoch seconds
  updated_at: number; // epoch seconds
  stage_durations?: Record<string, number>; // in ms
  cues?: SubtitleCue[];
}

export interface UserTranslationRecord {
  id: string;
  userId: string;
  userEmail?: string;
  videoUrl: string;
  videoTitle: string;
  videoDuration: number;
  youtubeId?: string;
  thumbnailUrl?: string;
  srcLang: string;
  tgtLang: string;
  subtitleMode: SubtitleMode;
  status: JobStatus;
  stage: PipelineStage;
  progress: number;
  cues: SubtitleCue[];
  createdAt: string;
  updatedAt: string;
  isShared: boolean;
}

export interface BackendInvokeRequest {
  job_id: string;
  video_url?: string;
  src_lang: string;
  tgt_lang: string;
  subtitle_mode: SubtitleMode;
  callback_url: string;
}

export interface BackendInvokeResponse {
  job_id: string;
  status: 'accepted' | 'rejected';
  error?: string;
}

export interface BackendStatusResponse {
  job_id: string;
  status: JobStatus;
  stage: PipelineStage;
  progress: number;
  outputs?: {
    srt_url?: string;
    vtt_url?: string;
    soft_mp4_url?: string;
    hard_mp4_url?: string;
  };
  error?: {
    code: CanonicalErrorCode;
    message: string;
  };
}

export interface StructuredLog {
  id: string;
  ts: string;
  service: 'api-gateway' | 'telegram-worker' | 'hf-backend' | 'd1-jobs' | 'r2-media' | 'queue-worker';
  level: 'info' | 'warn' | 'error' | 'debug';
  job_id?: string;
  channel?: Channel;
  stage?: PipelineStage;
  duration_ms?: number;
  error_code?: CanonicalErrorCode | string;
  message: string;
  ip?: string;
}

export interface SreMetrics {
  timestamp: string;
  slo: {
    apiGatewayAvailability: { current: number; target: number; status: 'ok' | 'warning' | 'breach' };
    submissionLatencyP95: { currentMs: number; targetMs: number; status: 'ok' | 'warning' | 'breach' };
    pipelineSuccessRate: { current: number; target: number; status: 'ok' | 'warning' | 'breach' };
    pipelineLatencyUnder5m: { currentMin: number; targetMin: number; status: 'ok' | 'warning' | 'breach' };
    pipelineLatency5to20m: { currentMin: number; targetMin: number; status: 'ok' | 'warning' | 'breach' };
    pipelineLatency20to60m: { currentMin: number; targetMin: number; status: 'ok' | 'warning' | 'breach' };
    callbackAcceptanceRate: { current: number; target: number; status: 'ok' | 'warning' | 'breach' };
    telegramWebhookAvailability: { current: number; target: number; status: 'ok' | 'warning' | 'breach' };
  };
  errorBudgets: {
    apiGateway: { remaining: number; burnRate: number };
    pipeline: { remaining: number; burnRate: number };
    telegram: { remaining: number; burnRate: number };
  };
  goldenSignals: {
    worker5xxRate: number; // percentage
    workerP95Ms: number;
    hfEndpoint5xxRate: number;
    hfQueueDepth: number;
    d1WriteErrors: number;
    r2UploadFailures: number;
    callbackUnsignedRejects: number;
    telegramWebhook4xxRate: number;
  };
  costAndCapacity: {
    hfInferenceMinutesToday: number;
    hfActiveReplicas: number;
    r2StorageGB: number;
    d1RowsCount: number;
    workerRequestsToday: number;
  };
  security: {
    authFailures24h: number;
    rateLimitHits24h: number;
    ssrfBlockedUrls24h: number;
    invalidHmacCallbacks24h: number;
  };
  activeAlerts: Array<{
    id: string;
    level: 'P1' | 'P2' | 'P3';
    title: string;
    service: string;
    timestamp: string;
    description: string;
    runbookId?: string;
  }>;
}
