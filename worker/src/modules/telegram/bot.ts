import { safeEqual } from '../../shared/crypto';
import type { Env } from '../../shared/env';
import { apiError, json } from '../../shared/http';
import { LANGUAGES, isTargetLang } from '../../shared/languages';
import { isYouTubeUrl, parseVideoUrl } from '../../shared/urls';
import {
  STYLE_PRESETS,
  SUBTITLE_BACKGROUNDS,
  SUBTITLE_ANIMATIONS,
  SUBTITLE_FONTS,
  SUBTITLE_POSITIONS,
  SUBTITLE_SIZES,
  activeJobs,
  canDub,
  canRetry,
  checkLimits,
  cancelJob,
  createJob,
  dispatch,
  getJob,
  listJobs,
  maxPerHour,
  parseSubtitleStyle,
  retryJob,
  stopJob,
  type JobRow,
  type SubtitleMode,
  type SubtitleStyle,
} from '../jobs';
import { welcomeOverride } from '../settings';
import {
  DAILY_SECONDS,
  FREE_MAX_VIDEO_SECONDS,
  SECONDS_PER_CREDIT,
  accountForTelegram,
  cancelTelegramLogin,
  chargeJob,
  checkJob,
  confirmTelegramLogin,
  creditsEnabled,
  describeTelegramLogin,
  existingTelegramAccount,
  freshBalance,
  isProduct,
  type Account,
  type ProductId,
  type Refusal,
} from '../accounts';
import { editMessage, sendMessage, tg, type Keyboard } from './api';
import { getChat, updateChat, type ChatRow } from './chats';
import { esc, langName, t, uiLang, type UiLang } from './i18n';
import { showStatus } from './presenter';
import { answerPreCheckout, buyMenu, handleSuccessfulPayment, sendStarsInvoice } from './stars';

const TELEGRAM_DOWNLOAD_LIMIT = 20 * 1024 * 1024; // Bot API getFile limit

interface Pending {
  kind: 'url' | 'telegram';
  source: string;
  title?: string;
  /** false for audio / voice messages: there is no picture to burn subtitles into. */
  video: boolean;
  /** Length in seconds as Telegram reports it (files only), to estimate the cost. */
  duration?: number;
  /** The message carrying this request's buttons; buttons on older messages are stale. */
  messageId?: number;
}

function isAllowed(env: Env, chatId: number): boolean {
  const allowed = (env.ALLOWED_CHAT_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return !allowed.length || allowed.includes(String(chatId));
}

/** "14.50" credits and "14 min 30 s" of video, for messages. */
function creditText(seconds: number): { credits: string; time: string } {
  const m = Math.floor(seconds / 60);
  return { credits: (seconds / SECONDS_PER_CREDIT).toFixed(2), time: m ? `${m} min ${seconds % 60} s` : `${seconds} s` };
}

/**
 * Set a job's credits aside. When that is not possible (spent meanwhile, or an error), the job is
 * stopped, so it can never run unpaid; its status message shows why. True when it may run.
 */
async function safeCharge(env: Env, account: Account, job: JobRow, hint?: number | null): Promise<boolean> {
  try {
    const result = await chargeJob(env, account, job, hint);
    if (result.ok) return true;
    await stopJob(env, job, REFUSAL_CODE[result.reason], '');
  } catch (err) {
    console.error('charging failed for', job.id, (err as Error).stack ?? err);
    await stopJob(env, job, 'E_INTERNAL', '');
  }
  return false;
}

const REFUSAL_CODE: Record<Refusal, string> = { credits: 'E_NO_CREDITS', free_limit: 'E_FREE_LIMIT', dub_paid: 'E_DUB_PAID' };

/** The bot's answer when a job cannot start: too few credits, too long for free, dubbing. */
async function refusalText(env: Env, ui: UiLang, account: Account, mode: SubtitleMode, hint?: number | null): Promise<string | null> {
  const result = await checkJob(env, account, mode, hint);
  if (result.ok) return null;
  const vars = { need: creditText(result.need).credits, have: creditText(result.have).credits, max: FREE_MAX_VIDEO_SECONDS };
  return t(ui, result.reason === 'credits' ? 'no_credits' : result.reason, vars);
}

const defaultLang = (env: Env) => (isTargetLang(env.DEFAULT_TARGET_LANG ?? '') ? env.DEFAULT_TARGET_LANG! : 'ar');

function chooseKeyboard(ui: UiLang, pending: Pending, tgtLang: string): Keyboard {
  const rows: Keyboard = [[{ text: t(ui, 'btn_soft'), callback_data: 'go:soft' }]];
  if (pending.video) rows[0].push({ text: t(ui, 'btn_hard'), callback_data: 'go:hard' });
  if (pending.video && canDub(tgtLang)) rows.push([{ text: t(ui, 'btn_dub'), callback_data: 'go:dub' }]);
  const last: Keyboard[number] = [{ text: t(ui, 'btn_lang'), callback_data: 'lang' }];
  if (pending.video) last.push({ text: t(ui, 'btn_style'), callback_data: 'style' });
  rows.push(last);
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
    duration: Number(media.duration) > 0 ? Number(media.duration) : undefined,
  };
}

async function handleMessage(env: Env, msg: any): Promise<void> {
  const chatId: number = msg.chat.id;
  const ui = uiLang(msg.from?.language_code);
  if (msg.chat.type !== 'private') return;

  if (!isAllowed(env, chatId)) {
    await sendMessage(env, chatId, t(ui, 'not_allowed', { id: chatId }));
    return;
  }

  const chat = await getChat(env, chatId, defaultLang(env));
  const text: string = (msg.text ?? msg.caption ?? '').trim();
  const command = text.startsWith('/') ? text.split(/[\s@]/)[0].toLowerCase() : '';

  // "Sign in with Telegram" on the website opens the bot with /start login_<code>.
  // A Stars payment went through (a pack, or a plan's first month or renewal).
  if (msg.successful_payment) {
    await handleSuccessfulPayment(env, msg, ui);
    return;
  }
  // "/buy", or the website's "Pay with Telegram Stars" (/start buy_<product>).
  const buy = command === '/start' ? /^\/start\s+buy_([a-z0-9]+)$/.exec(text) : null;
  if (buy && isProduct(buy[1])) {
    await sendStarsInvoice(env, chatId, msg.from?.id ?? chatId, ui, buy[1]);
    return;
  }
  if (command === '/buy' || buy) {
    if (!creditsEnabled(env)) {
      await sendMessage(env, chatId, t(ui, 'balance_free'));
      return;
    }
    const menu = buyMenu(env, ui);
    await sendMessage(env, chatId, menu.text, menu.keyboard);
    return;
  }
  const login = command === '/start' ? /^\/start\s+login_([A-Za-z0-9_-]{20,64})$/.exec(text) : null;
  if (login) {
    // Ask first, showing when and where the website asked: someone could send you their own link.
    const request = await describeTelegramLogin(env, login[1]);
    if (!request) {
      await sendMessage(env, chatId, t(ui, 'login_expired'));
      return;
    }
    const when = new Date(request.created_at * 1000).toISOString().slice(11, 16);
    await sendMessage(env, chatId, t(ui, 'login_confirm', { when, where: esc(request.country ?? '?') }), [
      [
        { text: t(ui, 'btn_login_yes'), callback_data: `login:${login[1]}` },
        { text: t(ui, 'btn_login_no'), callback_data: `nologin:${login[1]}` },
      ],
    ]);
    return;
  }
  if (command === '/balance') {
    if (!creditsEnabled(env)) {
      await sendMessage(env, chatId, t(ui, 'balance_free'));
      return;
    }
    const account = await accountForTelegram(env, msg.from?.id ?? chatId, msg.from?.first_name ?? null);
    const b = await freshBalance(env, account);
    const daily = b.buckets.find((x) => x.bucket === 'daily');
    let text = t(ui, 'balance', creditText(b.total_seconds));
    // Used up today's free credits: say when the next ones come.
    if (daily?.expires_at && !daily.seconds) {
      const hours = Math.max(1, Math.ceil((daily.expires_at - Date.now() / 1000) / 3600));
      text += '\n' + t(ui, 'next_daily', { hours, credits: creditText(DAILY_SECONDS).credits });
    }
    await sendMessage(env, chatId, text);
    return;
  }
  if (command === '/start' || command === '/help') {
    // A welcome message saved on the /admin page replaces the default. It is plain text, so
    // it is escaped: anything typed there is shown as written.
    const custom = await welcomeOverride(env, ui).catch(() => '');
    await sendMessage(
      env,
      chatId,
      custom ? esc(custom).replace(/\{lang\}/g, langName(chat.tgt_lang, ui)) : t(ui, 'welcome', { lang: langName(chat.tgt_lang, ui) }),
    );
    return;
  }
  if (command === '/lang') {
    await sendMessage(env, chatId, t(ui, 'pick_lang'), languageKeyboard(ui));
    return;
  }
  if (command === '/style') {
    const menu = styleMenu(ui, chatStyle(chat));
    await sendMessage(env, chatId, menu.text, menu.keyboard);
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
    if (isYouTubeUrl(url)) {
      await sendMessage(env, chatId, t(ui, 'youtube_unsupported'));
      return;
    }
    pending = { kind: 'url', source: url, video: true };
  }
  if (!pending) {
    await sendMessage(env, chatId, t(ui, 'hint'));
    return;
  }

  const sent = await sendMessage(env, chatId, t(ui, 'choose', { lang: langName(chat.tgt_lang, ui) }), chooseKeyboard(ui, pending, chat.tgt_lang));
  if (sent) await updateChat(env, chat.chat_id, chat.tgt_lang, { pending: JSON.stringify({ ...pending, messageId: sent.message_id }) });
}

// ------------------------------------------------------------------ /style

/** Colour choices offered in the bot (the website also has a full colour picker). */
const STYLE_COLORS: Record<string, string> = {
  white: '#FFFFFF',
  yellow: '#FFD400',
  cyan: '#38BDF8',
  green: '#4ADE80',
  orange: '#FB923C',
  pink: '#F472B6',
};

/** Same design (the "show the original too" switch and the voice are separate from the ready-made designs). */
const sameStyle = (a: SubtitleStyle, b: SubtitleStyle) =>
  (Object.keys(a) as (keyof SubtitleStyle)[]).every((k) => k === 'bilingual' || k === 'voice' || a[k] === b[k]);

function chatStyle(chat: ChatRow): SubtitleStyle {
  return parseSubtitleStyle(chat.style ? JSON.parse(chat.style) : null);
}

/** The colour's name in the bot, or null for a custom colour picked on the website. */
function colorName(style: SubtitleStyle): string | null {
  return Object.keys(STYLE_COLORS).find((k) => STYLE_COLORS[k] === style.color) ?? null;
}

function styleMenu(ui: UiLang, style: SubtitleStyle): { text: string; keyboard: Keyboard } {
  const mark = (on: boolean, label: string) => (on ? `✓ ${label}` : label);
  const color = colorName(style);
  const preset = (Object.keys(STYLE_PRESETS) as (keyof typeof STYLE_PRESETS)[]).find((k) => sameStyle(STYLE_PRESETS[k], style));
  const text = t(ui, 'style_menu', {
    design: preset ? t(ui, `preset_${preset}`) : t(ui, 'preset_custom'),
    font: t(ui, `font_${style.font}`),
    size: t(ui, `size_${style.size}`),
    position: t(ui, `pos_${style.position}`),
    background: t(ui, `bg_${style.background}`),
    color: color ? t(ui, `color_${color}`) : style.color,
    animation: t(ui, `anim_${style.animation}`),
  });
  const presets = (Object.keys(STYLE_PRESETS) as (keyof typeof STYLE_PRESETS)[]).map((k) => ({
    text: mark(preset === k, t(ui, `preset_${k}`)),
    callback_data: `st:preset:${k}`,
  }));
  const colors = Object.keys(STYLE_COLORS).map((v) => ({ text: mark(color === v, t(ui, `color_${v}`)), callback_data: `st:color:${v}` }));
  const keyboard: Keyboard = [
    presets.slice(0, 2),
    presets.slice(2),
    SUBTITLE_FONTS.map((v) => ({ text: mark(style.font === v, t(ui, `font_${v}`)), callback_data: `st:font:${v}` })),
    SUBTITLE_ANIMATIONS.map((v) => ({ text: mark(style.animation === v, t(ui, `anim_${v}`)), callback_data: `st:animation:${v}` })),
    SUBTITLE_SIZES.map((v) => ({ text: mark(style.size === v, t(ui, `size_${v}`)), callback_data: `st:size:${v}` })),
    SUBTITLE_POSITIONS.map((v) => ({ text: mark(style.position === v, t(ui, `pos_${v}`)), callback_data: `st:position:${v}` })),
    SUBTITLE_BACKGROUNDS.map((v) => ({ text: mark(style.background === v, t(ui, `bg_${v}`)), callback_data: `st:background:${v}` })),
    colors.slice(0, 3),
    colors.slice(3),
    [{ text: t(ui, style.bilingual ? 'bilingual_on' : 'bilingual_off'), callback_data: `st:bilingual:${style.bilingual ? 'off' : 'on'}` }],
    (['female', 'male'] as const).map((v) => ({ text: mark(style.voice === v, t(ui, `voice_${v}`)), callback_data: `st:voice:${v}` })),
  ];
  return { text, keyboard };
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
  if (!pending || pending.messageId !== messageId) {
    await editMessage(env, chat.chat_id, messageId, t(ui, 'expired'));
    return null;
  }
  const finalMode: SubtitleMode = pending.video && (mode !== 'dub' || canDub(chat.tgt_lang)) ? mode : 'soft';
  const account = creditsEnabled(env) ? await accountForTelegram(env, chat.chat_id) : null;
  if (account) {
    const refusal = await refusalText(env, ui, account, finalMode, pending.duration);
    if (refusal) return refusal;
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
    mode: finalMode,
    style: chatStyle(chat),
    origin,
    accountId: (account ?? (await existingTelegramAccount(env, chat.chat_id)))?.id ?? null,
  });
  if (!job) return t(ui, error === 'busy' ? 'busy' : 'rate_limited', { n: maxPerHour(env) });

  await updateChat(env, chat.chat_id, chat.tgt_lang, { pending: null });
  await showStatus(env, job);
  if (account && !(await safeCharge(env, account, job, pending.duration))) return null;
  ctx.waitUntil(dispatch(env, job));
  return null;
}

async function handleCallbackQuery(env: Env, ctx: ExecutionContext, origin: string, query: any): Promise<void> {
  const data: string = query.data ?? '';
  const message = query.message;
  const ui = uiLang(query.from?.language_code);
  let alert: string | null = null;

  if (message?.chat?.id && isAllowed(env, message.chat.id)) {
    const chatId: number = message.chat.id;
    const messageId: number = message.message_id;
    const chat = await getChat(env, chatId, defaultLang(env));
    const pending = chat.pending ? (JSON.parse(chat.pending) as Pending) : null;

    if (data === 'go:soft' || data === 'go:hard' || data === 'go:dub') {
      alert = await startJob(env, ctx, origin, chat, ui, messageId, data.slice(3) as SubtitleMode);
    } else if (data === 'style') {
      // From the "video with subtitles" choice: open the style menu below, keeping that message.
      const menu = styleMenu(ui, chatStyle(chat));
      await sendMessage(env, chatId, menu.text, menu.keyboard);
    } else if (data === 'lang') {
      await editMessage(env, chatId, messageId, t(ui, 'pick_lang'), languageKeyboard(ui));
    } else if (data.startsWith('setlang:')) {
      const code = data.slice(8);
      if (isTargetLang(code)) {
        await updateChat(env, chatId, code, { tgt_lang: code });
        if (pending && pending.messageId === messageId) {
          await editMessage(env, chatId, messageId, t(ui, 'choose', { lang: langName(code, ui) }), chooseKeyboard(ui, pending, code));
        } else {
          await editMessage(env, chatId, messageId, t(ui, 'lang_set', { lang: langName(code, ui) }));
        }
      }
    } else if (data.startsWith('st:')) {
      const [, field, value] = data.split(':');
      const current = chatStyle(chat);
      const next =
        field === 'preset'
          ? parseSubtitleStyle({ ...(STYLE_PRESETS[value as keyof typeof STYLE_PRESETS] ?? current), bilingual: current.bilingual, voice: current.voice })
          : field === 'bilingual'
            ? { ...current, bilingual: value === 'on' }
            : parseSubtitleStyle({ ...current, [field]: field === 'color' ? STYLE_COLORS[value] : value });
      await updateChat(env, chatId, chat.tgt_lang, { style: JSON.stringify(next) });
      const menu = styleMenu(ui, next);
      await editMessage(env, chatId, messageId, menu.text, menu.keyboard);
    } else if (data.startsWith('buy:') && isProduct(data.slice(4))) {
      await sendStarsInvoice(env, chatId, query.from?.id ?? chatId, ui, data.slice(4) as ProductId);
    } else if (data.startsWith('login:') || data.startsWith('nologin:')) {
      const [kind, code] = data.split(':');
      if (kind === 'nologin') {
        await cancelTelegramLogin(env, code);
        await editMessage(env, chatId, messageId, t(ui, 'login_cancelled'));
      } else {
        const from = query.from ?? {};
        const name = [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || null;
        const ok = await confirmTelegramLogin(env, code, { id: from.id ?? chatId, name });
        await editMessage(env, chatId, messageId, t(ui, ok ? 'login_ok' : 'login_expired'));
      }
    } else if (data.startsWith('retry:')) {
      const job = await getJob(env, data.slice(6));
      if (!job || job.chat_id !== chatId || !canRetry(job)) {
        alert = t(ui, 'retry_not_possible');
      } else {
        const limited = await checkLimits(env, { owner: job.owner, channel: 'telegram' });
        if (limited) {
          alert = t(ui, limited === 'busy' ? 'busy' : 'rate_limited', { n: maxPerHour(env) });
        } else {
          const account = creditsEnabled(env) ? await accountForTelegram(env, chatId) : null;
          const refusal = account ? await refusalText(env, ui, account, job.mode, job.duration) : null;
          if (refusal) {
            alert = refusal;
          } else {
            const copy = await retryJob(env, job); // also edits the progress message back to "queued"
            if (copy && (!account || (await safeCharge(env, account, copy, job.duration)))) ctx.waitUntil(dispatch(env, copy));
          }
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

async function handleUpdate(env: Env, ctx: ExecutionContext, origin: string, update: any): Promise<void> {
  if (update.pre_checkout_query) await answerPreCheckout(env, update.pre_checkout_query);
  else if (update.message) await handleMessage(env, update.message);
  else if (update.callback_query) await handleCallbackQuery(env, ctx, origin, update.callback_query);
}

/** The Telegram webhook endpoint. */
export async function handleWebhook(request: Request, env: Env, ctx: ExecutionContext, origin: string): Promise<Response> {
  const secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token') ?? '';
  if (!env.TELEGRAM_WEBHOOK_SECRET || !safeEqual(secret, env.TELEGRAM_WEBHOOK_SECRET)) {
    return apiError(401, 'E_UNAUTHORIZED', 'Bad webhook secret.');
  }
  const update = (await request.json().catch(() => null)) as any;
  if (update) {
    try {
      await handleUpdate(env, ctx, origin, update);
    } catch (err) {
      console.error('update failed', (err as Error).stack ?? err);
      // A payment that could not be recorded is asked for again (counting it twice is prevented by
      // its id); anything else answers 200, or Telegram would redeliver it for hours.
      if (update.message?.successful_payment) return apiError(500, 'E_PAYMENT', 'Payment not recorded yet.');
    }
  }
  return json({ ok: true });
}

let botUsername: string | null = null;

/** The bot's @username, for links on the website (null when no bot token is configured). */
export async function getBotUsername(env: Env): Promise<string | null> {
  if (!botUsername && env.TELEGRAM_BOT_TOKEN) botUsername = (await tg<{ username: string }>(env, 'getMe'))?.username ?? null;
  return botUsername;
}

const UPDATES = ['message', 'callback_query', 'pre_checkout_query'];
let updatesChecked = false;

/**
 * A bot registered before payments existed does not receive Telegram's "about to pay" questions,
 * so every Stars payment would fail. Once per Worker instance, the cron checks the registration
 * and adds what is missing (same address, same secret).
 */
export async function ensureWebhookUpdates(env: Env): Promise<void> {
  if (updatesChecked || !env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET) return;
  const info = await tg<{ url?: string; allowed_updates?: string[] }>(env, 'getWebhookInfo');
  if (!info) return; // Telegram did not answer: try again on the next cron
  if (info.url && !UPDATES.every((u) => info.allowed_updates?.includes(u))) {
    const ok = await tg(env, 'setWebhook', { url: info.url, secret_token: env.TELEGRAM_WEBHOOK_SECRET, allowed_updates: UPDATES });
    if (!ok) return;
  }
  updatesChecked = true;
}

/** Registers the webhook and the command menu with Telegram. */
export async function setupBot(env: Env, origin: string): Promise<Record<string, unknown>> {
  const webhook = await tg(env, 'setWebhook', {
    url: `${origin}/telegram/webhook`,
    secret_token: env.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: UPDATES,
  });
  const commands = (ui: UiLang) =>
    ui === 'ar'
      ? [
          { command: 'start', description: 'كيف يعمل البوت' },
          { command: 'lang', description: 'تغيير لغة الترجمة' },
          { command: 'style', description: 'تصميم الترجمة: الخط والحجم والموضع واللون' },
          { command: 'status', description: 'آخر طلباتك' },
          { command: 'balance', description: 'رصيدك' },
          { command: 'buy', description: 'شراء رصيد بنجوم تيليجرام' },
          { command: 'cancel', description: 'إيقاف الطلب الحالي' },
        ]
      : [
          { command: 'start', description: 'How the bot works' },
          { command: 'lang', description: 'Change the target language' },
          { command: 'style', description: 'Subtitle design: font, size, position, colour' },
          { command: 'status', description: 'Your recent jobs' },
          { command: 'balance', description: 'Your credits' },
          { command: 'buy', description: 'Buy credits with Telegram Stars' },
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
