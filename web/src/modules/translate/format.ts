import type { Cue, Job } from '../../shared/api';
import { t } from '../../shared/i18n';

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
  awaiting_upload: t("Uploading…"),
  queued: t("Waiting in the queue…"),
  waking: t("Waking up the translation server (can take a couple of minutes)…"),
  downloading: t("Downloading the video…"),
  transcribing: t("Transcribing speech…"),
  translating: t("Translating…"),
  rendering: t("Burning subtitles into the video…"),
  dubbing: t("Recording the translated voice…"),
  done: t("Done"),
};

const ERROR_TEXT: Record<string, string> = {
  E_URL_INVALID: t("That link is not supported."),
  E_YOUTUBE_UNSUPPORTED:
    "YouTube blocks our server, so YouTube links can't be downloaded. Upload the video file instead: if the video is yours, download it from YouTube Studio (Content → ⋮ → Download). Facebook, Instagram and TikTok links work.",
  E_SITE_BLOCKED:
    t("The site refused our server (bot check or login required). Download the video yourself and upload the file instead."),
  E_DOWNLOAD_FAILED: t("The video could not be downloaded."),
  E_VIDEO_TOO_LONG: t("The video is too long."),
  E_FILE_TOO_LARGE: t("The file is too large."),
  E_MEDIA_INVALID: t("The file is not a readable video or audio file."),
  E_NO_SPEECH: t("No speech was detected in the video."),
  E_ASR_FAILED: t("Speech recognition failed."),
  E_NMT_FAILED: t("The translation step failed."),
  E_RENDER_FAILED: t("The subtitled video could not be rendered."),
  E_BACKEND_DOWN: t("The translation server is not responding. Please try again in a few minutes."),
  E_BACKEND_RESTARTED: t("The translation server restarted in the middle of the job. Please submit the video again."),
  E_TTS_FAILED: t("The translated voice could not be made."),
  E_NO_VOICE: t("Dubbing is not available for this language yet. Choose subtitles instead."),
  E_CANCELLED: t("Cancelled."),
};

export function jobError(job: Job): string {
  const base = ERROR_TEXT[job.error_code ?? ''] ?? t("Something went wrong.");
  const detail = ['E_DOWNLOAD_FAILED', 'E_VIDEO_TOO_LONG', 'E_NMT_FAILED', 'E_TTS_FAILED'].includes(job.error_code ?? '') ? job.error_message : '';
  return detail ? `${base} ${detail}` : base;
}

const LONG_RUN = 20; // a "word" this long was written without spaces (Chinese, Japanese): one character at a time

// Emoji and pictographs: the server drops them from burned-in subtitles (backend ass.py _EMOJI).
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{1FC00}-\u{1FFFF}\uFE0F\u20E3]/gu;

export interface Token {
  text: string;
  /** Whether a space follows it in the line. */
  space: boolean;
}

/**
 * A line's words, the way the server cuts them for dynamic captions (backend subtitles/ass.py
 * _tokens): runs written without spaces (Chinese, Japanese) one character at a time, each word
 * keeping whether a space followed it so the line is shown with exactly its own spacing.
 */
export function tokens(text: string): Token[] {
  const out: Token[] = [];
  for (const word of text.replace(EMOJI, '').split(/\s+/).filter(Boolean)) {
    const parts = word.length > LONG_RUN ? [...word] : [word];
    parts.forEach((part, i) => out.push({ text: part, space: i === parts.length - 1 }));
  }
  if (out.length) out[out.length - 1].space = false;
  return out;
}

export const words = (text: string): string[] => tokens(text).map((t) => t.text);

/**
 * When each word is spoken, estimated the way the server estimates it for burned-in dynamic captions
 * (backend subtitles/ass.py word_times): the cue's time shared out by word length, its end left quiet.
 */
export function wordTimes(list: string[], start: number, end: number): [number, number][] {
  const span = Math.max(0, end - start);
  const speech = span - Math.min(0.3, span * 0.15);
  const weights = list.map((w) => w.length + 1);
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let t = start;
  return weights.map((w) => {
    const d = (speech * w) / total;
    const span: [number, number] = [t, t + d];
    t += d;
    return span;
  });
}

/** Index of the word being spoken at `time`, or -1 before the first and after the last. */
export function wordAt(times: [number, number][], time: number): number {
  for (let i = 0; i < times.length; i++) if (time >= times[i][0] && time < (times[i + 1]?.[0] ?? times[i][1] + 0.3)) return i;
  return -1;
}
