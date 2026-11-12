import { LANGUAGES } from '../../shared/languages';

export type UiLang = 'en' | 'ar';

export function langName(code: string, ui: UiLang): string {
  const lang = LANGUAGES.find((l) => l.code === code);
  return lang ? `${lang.flag} ${lang[ui]}` : code;
}

type Dict = Record<string, string>;

const en: Dict = {
  welcome:
    '👋 <b>TarjimVideo</b>\n\nSend me a video link (YouTube, X, TikTok, Instagram, a direct file link…) or a video/audio file, and I will send back translated subtitles — or the video with the subtitles burned in.\n\nTranslating into: <b>{lang}</b>\n\n/lang — change the target language\n/status — your recent jobs\n/cancel — stop the running job',
  not_allowed: '⛔ This bot is private. Your chat id is <code>{id}</code>.',
  hint: 'Send me a video link or a video/audio file to translate. /help',
  bad_url: '⚠️ That does not look like a usable video link.',
  file_too_big:
    '⚠️ Telegram only lets bots download files up to 20 MB. Please send a link to the video instead, or upload it on the website.',
  choose: '🎬 Got it. Translating into <b>{lang}</b>.\nWhat would you like back?',
  btn_soft: '📄 Subtitle file (.srt)',
  btn_hard: '🎞 Video with subtitles',
  btn_lang: '🌐 Change language',
  btn_cancel: '✖ Cancel',
  pick_lang: '🌐 Choose the language to translate into:',
  lang_set: '✅ Target language: <b>{lang}</b>',
  expired: 'That request expired. Please send the video again.',
  rate_limited: '⏳ You reached the limit of {n} videos per hour. Please try again later.',
  busy: '⏳ You already have a video in progress. Wait for it to finish or /cancel it.',
  stage_queued: '⏳ In the queue…',
  stage_waking: '😴 Waking up the translation server (this can take a couple of minutes)…',
  stage_downloading: '⬇️ Downloading the video…',
  stage_transcribing: '🎙 Transcribing speech…',
  stage_translating: '🌐 Translating…',
  stage_rendering: '🎞 Burning subtitles into the video…',
  done: '✅ Done: <b>{title}</b>',
  done_caption: '✅ {title}\n{src} → {tgt}',
  video_caption: '🎞 {title}',
  video_link: '🎞 The subtitled video is too large to send through Telegram. Download it here (link valid for 24 hours):\n{url}',
  srt_link: '📄 Your subtitles are ready (link valid for 24 hours):\n{url}',
  audio_only_note: 'ℹ️ The source has no picture, so only the subtitle file was produced.',
  cancelled: '🛑 Cancelled.',
  nothing_to_cancel: 'There is nothing running to cancel.',
  no_jobs: 'You have no jobs yet. Send me a video link to start.',
  failed: '❌ Translation failed: {reason}',
  untitled: 'Video',
  E_URL_INVALID: 'the link is not supported.',
  E_DOWNLOAD_FAILED: 'the video could not be downloaded ({detail})',
  E_SITE_BLOCKED:
    'the site refused our server (bot check or login required). Download the video yourself and send me the file, or try another link.',
  E_VIDEO_TOO_LONG: 'the video is too long. {detail}',
  E_FILE_TOO_LARGE: 'the file is too large.',
  E_MEDIA_INVALID: 'the file is not a readable video or audio file.',
  E_NO_SPEECH: 'no speech was detected in the video.',
  E_ASR_FAILED: 'speech recognition failed.',
  E_NMT_FAILED: 'the translation step failed. {detail}',
  E_RENDER_FAILED: 'the video could not be rendered.',
  E_BACKEND_DOWN: 'the translation server is not responding. Please try again in a few minutes.',
  E_BACKEND_RESTARTED: 'the translation server restarted in the middle of the job. Please send the video again.',
  E_INTERNAL: 'an unexpected error occurred.',
};

const ar: Dict = {
  welcome:
    '👋 <b>ترجم فيديو</b>\n\nأرسل لي رابط فيديو (يوتيوب، إكس، تيك توك، إنستغرام، رابط مباشر…) أو ملف فيديو/صوت، وسأرسل لك ملف الترجمة — أو الفيديو مع الترجمة مدمجة فيه.\n\nلغة الترجمة: <b>{lang}</b>\n\n/lang — تغيير لغة الترجمة\n/status — آخر طلباتك\n/cancel — إيقاف الطلب الحالي',
  not_allowed: '⛔ هذا البوت خاص. معرّف محادثتك: <code>{id}</code>.',
  hint: 'أرسل رابط فيديو أو ملف فيديو/صوت لترجمته. /help',
  bad_url: '⚠️ هذا الرابط غير صالح للترجمة.',
  file_too_big:
    '⚠️ لا يسمح تيليجرام للبوتات بتنزيل ملفات أكبر من 20 ميغابايت. أرسل رابط الفيديو بدلاً من ذلك، أو ارفعه عبر الموقع.',
  choose: '🎬 تم الاستلام. الترجمة إلى <b>{lang}</b>.\nماذا تريد أن أرسل لك؟',
  btn_soft: '📄 ملف ترجمة (.srt)',
  btn_hard: '🎞 فيديو مع الترجمة',
  btn_lang: '🌐 تغيير اللغة',
  btn_cancel: '✖ إلغاء',
  pick_lang: '🌐 اختر اللغة التي تريد الترجمة إليها:',
  lang_set: '✅ لغة الترجمة: <b>{lang}</b>',
  expired: 'انتهت صلاحية هذا الطلب. أرسل الفيديو مرة أخرى.',
  rate_limited: '⏳ وصلت إلى الحد الأقصى ({n} فيديوهات في الساعة). حاول لاحقاً.',
  busy: '⏳ لديك فيديو قيد المعالجة. انتظر حتى ينتهي أو أرسل /cancel.',
  stage_queued: '⏳ في قائمة الانتظار…',
  stage_waking: '😴 جارٍ تشغيل خادم الترجمة (قد يستغرق دقيقتين)…',
  stage_downloading: '⬇️ جارٍ تنزيل الفيديو…',
  stage_transcribing: '🎙 جارٍ تحويل الكلام إلى نص…',
  stage_translating: '🌐 جارٍ الترجمة…',
  stage_rendering: '🎞 جارٍ دمج الترجمة في الفيديو…',
  done: '✅ تم: <b>{title}</b>',
  done_caption: '✅ {title}\n{src} ← {tgt}',
  video_caption: '🎞 {title}',
  video_link: '🎞 الفيديو المترجم أكبر من أن يُرسل عبر تيليجرام. حمّله من هنا (الرابط صالح 24 ساعة):\n{url}',
  srt_link: '📄 ملف الترجمة جاهز (الرابط صالح 24 ساعة):\n{url}',
  audio_only_note: 'ℹ️ المصدر بدون صورة، لذلك تم إنشاء ملف الترجمة فقط.',
  cancelled: '🛑 تم الإلغاء.',
  nothing_to_cancel: 'لا يوجد طلب قيد التنفيذ.',
  no_jobs: 'لا توجد طلبات بعد. أرسل رابط فيديو للبدء.',
  failed: '❌ فشلت الترجمة: {reason}',
  untitled: 'فيديو',
  E_URL_INVALID: 'الرابط غير مدعوم.',
  E_DOWNLOAD_FAILED: 'تعذّر تنزيل الفيديو ({detail})',
  E_SITE_BLOCKED:
    'الموقع رفض طلب الخادم (تحقق من الروبوتات أو يتطلب تسجيل الدخول). نزّل الفيديو وأرسل الملف نفسه، أو جرّب رابطاً آخر.',
  E_VIDEO_TOO_LONG: 'الفيديو طويل جداً. {detail}',
  E_FILE_TOO_LARGE: 'الملف كبير جداً.',
  E_MEDIA_INVALID: 'الملف ليس فيديو أو صوتاً صالحاً.',
  E_NO_SPEECH: 'لم يُعثر على كلام في الفيديو.',
  E_ASR_FAILED: 'فشل تحويل الكلام إلى نص.',
  E_NMT_FAILED: 'فشلت مرحلة الترجمة. {detail}',
  E_RENDER_FAILED: 'تعذّر إنتاج الفيديو.',
  E_BACKEND_DOWN: 'خادم الترجمة لا يستجيب. حاول مرة أخرى بعد دقائق.',
  E_BACKEND_RESTARTED: 'أُعيد تشغيل خادم الترجمة أثناء المعالجة. أرسل الفيديو مرة أخرى.',
  E_INTERNAL: 'حدث خطأ غير متوقع.',
};

const dicts: Record<UiLang, Dict> = { en, ar };

export const uiLang = (code?: string | null): UiLang => (code?.toLowerCase().startsWith('ar') ? 'ar' : 'en');

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Look up a message and fill {placeholders}. Values are inserted as-is: escape user text first. */
export function t(ui: UiLang, key: string, vars: Record<string, string | number> = {}): string {
  const template = dicts[ui][key] ?? en[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
}

export function errorText(ui: UiLang, code: string | null, detail: string | null): string {
  const key = code && dicts[ui][code] ? code : 'E_INTERNAL';
  return t(ui, 'failed', { reason: t(ui, key, { detail: esc(detail ?? '') }) });
}
