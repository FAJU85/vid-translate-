import type { Cue, Job } from '../../shared/api';

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
