import { activeJobs, getChat, getJob, listJobs, saveChat, type ChatRow } from './db';
import { LANGUAGES, esc, isTargetLang, langName, t, uiLang, type UiLang } from './i18n';
import { cancelJob, createJob, dispatch, maxPerHour, showStatus } from './jobs';
import { editMessage, sendMessage, tg, type Keyboard } from './telegram';
import type { Env, SubtitleMode } from './types';

const TELEGRAM_DOWNLOAD_LIMIT = 20 * 1024 * 1024; // Bot API getFile limit

interface Pending {
  kind: 'url' | 'telegram';
  source: string;
  title?: string;
  /** false for audio / voice messages: there is no picture to burn subtitles into. */
  video: boolean;
}

const defaultLang = (env: Env) => (isTargetLang(env.DEFAULT_TARGET_LANG ?? '') ? env.DEFAULT_TARGET_LANG! : 'ar');

/** Accepts http(s) links to public hostnames only. */
export function parseVideoUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s<>"']+/i);
  if (!match) return null;
  try {
    const url = new URL(match[0]);
    const host = url.hostname.toLowerCase();
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    if (!host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':') || host.startsWith('[')) return null;
    if (/(^|\.)(localhost|local|internal|lan|home|corp)$/.test(host)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function chooseKeyboard(ui: UiLang, pending: Pending): Keyboard {
  const rows: Keyboard = [[{ text: t(ui, 'btn_soft'), callback_data: 'go:soft' }]];
  if (pending.video) rows[0].push({ text: t(ui, 'btn_hard'), callback_data: 'go:hard' });
  rows.push([{ text: t(ui, 'btn_lang'), callback_data: 'lang' }]);
  return rows;
}

function languageKeyboard(ui: UiLang): Keyboard {
  const rows: Keyboard = [];
  for (let i = 0; i < LANGUAGES.length; i += 3) {
    rows.push(LANGUAGES.slice(i, i + 3).map((l) => ({ text: `${l.flag} ${l[ui]}`, callback_data: `setlang:${l.code}` })));
  }
  return rows;
}

function extractMedia(msg: any): Pending | 'too_big' | null {
  const media = msg.video ?? msg.document ?? msg.audio ?? msg.voice ?? msg.video_note ?? msg.animation;
  if (!media?.file_id) return null;
  if (msg.document && !/^(video|audio)\//.test(msg.document.mime_type ?? '')) return null;
  if ((media.file_size ?? 0) > TELEGRAM_DOWNLOAD_LIMIT) return 'too_big';
  const audioOnly = Boolean(msg.audio || msg.voice) || /^audio\//.test(msg.document?.mime_type ?? '');
  const name: string | undefined = media.file_name ?? media.title;
  return {
    kind: 'telegram',
    source: media.file_id,
    title: name?.replace(/\.[a-z0-9]{2,4}$/i, '') || msg.caption?.slice(0, 80),
    video: !audioOnly,
  };
}

async function handleMessage(env: Env, msg: any): Promise<void> {
  const chatId: number = msg.chat.id;
  const ui = uiLang(msg.from?.language_code);
  if (msg.chat.type !== 'private') return;

  const allowed = (env.ALLOWED_CHAT_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (allowed.length && !allowed.includes(String(chatId))) {
    await sendMessage(env, chatId, t(ui, 'not_allowed', { id: chatId }));
    return;
  }

  const chat = await getChat(env, chatId, defaultLang(env));
  const text: string = (msg.text ?? msg.caption ?? '').trim();
  const command = text.startsWith('/') ? text.split(/[\s@]/)[0].toLowerCase() : '';

  if (command === '/start' || command === '/help') {
    await sendMessage(env, chatId, t(ui, 'welcome', { lang: langName(chat.tgt_lang, ui) }));
    return;
  }
  if (command === '/lang') {
    await sendMessage(env, chatId, t(ui, 'pick_lang'), languageKeyboard(ui));
    return;
  }
  if (command === '/status') {
    const jobs = (await listJobs(env, `tg:${chatId}`, 5)).filter((j) => j.status !== 'awaiting_upload');
    if (!jobs.length) {
      await sendMessage(env, chatId, t(ui, 'no_jobs'));
      return;
    }
    const lines = jobs.map((j) => {
      const title = esc((j.title ?? (j.source_kind === 'url' ? j.source : t(ui, 'untitled'))).slice(0, 60));
      const state =
        j.status === 'done' ? '✅' : j.status === 'failed' ? '❌' : j.status === 'cancelled' ? '🛑' : `⏳ ${j.progress}%`;
      return `${state} ${title}`;
    });
    await sendMessage(env, chatId, lines.join('\n'));
    return;
  }
  if (command === '/cancel') {
    const jobs = await activeJobs(env, `tg:${chatId}`);
    if (!jobs.length) {
      await sendMessage(env, chatId, t(ui, 'nothing_to_cancel'));
      return;
    }
    for (const job of jobs) await cancelJob(env, job);
    return;
  }
  if (command) {
    await sendMessage(env, chatId, t(ui, 'hint'));
    return;
  }

  let pending: Pending | null = null;
  const media = extractMedia(msg);
  if (media === 'too_big') {
    await sendMessage(env, chatId, t(ui, 'file_too_big'));
    return;
  }
  if (media) {
    pending = media;
  } else if (/https?:\/\//i.test(text)) {
    const url = parseVideoUrl(text);
    if (!url) {
      await sendMessage(env, chatId, t(ui, 'bad_url'));
      return;
    }
    pending = { kind: 'url', source: url, video: true };
  }
  if (!pending) {
    await sendMessage(env, chatId, t(ui, 'hint'));
    return;
  }

  await saveChat(env, { ...chat, pending: JSON.stringify(pending) });
  await sendMessage(env, chatId, t(ui, 'choose', { lang: langName(chat.tgt_lang, ui) }), chooseKeyboard(ui, pending));
}

async function startJob(
  env: Env,
  ctx: ExecutionContext,
  origin: string,
  chat: ChatRow,
  ui: UiLang,
  messageId: number,
  mode: SubtitleMode,
): Promise<string | null> {
  const pending = chat.pending ? (JSON.parse(chat.pending) as Pending) : null;
  if (!pending) {
    await editMessage(env, chat.chat_id, messageId, t(ui, 'expired'));
    return null;
  }
  const { job, error } = await createJob(env, {
    channel: 'telegram',
    owner: `tg:${chat.chat_id}`,
    chatId: chat.chat_id,
    statusMessageId: messageId,
    uiLang: ui,
    sourceKind: pending.kind,
    source: pending.source,
    title: pending.title ?? null,
    tgtLang: chat.tgt_lang,
    mode: pending.video ? mode : 'soft',
    origin,
  });
  if (!job) return t(ui, error === 'busy' ? 'busy' : 'rate_limited', { n: maxPerHour(env) });

  await saveChat(env, { ...chat, pending: null });
  await showStatus(env, job);
  ctx.waitUntil(dispatch(env, job));
  return null;
}

async function handleCallbackQuery(env: Env, ctx: ExecutionContext, origin: string, query: any): Promise<void> {
  const data: string = query.data ?? '';
  const message = query.message;
  const ui = uiLang(query.from?.language_code);
  let alert: string | null = null;

  if (message?.chat?.id) {
    const chatId: number = message.chat.id;
    const messageId: number = message.message_id;
    const chat = await getChat(env, chatId, defaultLang(env));
    const pending = chat.pending ? (JSON.parse(chat.pending) as Pending) : null;

    if (data === 'go:soft' || data === 'go:hard') {
      alert = await startJob(env, ctx, origin, chat, ui, messageId, data === 'go:hard' ? 'hard' : 'soft');
    } else if (data === 'lang') {
      await editMessage(env, chatId, messageId, t(ui, 'pick_lang'), languageKeyboard(ui));
    } else if (data.startsWith('setlang:')) {
      const code = data.slice(8);
      if (isTargetLang(code)) {
        await saveChat(env, { ...chat, tgt_lang: code });
        if (pending) {
          await editMessage(env, chatId, messageId, t(ui, 'choose', { lang: langName(code, ui) }), chooseKeyboard(ui, pending));
        } else {
          await editMessage(env, chatId, messageId, t(ui, 'lang_set', { lang: langName(code, ui) }));
        }
      }
    } else if (data.startsWith('cancel:')) {
      const job = await getJob(env, data.slice(7));
      if (job && job.chat_id === chatId) await cancelJob(env, job);
    }
  }

  await tg(env, 'answerCallbackQuery', {
    callback_query_id: query.id,
    ...(alert ? { text: alert, show_alert: true } : {}),
  });
}

export async function handleUpdate(env: Env, ctx: ExecutionContext, origin: string, update: any): Promise<void> {
  if (update.message) await handleMessage(env, update.message);
  else if (update.callback_query) await handleCallbackQuery(env, ctx, origin, update.callback_query);
}

/** Registers the webhook and the command menu with Telegram. */
export async function setupBot(env: Env, origin: string): Promise<Record<string, unknown>> {
  const webhook = await tg(env, 'setWebhook', {
    url: `${origin}/telegram/webhook`,
    secret_token: env.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ['message', 'callback_query'],
  });
  const commands = (ui: UiLang) =>
    ui === 'ar'
      ? [
          { command: 'start', description: 'كيف يعمل البوت' },
          { command: 'lang', description: 'تغيير لغة الترجمة' },
          { command: 'status', description: 'آخر طلباتك' },
          { command: 'cancel', description: 'إيقاف الطلب الحالي' },
        ]
      : [
          { command: 'start', description: 'How the bot works' },
          { command: 'lang', description: 'Change the target language' },
          { command: 'status', description: 'Your recent jobs' },
          { command: 'cancel', description: 'Stop the running job' },
        ];
  await tg(env, 'setMyCommands', { commands: commands('en') });
  await tg(env, 'setMyCommands', { commands: commands('ar'), language_code: 'ar' });
  return {
    webhook_set: webhook === true,
    webhook_url: `${origin}/telegram/webhook`,
    webhook_info: await tg(env, 'getWebhookInfo'),
  };
}
