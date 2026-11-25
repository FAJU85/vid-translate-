# Personal data breach response plan

What KAVOX does when personal data may have been exposed, lost or changed without permission.
It follows the Saudi Personal Data Protection Law (PDPL) and its implementing regulation, which
require notifying the Saudi Data and AI Authority (SDAIA) **within 72 hours** of becoming aware
of a breach, and notifying affected people without undue delay when it may harm them.
This plan is a practical starting point, not legal advice: confirm the details with counsel.

## 0. Before anything happens

- Keep this file and the contacts below up to date. The **owner** of the platform is the
  incident lead unless they name someone else.
- Turn on two-step sign-in for `/admin` (`ADMIN_TOTP_SECRET`, see the README).
- The **Audit** workspace on `/admin` keeps a year of admin sign-ins (failed ones too), admin
  changes, account openings, data downloads and deletions. Cloudflare keeps the Worker's logs.

| Role | Who | How to reach |
|---|---|---|
| Incident lead (owner) | _name_ | _phone / email_ |
| Technical | _name_ | _phone / email_ |
| Legal / privacy | _name_ | _phone / email_ |
| SDAIA | National Data Governance Platform | as published by SDAIA |

## 1. Detect and record (hour 0)

Signs: failed admin sign-ins in a burst, admin actions nobody made, an unknown session, a secret
or token posted somewhere, a provider's breach notice (Cloudflare, Hugging Face, Resend, Google,
Telegram, Stripe), a report from a user or researcher.

Open an incident record (a private document) at once: **when you learned of it**, who reported
it, what is known. The 72 hours start from this moment.

## 2. Contain (first hours)

Do what applies, and write down each step and its time:

- **Admin access:** change `ADMIN_PASSWORD` and `ADMIN_TOTP_SECRET` (`npx wrangler secret put …`);
  every admin sign-in ends at once.
- **User sessions:** sign everyone out with `DELETE FROM sessions` on the D1 database.
- **Secrets:** rotate `SHARED_SECRET` (Worker and Space together), `TELEGRAM_BOT_TOKEN`,
  `TELEGRAM_WEBHOOK_SECRET`, `RESEND_API_KEY`, `GOOGLE_CLIENT_SECRET`, `STRIPE_*`, and any
  Cloudflare or Hugging Face token that may be exposed.
- **Content:** remove exposed files from R2; take a page offline if needed.
- Keep evidence: export the audit log (Audit workspace) and Cloudflare logs before they age out.

## 3. Assess (within 24 hours)

- What data: account (name, email), videos and transcripts, comments, payment records (no card
  numbers are held), connection fingerprints.
- How many people, which countries, since when, and whether it is still happening.
- Likely harm to people (identity, reputation, financial), and whether the data was encrypted.

## 4. Notify (within 72 hours)

- **SDAIA:** notify through the channel SDAIA designates, within 72 hours of learning of the
  breach, unless it is unlikely to harm anyone (write down why if you decide not to notify).
  Include: what happened and when, the data and number of people affected, likely consequences,
  what was done and will be done, and a contact person. If not everything is known yet, notify
  with what is known and send the rest later.
- **Affected people:** when the breach may harm them, tell them without undue delay, in Arabic
  and English, in plain words: what happened, what data, what we did, what they can do (for
  example, watch for phishing emails), and how to reach us. Use the email on their account,
  the Telegram bot, and a notice on the site.
- **Providers:** tell the affected provider if the breach came through them.

## 5. Recover and learn (within 2 weeks)

- Fix the cause, confirm it is fixed, and watch the audit log closely for a while.
- Write a short review: timeline, cause, what worked, what to change. Update this plan.

## Record of incidents

| Date learned | Summary | People affected | SDAIA notified (date) | People notified (date) | Closed |
|---|---|---|---|---|---|
| | | | | | |

---

## ملخص بالعربية: خطة الاستجابة لتسرّب البيانات الشخصية

1. **الرصد والتسجيل:** عند الاشتباه بتسرّب، سجّل فورًا وقت العلم به ومصدره؛ تبدأ مهلة الـ72 ساعة من هذه اللحظة.
2. **الاحتواء:** غيّر كلمة مرور المشرف ورمز التحقق بخطوتين، وأنهِ جلسات المستخدمين، وبدّل الأسرار والمفاتيح المعرّضة، واحذف الملفات المكشوفة، واحفظ سجل التدقيق والسجلات كدليل.
3. **التقييم (خلال 24 ساعة):** ما البيانات المتأثرة، وكم شخصًا، ومنذ متى، وما الضرر المحتمل.
4. **الإبلاغ (خلال 72 ساعة):** أبلغ الهيئة السعودية للبيانات والذكاء الاصطناعي (سدايا) عبر القناة التي تحددها، وأبلغ المتأثرين دون تأخير غير مبرر إن كان التسرّب قد يضرّهم، بلغة واضحة بالعربية والإنجليزية.
5. **التعافي والتعلّم:** عالج السبب، وراقب سجل التدقيق، واكتب مراجعة قصيرة وحدّث هذه الخطة.
