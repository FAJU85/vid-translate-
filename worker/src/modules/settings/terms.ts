import type { Env } from '../../shared/env';
import { logoSize, readSettings } from './store';
import { FONT, brandHeader, chromeCss, headLinks } from '../../shared/page-chrome';
import { htmlAttrs, pageLang } from '../../shared/page-i18n';
import { LEGAL_VERSION } from './privacy';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * GET /terms: the rules for posting on the platform and how to ask for something to be taken down.
 * Plain defaults with the platform's name and the admin's takedown address; not legal advice.
 */
export async function handleTermsPage(request: Request, env: Env, path: string): Promise<Response | null> {
  if (path !== '/terms' || (request.method !== 'GET' && request.method !== 'HEAD')) return null;
  const lang = pageLang(request);
  const settings = (await readSettings(env).catch(() => null))?.settings;
  const brand = esc(settings?.name || 'KAVOX');
  const accent = /^#[0-9a-f]{6}$/i.test(settings?.accent ?? '') ? settings!.accent : '#2AB8A1';
  const logo = settings?.logo ? '/api/logo' : undefined;
  const email = settings?.takedown_email || '';
  const contact = email
    ? `<a href="mailto:${esc(email)}">${esc(email)}</a>`
    : lang === 'ar'
      ? 'العنوان الذي تنشره المنصة هنا (لم يُحدَّد بعد)'
      : 'the address the platform publishes here (not set yet)';
  const html = `<!doctype html>
<html ${htmlAttrs(lang)}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${lang === 'ar' ? 'شروط الاستخدام' : 'Terms of use'} · ${brand}</title>
${headLinks(logo)}
<style>
  :root { color-scheme: dark; --accent: ${accent}; }
  body { margin: 0; background: #131C31; color: #CBC2B5; font: 15px/1.65 ${FONT}; }
  main { max-width: 760px; margin: 0 auto; padding: 24px 16px 48px; }
  h1 { color: #F9EBD6; font-size: 26px; } h2 { color: #F9EBD6; font-size: 18px; margin-top: 28px; }
  a { color: var(--accent); }
  .meta { color: #8F8B88; font-size: 13px; margin-top: 0; }
${chromeCss}
</style>
</head>
<body>
<main>
${brandHeader(brand, logo, logoSize(settings))}
${lang === 'ar' ? arabic(brand, contact) : english(brand, contact)}
</main>
</body>
</html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

/** The terms in English (`brand` and `contact` are already HTML). */
const english = (brand: string, contact: string) => `<h1>Terms of use</h1>
<p class="meta">Version ${LEGAL_VERSION}</p>
<p>${brand} is a tool that translates, subtitles and dubs videos, and lets people post the results on their profile. By using it, and above all by translating, posting or commenting, you agree to these terms and to the <a href="/privacy">Privacy Policy</a>. If you do not agree, do not use ${brand}.</p>

<h2>1. Your content is your responsibility</h2>
<p>You are solely responsible for every file you upload, every link you send, and everything you post or comment, and for having the right to use it. Only translate, post or share videos you own, or whose owner allows it (or where the law allows it). Translating a video does not make it yours, and does not give you any right to the original.</p>
<p>By uploading or posting, you confirm that you hold the necessary rights and that the content breaks no law, including the intellectual property, privacy and anti-cybercrime laws of Saudi Arabia. You keep ownership of what you upload; you give ${brand} only the permission it needs to process, store and show it as you choose (for example, on your profile when you post it).</p>

<h2>2. Limitation of liability</h2>
<p>${brand} does not check content before it is processed or posted, and does not adopt or endorse it. ${brand} is not liable for any content that users upload, link, post or comment, including content that infringes someone else's copyright, trademark or other rights; all liability for such content lies with the user who provided it. You agree to hold ${brand} harmless from any claim, loss or cost that results from your content or from your breaking these terms.</p>
<p>${brand} is provided as it is, without any guarantee. Translations, subtitles and dubbing are made automatically and can contain mistakes: do not rely on them where accuracy matters (legal, medical, financial). As far as the law allows, ${brand} is not liable for indirect or consequential loss, or for loss of data, and may change, limit or stop any feature at any time.</p>

<h2>3. What is not allowed</h2>
<p>No content that sexualises minors; no sexual content without consent; no harassment, threats or hate against people for who they are; no incitement to violence; no spam, scams or impersonation (pretending to be a person, a brand or ${brand} staff); no content that offends public order or public morals under Saudi law; nothing illegal where you live or where ${brand} operates. Do not try to break, overload or get around the limits of the service.</p>

<h2>4. Reporting and moderation</h2>
<p>Every posted video, comment and profile has a <b>Report</b> button. ${brand} reviews reports and may take down content and block accounts that break these terms. When something of yours is taken down, you are told. ${brand} never deletes your videos: a video taken down is hidden from everyone else, and stays yours to see and delete.</p>

<h2>5. Copyright and takedown requests</h2>
<p>If a video or comment on ${brand} uses your work without permission, write to ${contact} with: the link to the content, the work you own, your contact details, and a statement that you believe in good faith that the use is not authorised and that your request is accurate. ${brand} takes the content down once the request is confirmed (its owner is told), and blocks accounts that repeatedly post others' work.</p>

<h2>6. Credits and payments</h2>
<p>Credits are used for the minutes of video you translate, as shown before each job. Credits for a job that fails or is cancelled are returned. Bought credits are not refundable once used.</p>

<h2>7. Your data</h2>
<p>How ${brand} handles your personal data, and how to see, download or delete it, is explained in the <a href="/privacy">Privacy Policy</a>.</p>

<h2>8. Changes and governing law</h2>
<p>When these terms change in a way that matters, the version above changes and you are asked to agree again before your next video. These terms are governed by the laws of the Kingdom of Saudi Arabia.</p>

<p style="margin-top:32px"><a href="/privacy">Privacy Policy</a> · <a href="/">Back to ${brand}</a></p>
`;

/** The same terms in Arabic. */
const arabic = (brand: string, contact: string) => `<h1>شروط الاستخدام</h1>
<p class="meta">الإصدار ${LEGAL_VERSION}</p>
<p>${brand} أداة تترجم الفيديوهات وتضيف إليها الترجمة النصية والدبلجة، وتتيح للناس نشر النتائج في ملفاتهم الشخصية. باستخدامه، وخاصةً عند الترجمة أو النشر أو التعليق، فأنت توافق على هذه الشروط وعلى <a href="/privacy">سياسة الخصوصية</a>. إن لم توافق فلا تستخدم ${brand}.</p>

<h2>1. محتواك مسؤوليتك</h2>
<p>أنت وحدك المسؤول عن كل ملف ترفعه، وكل رابط ترسله، وكل ما تنشره أو تعلّق به، وعن امتلاكك حق استخدامه. لا تترجم أو تنشر أو تشارك إلا الفيديوهات التي تملكها، أو التي يسمح أصحابها بذلك (أو يسمح بها النظام). ترجمة فيديو لا تجعله ملكًا لك، ولا تمنحك أي حق في الأصل.</p>
<p>برفعك أو نشرك تؤكد أنك تملك الحقوق اللازمة وأن المحتوى لا يخالف أي نظام، بما في ذلك أنظمة الملكية الفكرية والخصوصية ومكافحة الجرائم المعلوماتية في المملكة العربية السعودية. تبقى مالكًا لما ترفعه؛ وتمنح ${brand} فقط الإذن اللازم لمعالجته وحفظه وعرضه كما تختار (مثلًا في ملفك عند نشره).</p>

<h2>2. حدود المسؤولية</h2>
<p>لا يراجع ${brand} المحتوى قبل معالجته أو نشره، ولا يتبنّاه ولا يؤيده. ${brand} غير مسؤول عن أي محتوى يرفعه المستخدمون أو يرسلون رابطه أو ينشرونه أو يعلّقون به، بما في ذلك المحتوى الذي يخالف حقوق النشر أو العلامات التجارية أو غيرها من حقوق الآخرين؛ وتقع المسؤولية كاملة عن هذا المحتوى على المستخدم الذي قدّمه. وتوافق على إعفاء ${brand} من أي مطالبة أو خسارة أو تكلفة تنتج عن محتواك أو عن مخالفتك لهذه الشروط.</p>
<p>يُقدَّم ${brand} كما هو، دون أي ضمان. الترجمة والترجمة النصية والدبلجة تُصنع آليًا وقد تحتوي أخطاء: لا تعتمد عليها حيث تهم الدقة (القانونية أو الطبية أو المالية). وفي الحدود التي يسمح بها النظام، لا يتحمل ${brand} مسؤولية الخسائر غير المباشرة أو التبعية أو فقدان البيانات، وقد يغيّر الميزات أو يحدّها أو يوقفها في أي وقت.</p>

<h2>3. ما هو غير مسموح</h2>
<p>لا محتوى يستغل القاصرين جنسيًا؛ ولا محتوى جنسي دون موافقة؛ ولا تحرّش أو تهديد أو كراهية ضد أشخاص بسبب هويتهم؛ ولا تحريض على العنف؛ ولا إزعاج أو احتيال أو انتحال شخصية (التظاهر بأنك شخص أو علامة تجارية أو من فريق ${brand})؛ ولا محتوى يمس النظام العام أو الآداب العامة وفق أنظمة المملكة؛ ولا أي شيء مخالف للنظام حيث تعيش أو حيث يعمل ${brand}. ولا تحاول تعطيل الخدمة أو إثقالها أو التحايل على حدودها.</p>

<h2>4. البلاغات والإشراف</h2>
<p>لكل فيديو منشور وتعليق وملف شخصي زر <b>إبلاغ</b>. يراجع ${brand} البلاغات، وقد يُزيل المحتوى من العرض ويحظر الحسابات المخالفة لهذه الشروط. وحين يُزال شيء يخصك نُعلمك بذلك. لا يحذف ${brand} فيديوهاتك أبدًا: الفيديو المُزال يُخفى عن الجميع، ويبقى لك تراه وتحذفه.</p>

<h2>5. حقوق النشر وطلبات الإزالة</h2>
<p>إن كان فيديو أو تعليق على ${brand} يستخدم عملك دون إذن، فراسل ${contact} مع: رابط المحتوى، والعمل الذي تملكه، وبيانات التواصل معك، وإقرار بأنك تعتقد بحسن نية أن الاستخدام غير مصرّح به وأن طلبك دقيق. يُزيل ${brand} المحتوى من العرض بعد تأكيد الطلب (ويُبلَّغ صاحبه)، ويحظر الحسابات التي تنشر أعمال الآخرين مرارًا.</p>

<h2>6. الرصيد والمدفوعات</h2>
<p>يُستخدم الرصيد لدقائق الفيديو التي تترجمها، كما يظهر قبل كل مهمة. يُعاد رصيد المهمة التي تفشل أو تُلغى. الرصيد المشترى غير قابل للاسترداد بعد استخدامه.</p>

<h2>7. بياناتك</h2>
<p>كيف يتعامل ${brand} مع بياناتك الشخصية، وكيف تطّلع عليها أو تنزّلها أو تحذفها، موضّح في <a href="/privacy">سياسة الخصوصية</a>.</p>

<h2>8. التغييرات والنظام الحاكم</h2>
<p>عندما تتغير هذه الشروط تغييرًا مهمًا، يتغير الإصدار أعلاه ونطلب موافقتك من جديد قبل فيديوك التالي. تخضع هذه الشروط لأنظمة المملكة العربية السعودية.</p>

<p style="margin-top:32px"><a href="/privacy">سياسة الخصوصية</a> · <a href="/">العودة إلى ${brand}</a></p>
`;
