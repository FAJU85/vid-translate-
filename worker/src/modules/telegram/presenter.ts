import type { Env } from '../../shared/env';
import { TERMINAL, canRetry, claimDelivery, fileLink, setStatusMessage, type JobListener, type JobRow } from '../jobs';
import { shareUrl } from '../shares';
import { editMessage, sendFile, sendMessage, type Keyboard } from './api';
import { errorText, esc, langName, t, type UiLang } from './i18n';

const TELEGRAM_UPLOAD_LIMIT = 49 * 1024 * 1024; // bots may upload up to 50 MB
const LINK_TTL = 24 * 3600;

function jobTitle(job: JobRow): string {
  if (job.title) return job.title;
  if (job.source_kind === 'url') {
    try {
      return new URL(job.source).hostname.replace(/^www\./, '');
    } catch {
      /* fall through */
    }
  }
  return t(job.ui_lang as UiLang, 'untitled');
}

function statusText(job: JobRow): string {
  const ui = job.ui_lang as UiLang;
  const title = esc(jobTitle(job));
  if (job.status === 'done') return t(ui, 'done', { title });
  if (job.status === 'cancelled') return t(ui, 'cancelled');
  if (job.status === 'failed') return errorText(ui, job.error_code, job.error_message);
  const waking = job.status === 'queued' && !job.dispatched && job.dispatch_attempts > 0;
  const stage = waking ? 'stage_waking' : `stage_${job.status === 'queued' ? 'queued' : job.stage}`;
  const filled = Math.round(job.progress / 10);
  const bar = '▓'.repeat(filled) + '░'.repeat(10 - filled);
  const min = String(Math.max(1, Math.round((job.eta ?? 0) / 60)));
  const wait =
    job.status === 'queued' && job.dispatched && (job.queue_position ?? 0) >= 1 && job.eta
      ? `\n${t(ui, 'queue_line', { n: String(job.queue_position), min })}`
      : job.status === 'running' && job.eta
        ? `\n${t(ui, 'eta_line', { min })}`
        : '';
  return `🎬 <b>${title}</b>\n${bar} ${job.progress}%\n${t(ui, stage)}${wait}`;
}

/** Create or update the single progress message of a Telegram job. */
export async function showStatus(env: Env, job: JobRow): Promise<void> {
  if (job.channel !== 'telegram' || !job.chat_id) return;
  const ui = job.ui_lang as UiLang;
  const keyboard: Keyboard = !TERMINAL.includes(job.status)
    ? [[{ text: t(ui, 'btn_cancel'), callback_data: `cancel:${job.id}` }]]
    : canRetry(job)
      ? [[{ text: t(ui, 'btn_retry'), callback_data: `retry:${job.id}` }]]
      : [];
  if (job.status_message_id) {
    await editMessage(env, job.chat_id, job.status_message_id, statusText(job), keyboard);
  } else {
    const sent = await sendMessage(env, job.chat_id, statusText(job), keyboard);
    if (sent) await setStatusMessage(env, job.id, sent.message_id);
  }
}

function fileBase(job: JobRow): string {
  const base = (job.title ?? '')
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return base || 'subtitles';
}

/** Send the finished files into the Telegram chat (exactly once per job). */
async function deliver(env: Env, job: JobRow): Promise<void> {
  if (job.channel !== 'telegram' || !job.chat_id) return;
  if (!(await claimDelivery(env, job.id))) return;

  const ui = job.ui_lang as UiLang;
  const chatId = String(job.chat_id);
  const title = esc(jobTitle(job));
  const outputs = JSON.parse(job.outputs || '{}') as Record<string, string>;
  const base = fileBase(job);

  const srtName = `${base}.${job.tgt_lang}.srt`;
  const srtUrl = await fileLink(env, job.id, 'subtitles.srt', LINK_TTL, srtName);
  const caption = t(ui, 'done_caption', {
    title,
    src: langName(job.detected_lang ?? job.src_lang, ui),
    tgt: langName(job.tgt_lang, ui),
  });
  const srtSent = await sendFile(env, 'sendDocument', 'document', await fetch(srtUrl), srtName, {
    chat_id: chatId,
    caption,
    parse_mode: 'HTML',
  });
  if (!srtSent) await sendMessage(env, job.chat_id, t(ui, 'srt_link', { url: esc(srtUrl) }));

  // The video: subtitles burned in (hard) or the translation spoken over it (dub).
  const video = job.mode === 'hard' ? { key: 'mp4', file: 'video.mp4', name: `${base}.${job.tgt_lang}.mp4` }
    : job.mode === 'dub' ? { key: 'dubbed', file: 'dubbed.mp4', name: `${base}.${job.tgt_lang}.dubbed.mp4` } : null;
  if (video) {
    if (outputs[video.key]) {
      const videoUrl = await fileLink(env, job.id, video.file, LINK_TTL, video.name);
      // A network error must still end in the link below: the delivery is already claimed.
      const res = await fetch(videoUrl).catch(() => null);
      let sent = false;
      if (res?.ok && Number(res.headers.get('content-length')) <= TELEGRAM_UPLOAD_LIMIT) {
        sent = await sendFile(env, 'sendVideo', 'video', res, video.name, {
          chat_id: chatId,
          caption: t(ui, job.mode === 'dub' ? 'dub_caption' : 'video_caption', { title }),
          parse_mode: 'HTML',
          supports_streaming: 'true',
        });
      } else {
        await res?.body?.cancel();
      }
      if (!sent) await sendMessage(env, job.chat_id, t(ui, job.mode === 'dub' ? 'dub_link' : 'video_link', { url: esc(videoUrl) }));
    } else {
      await sendMessage(env, job.chat_id, t(ui, 'audio_only_note'));
    }
    // The video's public page (shares brick), when it has one.
    const page = await shareUrl(env, job).catch(() => null);
    if (page) await sendMessage(env, job.chat_id, t(ui, 'share_link', { url: esc(page) }), [[{ text: t(ui, 'btn_share'), url: page }]]);
  }
  await showStatus(env, job);
}

/** Plugs Telegram into the jobs brick: progress edits one message, results are sent as files. */
export const telegramJobListener: JobListener = {
  changed: showStatus,
  finished: deliver,
};
