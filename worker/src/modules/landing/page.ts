import type { Env } from '../../shared/env';
import { LANGUAGES } from '../../shared/languages';
import { FONT, PALETTE, SHARE_IMAGE, brandHeader, chromeCss, headLinks } from '../../shared/page-chrome';
import { htmlAttrs, type PageLang } from '../../shared/page-i18n';
import { creditsEnabled } from '../accounts';
import { logoSize, publicOrigin, publicSettings } from '../settings';

/**
 * Pages for search engines and for people who search: one per journey (translate a video, make a
 * lyrics video), in English and in Arabic, each at its own address so both can be found. They say
 * only what the product really does, and lead to the page where it is done.
 */

type Journey = 'translate' | 'lyrics';
export const LANDING_PATHS: Record<string, { journey: Journey; lang: PageLang }> = {
  '/translate-video': { journey: 'translate', lang: 'en' },
  '/ar/translate-video': { journey: 'translate', lang: 'ar' },
  '/lyrics-video': { journey: 'lyrics', lang: 'en' },
  '/ar/lyrics-video': { journey: 'lyrics', lang: 'ar' },
};
const pathFor = (journey: Journey, lang: PageLang) => `${lang === 'ar' ? '/ar' : ''}/${journey === 'translate' ? 'translate' : 'lyrics'}-video`;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

interface Copy {
  title: string;
  description: string;
  h1: string;
  lead: string;
  cta: string;
  steps: [string, string][];
  features: [string, string][];
  faq: [string, string][];
  other: string;
}

function copy(journey: Journey, lang: PageLang, brand: string, free: boolean): Copy {
  const names = LANGUAGES.map((l) => (lang === 'ar' ? l.ar : l.en)).join(lang === 'ar' ? '، ' : ', ');
  const n = LANGUAGES.length;
  if (lang === 'ar') {
    const freeAnswer = free ? 'نعم، ومن غير تسجيل.' : 'لك دقائق مجانية كل يوم، ويمكنك شراء رصيد لما يزيد عليها.';
    if (journey === 'translate')
      return {
        title: `ترجمة الفيديو${free ? ' مجانًا' : ''}: ترجمة نصية ودبلجة بلغتك | ${brand}`,
        description: `ترجم أي فيديو إلى ${n} لغة: ترجمة نصية (SRT وVTT)، أو فيديو بالترجمة عليه، أو صوت مدبلج. الصق رابطًا أو ارفع ملفًا${free ? '، مجانًا ومن غير تسجيل' : ''}.`,
        h1: 'ترجم أي فيديو إلى لغتك',
        lead: `الصق رابطًا أو ارفع ملفًا. يستمع ${brand} إلى الكلام ويترجمه، ثم يعطيك ملف ترجمة، أو الفيديو والترجمة عليه، أو صوتًا مدبلجًا بلغتك.`,
        cta: 'ترجم فيديو الآن',
        steps: [
          ['أضف الفيديو', 'رابط عام (فيسبوك، إنستغرام، تيك توك وغيرها) أو ملف من جهازك.'],
          ['اختر اللغة والنتيجة', 'ملف ترجمة، أو ترجمة على الفيديو، أو دبلجة.'],
          ['نزّله أو شاركه', 'نزّل النتيجة، أو شارك رابطها، أو انشره ليشاهده الجميع.'],
        ],
        features: [
          ['ملفات ترجمة', 'SRT وVTT لأي مشغّل أو منصة.'],
          ['ترجمة على الفيديو', 'فيديو جاهز للنشر والترجمة مكتوبة عليه، بالخط والحجم الذي تختاره.'],
          ['دبلجة', 'صوت مترجم يقرأ الكلام بلغتك.'],
          [`${n} لغة`, names + '.'],
          ['العربية أولًا', 'الموقع كله بالعربية أو الإنجليزية، والكتابة من اليمين إلى اليسار كما يجب.'],
          ['بوت تيليجرام', 'أرسل فيديو إلى البوت واستلمه مترجمًا من غير أن تغادر المحادثة.'],
        ],
        faq: [
          ['هل الخدمة مجانية؟', freeAnswer],
          ['ما اللغات المتاحة؟', `${n} لغة: ${names}.`],
          ['أي الروابط تعمل؟', 'الروابط العامة من فيسبوك وإنستغرام وتيك توك ومواقع كثيرة غيرها، والروابط المباشرة لملفات الفيديو والصوت. روابط يوتيوب غير مدعومة: ارفع الملف بدلًا منها.'],
          ['هل أحصل على ملف ترجمة فقط؟', 'نعم: SRT أو VTT، أو الفيديو والترجمة عليه، أو الدبلجة.'],
          ['هل يعمل على الجوال؟', 'نعم، في المتصفح، ويمكن تثبيته كتطبيق، وعبر بوت تيليجرام أيضًا.'],
        ],
        other: 'أو حوّل أغنية إلى فيديو كلمات',
      };
    return {
      title: `صانع فيديو كلمات الأغاني${free ? ' مجانًا' : ''}: كلمات متزامنة وترجمة | ${brand}`,
      description: `حوّل أي أغنية إلى فيديو كلمات: مؤثرات تتحرك مع الموسيقى، وكل كلمة تضيء حين تُغنّى، وترجمة في سطر خاص بها. عمودي أو مربع أو عريض${free ? '، مجانًا' : ''}.`,
      h1: 'حوّل أي أغنية إلى فيديو كلمات',
      lead: `ارفع أغنية أو الصق رابطًا. يكتب ${brand} الكلمات، ويضيء كل كلمة حين تُغنّى فوق مؤثرات تتحرك مع الموسيقى، ويضيف ترجمتها في سطر خاص بها إن أردت.`,
      cta: 'اصنع فيديو كلمات',
      steps: [
        ['أضف الأغنية', 'ملف صوت أو فيديو، أو رابط عام. من الفيديو يُؤخذ الصوت فقط.'],
        ['اختر الشكل', 'المؤثرات (موجة، نيون، أعمدة)، والخلفية، والمقاس، وهل تريد ترجمة.'],
        ['انشره', 'فيديو جاهز لريلز وتيك توك وشورتس.'],
      ],
      features: [
        ['كلمات متزامنة', 'كل كلمة تضيء في وقتها، كالكاريوكي.'],
        ['مؤثرات مع الموسيقى', 'موجة أو نيون أو أعمدة، فوق تدرّج لوني أو صورة الغلاف.'],
        ['كل المقاسات', 'عمودي 9:16، ومربع 1:1، وعريض 16:9.'],
        ['ترجمة مستقلة', `ترجمة الكلمات إلى لغة من ${n} لغة في سطر خاص بها، أو من غير ترجمة.`],
        ['أغانٍ حتى 15 دقيقة', 'للأغنية الكاملة أو لمقطع منها.'],
      ],
      faq: [
        ['هل الخدمة مجانية؟', freeAnswer],
        ['أي الأغاني أستطيع استخدامها؟', 'أغانيك أنت، أو أغانٍ يسمح أصحابها باستخدامها. أنت مسؤول عن حقوق ما ترفعه أو تنشره.'],
        ['هل يمكن ترجمة الكلمات؟', `نعم، إلى أي لغة من ${n} لغة، في سطر مستقل تحت الكلمات الأصلية.`],
        ['ما المقاسات المتاحة؟', 'عمودي 9:16 لريلز وتيك توك وشورتس، ومربع 1:1، وعريض 16:9.'],
        ['هل أستطيع استخدام فيديو؟', 'نعم: يُؤخذ صوته فقط، وتُصنع الصورة من جديد.'],
      ],
      other: 'أو ترجم فيديو إلى لغتك',
    };
  }
  const freeAnswer = free ? 'Yes, and with no sign-up.' : 'You get free minutes every day; credits pay for more.';
  if (journey === 'translate')
    return {
      title: `Translate any video${free ? ' free' : ''}: subtitles and dubbing | ${brand}`,
      description: `Translate a video into ${n} languages: subtitle files (SRT, VTT), the video with subtitles, or a dubbed voice. Paste a link or upload a file${free ? '. Free, no sign-up' : ''}.`,
      h1: 'Translate any video into your language',
      lead: `Paste a link or upload a file. ${brand} listens to the speech, translates it, and gives you a subtitle file, the video with subtitles on it, or a dubbed voice in your language.`,
      cta: 'Translate a video now',
      steps: [
        ['Add the video', 'A public link (Facebook, Instagram, TikTok and more) or a file from your device.'],
        ['Pick the language and the result', 'A subtitle file, subtitles on the video, or dubbing.'],
        ['Download or share', 'Download it, share a link, or post it for everyone to watch.'],
      ],
      features: [
        ['Subtitle files', 'SRT and VTT, for any player or platform.'],
        ['Subtitles on the video', 'A video ready to post with the subtitles on it, in the font and size you choose.'],
        ['Dubbing', 'A translated voice that reads the speech in your language.'],
        [`${n} languages`, names + '.'],
        ['Arabic-first', 'The whole site in Arabic or English, with right-to-left done properly.'],
        ['A Telegram bot', 'Send a video to the bot and get it back translated, without leaving the chat.'],
      ],
      faq: [
        ['Is it free?', freeAnswer],
        ['Which languages?', `${n}: ${names}.`],
        ['Which links work?', 'Public links from Facebook, Instagram, TikTok and many other sites, and direct links to video or audio files. YouTube links are not supported: upload the file instead.'],
        ['Can I get just a subtitle file?', 'Yes: SRT or VTT, or the video with subtitles on it, or dubbing.'],
        ['Does it work on a phone?', 'Yes, in the browser (it can be installed as an app), and through the Telegram bot.'],
      ],
      other: 'Or turn a song into a lyrics video',
    };
  return {
    title: `Lyrics video maker${free ? ', free' : ''}: synced words and translation | ${brand}`,
    description: `Turn any song into a lyrics video: visuals that move with the music, every word lit as it is sung, and a translation in its own caption. Vertical, square or wide${free ? '. Free' : ''}.`,
    h1: 'Turn any song into a lyrics video',
    lead: `Upload a song or paste a link. ${brand} writes down the words, lights each one as it is sung over visuals that move with the music, and can add a translation in its own caption.`,
    cta: 'Make a lyrics video',
    steps: [
      ['Add the song', 'An audio or video file, or a public link. From a video, only the sound is used.'],
      ['Pick the look', 'The visuals (wave, neon, bars), the backdrop, the size, and whether to add a translation.'],
      ['Post it', 'A video ready for Reels, TikTok and Shorts.'],
    ],
    features: [
      ['Synced words', 'Every word lights up as it is sung, karaoke style.'],
      ['Visuals that move with the music', 'Wave, neon or bars, over a colour gradient or the cover art.'],
      ['Every size', 'Vertical 9:16, square 1:1 and wide 16:9.'],
      ['A separate translation', `The lyrics translated into one of ${n} languages, in their own caption, or no translation at all.`],
      ['Songs up to 15 minutes', 'A whole song or a part of it.'],
    ],
    faq: [
      ['Is it free?', freeAnswer],
      ['Which songs can I use?', 'Your own, or songs whose owners allow it. You are responsible for the rights to what you upload or post.'],
      ['Can it translate the lyrics?', `Yes, into any of ${n} languages, in a separate caption under the original words.`],
      ['Which sizes?', 'Vertical 9:16 for Reels, TikTok and Shorts, square 1:1 and wide 16:9.'],
      ['Can I use a video?', 'Yes: only its sound is used, and the picture is made new.'],
    ],
    other: 'Or translate a video into your language',
  };
}

/** GET a landing page (LANDING_PATHS), or null for any other address. */
export async function handleLandingPage(request: Request, env: Env, path: string, origin: string): Promise<Response | null> {
  const page = LANDING_PATHS[path.replace(/\/+$/, '') || '/'];
  if (!page || (request.method !== 'GET' && request.method !== 'HEAD')) return null;
  const { journey, lang } = page;
  const site = await publicSettings(env).catch(() => null);
  const base = await publicOrigin(env, origin);
  const brand = esc(site?.name || 'KAVOX');
  const accent = /^#[0-9a-f]{6}$/i.test(site?.accent ?? '') ? site!.accent : PALETTE.teal;
  const logo = site?.logo_url || undefined;
  const c = copy(journey, lang, brand, !creditsEnabled(env));
  // The app opens on the right page, in the page's language; the visit counts as "seo".
  const app = `/?tab=${journey}&amp;lang=${lang}&amp;ref=seo-${journey}${lang === 'ar' ? '-ar' : ''}`;
  const otherJourney: Journey = journey === 'translate' ? 'lyrics' : 'translate';
  const alt = (l: PageLang) => `${base}${pathFor(journey, l)}`;
  const faqLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: c.faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
  };
  const appLd = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: site?.name || 'KAVOX',
    url: `${base}/`,
    applicationCategory: 'MultimediaApplication',
    operatingSystem: 'Any',
    inLanguage: lang,
    ...(creditsEnabled(env) ? {} : { offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' } }),
  };
  const ld = (o: unknown) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`;
  const html = `<!doctype html>
<html ${htmlAttrs(lang)}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${c.title}</title>
<meta name="description" content="${c.description}">
<link rel="canonical" href="${alt(lang)}">
<link rel="alternate" hreflang="en" href="${alt('en')}">
<link rel="alternate" hreflang="ar" href="${alt('ar')}">
<link rel="alternate" hreflang="x-default" href="${alt('en')}">
<meta property="og:type" content="website">
<meta property="og:title" content="${c.title}">
<meta property="og:description" content="${c.description}">
<meta property="og:url" content="${alt(lang)}">
<meta property="og:locale" content="${lang === 'ar' ? 'ar_SA' : 'en_US'}">
<meta property="og:image" content="${base}${SHARE_IMAGE}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${base}${SHARE_IMAGE}">
${headLinks(logo)}
${ld(appLd)}
${ld(faqLd)}
<style>
  :root { color-scheme: dark; --accent: ${accent}; }
  body { margin: 0; background: ${PALETTE.navy}; color: ${PALETTE.muted}; font: 16px/1.65 ${FONT}; }
  main { max-width: 860px; margin: 0 auto; padding: 24px 16px 56px; }
  h1 { color: ${PALETTE.cream}; font-size: clamp(28px, 6vw, 42px); line-height: 1.15; margin: 28px 0 12px; }
  h2 { color: ${PALETTE.cream}; font-size: 20px; margin: 40px 0 12px; }
  .lead { font-size: 18px; max-width: 640px; }
  .go { display: inline-block; margin-top: 16px; padding: 12px 20px; border-radius: 12px; background: var(--accent); color: ${PALETTE.navy}; font-weight: 800; text-decoration: none; }
  .go:hover { filter: brightness(1.08); }
  ol.steps { list-style: none; padding: 0; display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); counter-reset: s; }
  ol.steps li, .feat > div { padding: 16px; border-radius: 14px; border: 1px solid #2E3D63; background: rgba(255,255,255,.02); }
  ol.steps li::before { counter-increment: s; content: counter(s); display: inline-grid; place-items: center; width: 28px; height: 28px; border-radius: 8px; background: var(--accent); color: ${PALETTE.navy}; font-weight: 800; margin-bottom: 8px; }
  b, dt { color: ${PALETTE.cream}; }
  .feat { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
  .feat b, ol.steps b { display: block; }
  dl dt { font-weight: 700; margin-top: 16px; } dl dd { margin: 4px 0 0; }
  .other { display: inline-block; margin-top: 32px; color: var(--accent); }
  .langs { margin-top: 40px; font-size: 13px; } .langs a { color: ${PALETTE.muted}; }
${chromeCss}
</style>
</head>
<body>
<main>
${brandHeader(brand, logo, logoSize(site))}
<h1>${c.h1}</h1>
<p class="lead">${c.lead}</p>
<a class="go" href="${app}">${c.cta}</a>
<h2>${lang === 'ar' ? 'كيف يعمل' : 'How it works'}</h2>
<ol class="steps">${c.steps.map(([h, p]) => `<li><b>${h}</b>${p}</li>`).join('')}</ol>
<h2>${lang === 'ar' ? 'ما الذي تحصل عليه' : 'What you get'}</h2>
<div class="feat">${c.features.map(([h, p]) => `<div><b>${h}</b>${p}</div>`).join('')}</div>
<h2>${lang === 'ar' ? 'أسئلة شائعة' : 'Questions'}</h2>
<dl>${c.faq.map(([q, a]) => `<dt>${q}</dt><dd>${a}</dd>`).join('')}</dl>
<a class="go" href="${app}">${c.cta}</a><br>
<a class="other" href="${pathFor(otherJourney, lang)}">${c.other} →</a>
<p class="langs"><a href="${pathFor(journey, lang === 'ar' ? 'en' : 'ar')}" hreflang="${lang === 'ar' ? 'en' : 'ar'}">${lang === 'ar' ? 'English' : 'العربية'}</a> · <a href="/terms">${lang === 'ar' ? 'الشروط' : 'Terms'}</a> · <a href="/privacy">${lang === 'ar' ? 'الخصوصية' : 'Privacy'}</a></p>
</main>
</body>
</html>`;
  return new Response(request.method === 'HEAD' ? null : html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=600', 'Content-Language': lang },
  });
}

/** The landing pages' addresses, for the sitemap. */
export const landingPaths = () => Object.keys(LANDING_PATHS);
