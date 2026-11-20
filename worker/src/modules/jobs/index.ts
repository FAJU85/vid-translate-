/**
 * Jobs brick: owns the jobs table, talks to the backend Space, and drives each job's lifecycle.
 * Other bricks follow jobs through the JobListener port instead of being called from here.
 * This file is the brick's only public interface.
 */
export type { BackendState, Channel, JobRow, JobStatus, SourceKind, SubtitleMode } from './model';
export { TERMINAL } from './model';
export { JOBS_COLUMNS, JOBS_SCHEMA, activeJobs, allJobs, claimDelivery, deleteFinishedJobs, getJob, listJobs } from './store';
export {
  DEFAULT_STYLE,
  STYLE_PRESETS,
  SUBTITLE_BACKGROUNDS,
  SUBTITLE_FONTS,
  SUBTITLE_POSITIONS,
  SUBTITLE_SIZES,
  NO_DUB_LANGS,
  canDub,
  parseSubtitleStyle,
  type SubtitleStyle,
} from './style';
export {
  registerJobListener,
  registerSourceFetcher,
  type JobListener,
  type SourceFetcher,
  type SourceFile,
} from './events';
export {
  canRetry,
  cancelJob,
  checkLimits,
  createJob,
  dispatch,
  maxPerHour,
  refreshJob,
  retryJob,
  startUploadedJob,
  sweep,
  type LimitError,
  type NewJob,
} from './service';
export { handleBackendCallback } from './callback';
export { fileLink, health as backendHealth, uploadLink } from './backend';

import type { Env } from '../../shared/env';
import { updateJob } from './store';

/** Remember which chat message shows this job's progress (used by the Telegram brick). */
export const setStatusMessage = (env: Env, jobId: string, messageId: number) =>
  updateJob(env, jobId, { status_message_id: messageId });
