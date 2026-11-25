/**
 * The language of the server-made pages (a video's page, a profile, the Terms): Arabic or English.
 * The website keeps the visitor's choice in the `kavox_lang` cookie; without it, the browser's
 * language decides. Texts are written in English and looked up in Arabic below (a missing one
 * stays in English).
 */
import { LANGUAGES } from './languages';

export type PageLang = 'en' | 'ar';
/** A text in the page's language; `vars` fill {name} placeholders. */
export type Tr = (text: string, vars?: Record<string, string | number>) => string;

export function pageLang(request: Request): PageLang {
  const cookie = request.headers.get('Cookie') ?? '';
  const chosen = cookie.match(/(?:^|;\s*)kavox_lang=(ar|en)\b/);
  if (chosen) return chosen[1] as PageLang;
  return (request.headers.get('Accept-Language') ?? '').trim().toLowerCase().startsWith('ar') ? 'ar' : 'en';
}

const fill = (s: string, vars?: Record<string, string | number>) => {
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
};

export const translator = (lang: PageLang): Tr => (text, vars) => fill(lang === 'ar' ? (AR[text] ?? text) : text, vars);

/** English (the default) never needs a lookup. */
export const english: Tr = (text, vars) => fill(text, vars);

/** `<html lang dir>` for the page. */
export const htmlAttrs = (lang: PageLang) => `lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}"`;

/** A target language's name in the page's language. */
export const languageName = (code: string, lang: PageLang) => {
  const l = LANGUAGES.find((x) => x.code === code);
  return l ? l[lang] : code;
};

/** "1 view" / "3 views" in English; Arabic uses one form with the number. */
export const plural = (tr: Tr, n: number, one: string, many: string) => tr(n === 1 ? one : many, { n });

const AR: Record<string, string> = {
  'Translated video': 'فيديو مترجم',
  Dubbed: 'مدبلج',
  Subtitled: 'مترجم',
  '{what} in {lang} with {brand}.': '{what} إلى {lang} مع {brand}.',
  'Watch any video in your language': 'شاهد أي فيديو بلغتك',
  'Paste a link or upload a file: {brand} adds subtitles or a dubbed voice in minutes.': 'الصق رابطًا أو ارفع ملفًا: يضيف {brand} ترجمة نصية أو صوتًا مدبلجًا في دقائق.',
  'Try it →': 'جرّبه ←',
  Follow: 'متابعة',
  Following: 'تتابعه',
  '{n} view': '{n} مشاهدة',
  '{n} views': '{n} مشاهدات',
  'Copy link': 'نسخ الرابط',
  'Copy profile link': 'نسخ رابط الملف',
  Copied: 'تم النسخ',
  'Copy this link': 'انسخ هذا الرابط',
  Download: 'تنزيل',
  Report: 'إبلاغ',
  Comments: 'التعليقات',
  'Add a comment': 'أضف تعليقًا',
  Post: 'نشر',
  'More comments': 'مزيد من التعليقات',
  'More from {handle}': 'المزيد من {handle}',
  'Translated with {brand}: subtitles and dubbing for any video, in minutes.': 'مترجم بواسطة {brand}: ترجمة نصية ودبلجة لأي فيديو في دقائق.',
  Terms: 'الشروط',
  'Sign in': 'سجّل الدخول',
  'to comment.': 'للتعليق.',
  'No comments yet.': 'لا تعليقات بعد.',
  'to write the first.': 'لتكتب أول تعليق.',
  now: 'الآن',
  '{n}m': '{n} د',
  '{n}h': '{n} س',
  '{n}d': '{n} ي',
  Delete: 'حذف',
  'Delete this comment?': 'حذف هذا التعليق؟',
  'Could not post the comment.': 'تعذّر نشر التعليق.',
  'This video is not available any more.': 'هذا الفيديو لم يعد متاحًا.',
  // A profile
  'Not found': 'غير موجود',
  'No one is called {handle} on {brand}.': 'لا يوجد أحد باسم {handle} على {brand}.',
  'Translated and dubbed videos by @{handle} on {brand}.': 'فيديوهات مترجمة ومدبلجة من @{handle} على {brand}.',
  '{n} video': '{n} فيديو',
  '{n} videos': '{n} فيديوهات',
  '{n} follower': '{n} متابع',
  '{n} followers': '{n} متابعين',
  '{n} following': 'يتابع {n}',
  'No videos posted yet.': 'لم يُنشر أي فيديو بعد.',
  'Made with {brand}': 'صُنع بواسطة {brand}',
  // The report dialog
  'It uses my work (copyright)': 'يستخدم عملي (حقوق النشر)',
  'Harassment, threats or hate': 'تحرّش أو تهديد أو كراهية',
  'Sexual content': 'محتوى جنسي',
  'Violence or dangerous acts': 'عنف أو أفعال خطرة',
  'Spam, scam or impersonation': 'إزعاج أو احتيال أو انتحال شخصية',
  'Something else': 'شيء آخر',
  'Details (optional; for copyright: what you own and how to reach you)': 'تفاصيل (اختياري؛ لحقوق النشر: ما تملكه وكيف نتواصل معك)',
  Cancel: 'إلغاء',
  'Send report': 'إرسال البلاغ',
  'Report this comment': 'الإبلاغ عن هذا التعليق',
  'Report this profile': 'الإبلاغ عن هذا الملف',
  'Report this video': 'الإبلاغ عن هذا الفيديو',
  'Thank you. The report was sent and will be reviewed.': 'شكرًا لك. أُرسل البلاغ وستتم مراجعته.',
  'The report could not be sent. Try again later.': 'تعذّر إرسال البلاغ. حاول لاحقًا.',
};
