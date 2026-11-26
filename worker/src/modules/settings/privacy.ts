import type { Env } from '../../shared/env';
import { FONT, brandHeader, chromeCss, headLinks } from '../../shared/page-chrome';
import { htmlAttrs, pageLang } from '../../shared/page-i18n';
import { logoSize, readSettings } from './store';

/**
 * The version of the Terms and the Privacy Policy people agree to. Change it (to the date) when
 * either changes in substance: everyone is then asked to agree again before their next video.
 */
export const LEGAL_VERSION = '2026-11-26.2';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** The services KAVOX hands data to, what they get, and where they are. */
const PROCESSORS = {
  en: [
    ['Cloudflare', 'Hosts the website, the database and the stored videos (encrypted at rest).', 'Global network; data can be stored and served outside Saudi Arabia.'],
    ['Hugging Face', 'Runs the translation server: receives the video or its link, makes the transcript, translation, subtitles and dubbed voice. Files there are deleted within a day.', 'United States / European Union.'],
    ['Microsoft (Edge text-to-speech)', 'Turns the translated text into a voice, for dubbed videos only. Receives the translated text, not the video.', 'Microsoft data centres, outside Saudi Arabia.'],
    ['Resend', 'Sends the sign-in email: receives your email address.', 'United States.'],
    ['Google', 'Only if you sign in with Google: confirms your Google account and gives us your name and email.', 'United States and other countries.'],
    ['Telegram', 'Only if you use the bot or sign in with Telegram: carries the messages and videos you exchange with the bot.', 'Outside Saudi Arabia.'],
    ['Stripe', 'Only if you pay by card: handles the payment. KAVOX never sees your card number.', 'United States.'],
  ],
  ar: [
    ['Cloudflare', 'تستضيف الموقع وقاعدة البيانات والفيديوهات المحفوظة (مشفّرة أثناء التخزين).', 'شبكة عالمية؛ قد تُخزَّن البيانات وتُقدَّم من خارج المملكة العربية السعودية.'],
    ['Hugging Face', 'تشغّل خادم الترجمة: تستقبل الفيديو أو رابطه، وتُنتج النص والترجمة والترجمة النصية والصوت المدبلج. تُحذف الملفات هناك خلال يوم.', 'الولايات المتحدة / الاتحاد الأوروبي.'],
    ['Microsoft (تحويل النص إلى كلام في Edge)', 'تحوّل النص المترجم إلى صوت، للفيديوهات المدبلجة فقط. تستقبل النص المترجم لا الفيديو.', 'مراكز بيانات Microsoft خارج المملكة.'],
    ['Resend', 'ترسل بريد تسجيل الدخول: تستقبل بريدك الإلكتروني.', 'الولايات المتحدة.'],
    ['Google', 'فقط إن سجّلت الدخول بحساب Google: تؤكد حسابك وتعطينا اسمك وبريدك.', 'الولايات المتحدة ودول أخرى.'],
    ['Telegram', 'فقط إن استخدمت البوت أو سجّلت الدخول بتيليجرام: تنقل الرسائل والفيديوهات بينك وبين البوت.', 'خارج المملكة.'],
    ['Stripe', 'فقط إن دفعت بالبطاقة: تعالج الدفع. لا يرى KAVOX رقم بطاقتك أبدًا.', 'الولايات المتحدة.'],
  ],
} as const;

const table = (rows: readonly (readonly string[])[], head: readonly string[]) =>
  `<div class="tbl"><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`)
    .join('')}</tbody></table></div>`;

function english(brand: string, contact: string, twoStep: boolean): string {
  return `<h1>Privacy Policy</h1>
<p class="meta">Version ${LEGAL_VERSION}</p>
<p>This policy explains what personal data ${brand} collects, why, how long it is kept, who it is shared with, and how you use your rights under the Saudi Personal Data Protection Law (PDPL). ${brand} is the controller of this data. Contact: ${contact}.</p>

<h2>1. What we collect, and why</h2>
${table(
  [
    ['Account', 'Your name and email address (from the sign-in you choose: email, Google or Telegram), and when you agreed to these terms.', 'To sign you in and keep your videos and credits in one place.'],
    ['Videos and links', 'The video file you upload or the link you send, and what is made from it: transcript, translation, subtitles, dubbed voice.', 'To do the translation you asked for.'],
    ['What you post', 'Your @handle, name, bio, posted videos, comments, likes and follows.', 'To show them on your profile and in the feed, as you chose.'],
    ['Credits and payments', 'Your balance, how it was used, and what you bought (no card numbers).', 'To give you what you paid for.'],
    ['Feedback and reports', 'What you write to us, and what you report.', 'To improve the service and act on reports.'],
    ['Technical', 'A keyed fingerprint of your connection (never the address itself), your browser language, and the country of a sign-in request (kept one day).', 'To prevent abuse, count views by language, and protect sign-in.'],
    ['Invites', 'Your invite code, and who invited whom (we never read your contacts).', 'To count the friends you bring and, when on, give both of you the free minutes.'],
    ['Visit counts', 'Daily totals only, never per person: how many visits came from each place (a search engine, WhatsApp, a shared video…), how many shares went to each app, how many installs. No cookie, no address, nothing that points to you.', 'To know which ways of sharing ${brand} work.'],
  ],
  ['Data', 'What exactly', 'Why'],
)}
<p>We do not ask for your national ID number, date of birth or location, and we do not use your data for advertising. You can use ${brand} without an account; then your videos are linked only to this browser.</p>

<h2>2. Legal basis</h2>
<p>We process your data with your consent (which you give by ticking the box before your first video or sign-in) and to provide the service you request. You can withdraw consent at any time by deleting your account; this does not affect what was done before.</p>

<h2>3. How long we keep it</h2>
${table(
  [
    ['Files on the translation server', 'Up to 1 day'],
    ['A translated video and its page', 'Until you delete it, or your account. ${brand} never deletes it by itself (a video taken down after a report is hidden, not deleted, and you are told).'],
    ['Job details (title, languages, status)', '30 days'],
    ['Sign-in codes and the sign-in country', '1 day'],
    ['Notifications', '90 days'],
    ['Feedback', 'Until it is handled, at most 1 year'],
    ['Reports you send', 'At most 1 year'],
    ['Security log (admin actions, data downloads and deletions)', '1 year'],
    ['Daily visit counts (no personal data)', '400 days'],
    ['Account, profile, posts, comments, credits, invites', 'Until you delete your account'],
    ['Payment records', 'As long as the law requires for accounting'],
  ],
  ['Data', 'Kept for'],
)}

<h2>4. Who we share it with, and where</h2>
<p>We do not sell your data. We share it only with the services that run ${brand} for us, for the purposes above:</p>
${table(PROCESSORS.en, ['Service', 'What it does with your data', 'Where'])}
<p><b>Transfer outside Saudi Arabia.</b> These services are outside the Kingdom, so using ${brand} means your data is transferred abroad for the purposes above. We use them only for what is needed to provide the service, rely on their security and data-protection commitments, and keep transfers to the minimum. People and videos you choose to make public (posted videos, profiles, comments) can be seen by anyone, anywhere.</p>

<h2>5. Your rights</h2>
<p>Under the PDPL you have the right to: be told how your data is used (this policy); see your data and get a copy of it; have it corrected; have it deleted; and withdraw your consent. In ${brand}:</p>
<ul>
  <li><b>See and download:</b> Dashboard → Your data → Download my data (a file with everything linked to your account).</li>
  <li><b>Correct:</b> edit your name, @handle and bio on the Dashboard.</li>
  <li><b>Delete:</b> Dashboard → Your data → Delete my account. This permanently deletes your account, profile, videos and their files, comments, likes, follows and credits. It cannot be undone.</li>
  <li>Or write to ${contact}. We answer within 30 days.</li>
</ul>
<p>If you think we have not respected your rights, you can complain to the Saudi Data and AI Authority (SDAIA).</p>

<h2>6. Security</h2>
<p>All connections use HTTPS. The database and stored files are encrypted at rest by our hosting provider. Videos are not in a public storage bucket: they are served only through ${brand}, and private files use links that expire. There are no passwords to leak: you sign in with a one-time email link, Google or Telegram. Administrator access needs a password${twoStep ? ' and a one-time code from an authenticator app' : ''}, and sensitive actions (administrator sign-ins and changes, data downloads and deletions) are logged.</p>
<p>If a breach puts your data at risk, we will tell SDAIA within 72 hours of finding out, as the law requires, and tell you without undue delay when it may harm you.</p>

<h2>7. Children</h2>
<p>${brand} is not meant for children under 13. Anyone under 18 should use it only with a parent's or guardian's permission.</p>

<h2>8. Changes</h2>
<p>When this policy changes in a way that matters, the version above changes and you are asked to agree again before your next video.</p>
<p style="margin-top:32px"><a href="/terms">Terms of use</a> · <a href="/">Back to ${brand}</a></p>`;
}

function arabic(brand: string, contact: string, twoStep: boolean): string {
  return `<h1>سياسة الخصوصية</h1>
<p class="meta">الإصدار ${LEGAL_VERSION}</p>
<p>توضّح هذه السياسة البيانات الشخصية التي يجمعها ${brand}، ولماذا، ومدة الاحتفاظ بها، ومع من تُشارك، وكيف تمارس حقوقك وفق نظام حماية البيانات الشخصية في المملكة العربية السعودية. ${brand} هو جهة التحكم في هذه البيانات. للتواصل: ${contact}.</p>

<h2>1. ما نجمعه ولماذا</h2>
${table(
  [
    ['الحساب', 'اسمك وبريدك الإلكتروني (من طريقة الدخول التي تختارها: البريد أو Google أو تيليجرام)، ووقت موافقتك على هذه الشروط.', 'لتسجيل دخولك وحفظ فيديوهاتك ورصيدك في مكان واحد.'],
    ['الفيديوهات والروابط', 'ملف الفيديو الذي ترفعه أو الرابط الذي ترسله، وما يُنتج منه: النص والترجمة والترجمة النصية والصوت المدبلج.', 'لتنفيذ الترجمة التي طلبتها.'],
    ['ما تنشره', 'معرّفك @ واسمك ونبذتك والفيديوهات المنشورة والتعليقات والإعجابات والمتابعات.', 'لعرضها في ملفك وفي الخلاصة كما اخترت.'],
    ['الرصيد والمدفوعات', 'رصيدك وكيف استُخدم وما اشتريته (دون أرقام البطاقات).', 'لتسليمك ما دفعت مقابله.'],
    ['الملاحظات والبلاغات', 'ما تكتبه لنا وما تبلّغ عنه.', 'لتحسين الخدمة والتعامل مع البلاغات.'],
    ['بيانات تقنية', 'بصمة مشفّرة لاتصالك (لا العنوان نفسه أبدًا)، ولغة متصفحك، وبلد طلب تسجيل الدخول (يُحفظ يومًا واحدًا).', 'لمنع إساءة الاستخدام، وعدّ المشاهدات حسب اللغة، وحماية تسجيل الدخول.'],
    ['الدعوات', 'رمز دعوتك، ومن دعا مَن (لا نطّلع على جهات اتصالك أبدًا).', 'لعدّ الأصدقاء الذين تدعوهم، ومنحكما الدقائق المجانية عند تفعيلها.'],
    ['عدد الزيارات', 'مجاميع يومية فقط، لا لكل شخص: كم زيارة جاءت من كل مكان (محرك بحث، واتساب، فيديو مُشارك…)، وكم مشاركة ذهبت إلى كل تطبيق، وكم مرة ثُبّت التطبيق. بلا ملفات تعريف ارتباط ولا عنوان ولا أي شيء يدل عليك.', 'لمعرفة طرق مشاركة ${brand} التي تنجح.'],
  ],
  ['البيانات', 'ما هي بالتحديد', 'لماذا'],
)}
<p>لا نطلب رقم هويتك الوطنية ولا تاريخ ميلادك ولا موقعك، ولا نستخدم بياناتك للإعلانات. يمكنك استخدام ${brand} دون حساب؛ وعندها ترتبط فيديوهاتك بهذا المتصفح فقط.</p>

<h2>2. الأساس النظامي</h2>
<p>نعالج بياناتك بموافقتك (التي تعطيها بتحديد المربع قبل أول فيديو أو قبل تسجيل الدخول) ولتقديم الخدمة التي تطلبها. يمكنك سحب موافقتك في أي وقت بحذف حسابك؛ ولا يؤثر ذلك على ما تم قبله.</p>

<h2>3. مدة الاحتفاظ</h2>
${table(
  [
    ['الملفات على خادم الترجمة', 'حتى يوم واحد'],
    ['الفيديو المترجم وصفحته', 'حتى تحذفه أو تحذف حسابك. لا يحذفه ${brand} من تلقاء نفسه (الفيديو المُزال بعد بلاغ يُخفى ولا يُحذف، ونُعلمك بذلك).'],
    ['تفاصيل المهام (العنوان واللغات والحالة)', '30 يومًا'],
    ['رموز تسجيل الدخول وبلد الطلب', 'يوم واحد'],
    ['الإشعارات', '90 يومًا'],
    ['الملاحظات', 'حتى تُعالج، وسنة واحدة كحد أقصى'],
    ['البلاغات التي ترسلها', 'سنة واحدة كحد أقصى'],
    ['سجل الأمان (إجراءات المشرف وتنزيل البيانات وحذفها)', 'سنة واحدة'],
    ['عدد الزيارات اليومي (بلا بيانات شخصية)', '400 يوم'],
    ['الحساب والملف والمنشورات والتعليقات والرصيد والدعوات', 'حتى تحذف حسابك'],
    ['سجلات الدفع', 'المدة التي يشترطها النظام للمحاسبة'],
  ],
  ['البيانات', 'مدة الاحتفاظ'],
)}

<h2>4. مع من نشاركها وأين</h2>
<p>لا نبيع بياناتك. نشاركها فقط مع الخدمات التي تشغّل ${brand} نيابةً عنا، وللأغراض المذكورة أعلاه:</p>
${table(PROCESSORS.ar, ['الخدمة', 'ما تفعله ببياناتك', 'الموقع'])}
<p><b>النقل خارج المملكة.</b> تقع هذه الخدمات خارج المملكة، لذا فإن استخدام ${brand} يعني نقل بياناتك إلى الخارج للأغراض المذكورة. نستخدمها فقط لما يلزم لتقديم الخدمة، ونعتمد على التزاماتها في الأمان وحماية البيانات، ونقصر النقل على الحد الأدنى. ما تختار جعله عامًا (الفيديوهات المنشورة والملفات الشخصية والتعليقات) يمكن لأي أحد في أي مكان رؤيته.</p>

<h2>5. حقوقك</h2>
<p>وفق النظام يحق لك: أن تُبلَّغ بكيفية استخدام بياناتك (هذه السياسة)؛ والاطلاع على بياناتك والحصول على نسخة منها؛ وتصحيحها؛ وحذفها؛ وسحب موافقتك. في ${brand}:</p>
<ul>
  <li><b>الاطلاع والتنزيل:</b> لوحتي ← بياناتك ← تنزيل بياناتي (ملف يضم كل ما يرتبط بحسابك).</li>
  <li><b>التصحيح:</b> عدّل اسمك ومعرّفك @ ونبذتك من لوحتي.</li>
  <li><b>الحذف:</b> لوحتي ← بياناتك ← حذف حسابي. يحذف ذلك نهائيًا حسابك وملفك وفيديوهاتك وملفاتها وتعليقاتك وإعجاباتك ومتابعاتك ورصيدك، ولا يمكن التراجع عنه.</li>
  <li>أو راسلنا على ${contact}. نرد خلال 30 يومًا.</li>
</ul>
<p>إن رأيت أننا لم نحترم حقوقك، يمكنك تقديم شكوى إلى الهيئة السعودية للبيانات والذكاء الاصطناعي (سدايا).</p>

<h2>6. الأمان</h2>
<p>جميع الاتصالات عبر HTTPS. قاعدة البيانات والملفات المحفوظة مشفّرة أثناء التخزين لدى مزوّد الاستضافة. الفيديوهات ليست في مخزن عام: تُقدَّم فقط عبر ${brand}، والملفات الخاصة تستخدم روابط تنتهي صلاحيتها. لا توجد كلمات مرور قد تتسرب: تسجّل الدخول برابط بريد لمرة واحدة أو بحساب Google أو تيليجرام. يتطلب وصول المشرف كلمة مرور${twoStep ? ' ورمزًا لمرة واحدة من تطبيق مصادقة' : ''}، وتُسجَّل الإجراءات الحساسة (دخول المشرف وتغييراته وتنزيل البيانات وحذفها).</p>
<p>إن عرّض اختراقٌ بياناتك للخطر، نُبلغ سدايا خلال 72 ساعة من اكتشافه كما يشترط النظام، ونُبلغك دون تأخير غير مبرر إن كان قد يضرك.</p>

<h2>7. الأطفال</h2>
<p>${brand} ليس موجّهًا للأطفال دون 13 عامًا. ومن هم دون 18 عامًا يستخدمونه بإذن الوالدين أو الولي فقط.</p>

<h2>8. التغييرات</h2>
<p>عندما تتغير هذه السياسة تغييرًا مهمًا، يتغير الإصدار أعلاه ونطلب موافقتك من جديد قبل فيديوك التالي.</p>
<p style="margin-top:32px"><a href="/terms">شروط الاستخدام</a> · <a href="/">العودة إلى ${brand}</a></p>`;
}

/** GET /privacy: the Privacy Policy, in Arabic or English (the visitor's choice, like the other pages). */
export async function handlePrivacyPage(request: Request, env: Env, path: string): Promise<Response | null> {
  if (path !== '/privacy' || (request.method !== 'GET' && request.method !== 'HEAD')) return null;
  const lang = pageLang(request);
  const settings = (await readSettings(env).catch(() => null))?.settings;
  const brand = esc(settings?.name || 'KAVOX');
  const accent = /^#[0-9a-f]{6}$/i.test(settings?.accent ?? '') ? settings!.accent : '#2AB8A1';
  const logo = settings?.logo ? '/api/logo' : undefined;
  const email = settings?.takedown_email || '';
  const contact = email
    ? `<a href="mailto:${esc(email)}">${esc(email)}</a>`
    : lang === 'ar'
      ? 'بريد التواصل الذي تنشره المنصة هنا (لم يُحدَّد بعد)'
      : 'the contact address the platform publishes here (not set yet)';
  const html = `<!doctype html>
<html ${htmlAttrs(lang)}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${lang === 'ar' ? 'سياسة الخصوصية' : 'Privacy Policy'} · ${brand}</title>
${headLinks(logo)}
<style>
  :root { color-scheme: dark; --accent: ${accent}; }
  body { margin: 0; background: #131C31; color: #CBC2B5; font: 15px/1.65 ${FONT}; }
  main { max-width: 820px; margin: 0 auto; padding: 24px 16px 48px; }
  h1 { color: #F9EBD6; font-size: 26px; margin-bottom: 4px; } h2 { color: #F9EBD6; font-size: 18px; margin-top: 28px; }
  .meta { color: #8F8B88; font-size: 13px; margin-top: 0; }
  a { color: var(--accent); }
  .tbl { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; margin: 8px 0; }
  th, td { text-align: start; vertical-align: top; padding: 8px 10px; border-bottom: 1px solid #223052; }
  th { color: #F9EBD6; font-weight: 700; background: #19243E; }
${chromeCss}
</style>
</head>
<body>
<main>
${brandHeader(brand, logo, logoSize(settings))}
${lang === 'ar' ? arabic(brand, contact, Boolean(env.ADMIN_TOTP_SECRET)) : english(brand, contact, Boolean(env.ADMIN_TOTP_SECRET))}
</main>
</body>
</html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
