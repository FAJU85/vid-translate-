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
  Cloudflare or Hugging Face token that may be exposed. Keys saved on `/admin` → **Features**
  (email, Google, Stripe, two-step sign-in) are encrypted with `SHARED_SECRET`: after rotating it
  they cannot be read and stop working. Paste each affected key again on the Features page (it
  lists them), and check that sign-in by email and Google, card payments and two-step sign-in
  work again. If two-step sign-in was set there, `/admin` refuses sign-in until it is reset (set
  `ADMIN_TOTP_SECRET` on the server, or delete the saved one, as the sign-in error explains).
- **Content:** remove exposed files from R2; take a page offline if needed.
- Keep evidence before it ages out (the audit log keeps a year): save the whole audit log and
  the sign-in counters from D1 to a file, and keep it with the incident record:
  `npx wrangler d1 execute DB --remote --json --command "SELECT * FROM audit_log ORDER BY id" > audit-log.json`
  and the same for `admin_login_tries`. Download the Worker's logs from the Cloudflare dashboard.

## 3. Assess (within 24 hours)

- What data: account (name, email), videos and transcripts, comments, payment records (no card
  numbers are held), connection fingerprints.
- How many people, which countries, since when, and whether it is still happening.
- Likely harm to people (identity, reputation, financial), and whether the data was encrypted.

## 4. Notify (within 72 hours)

- **SDAIA:** notify through the channel SDAIA designates, within 72 hours of learning of the
  breach, when it could harm the personal data, harm the people it is about, or conflict with
  their rights or interests (Article 24 of the PDPL's Implementing Regulation). Deciding **not** to notify needs all three
  ruled out, the reasons written in the incident record, and a review of that decision with legal
  counsel. Include: what happened and when, **when we learned of it**, the data and number of
  people affected, likely consequences, what was done and will be done, **whether the people
  affected were notified (or when they will be)**, and a contact person. If not everything is
  known yet, notify with what is known and send the rest later.
- **Affected people:** when the breach could harm their data, harm them, or conflict with their
  rights or interests, tell them without undue delay, in Arabic and English, in plain words:
  what happened, what data, what we did, what they can do (for example, watch for phishing
  emails), and how to reach us. Use the email on their account, the Telegram bot, and a notice
  on the site.
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
2. **الاحتواء:** غيّر كلمة مرور المشرف ورمز التحقق بخطوتين، وأنهِ جلسات المستخدمين، وبدّل الأسرار والمفاتيح المعرّضة، واحذف الملفات المكشوفة، واحفظ سجل التدقيق كاملًا من قاعدة البيانات (الأمر أعلاه) وسجلات Cloudflare كدليل.
3. **التقييم (خلال 24 ساعة):** ما البيانات المتأثرة، وكم شخصًا، ومنذ متى، وما الضرر المحتمل.
4. **الإبلاغ (خلال 72 ساعة):** أبلغ الهيئة السعودية للبيانات والذكاء الاصطناعي (سدايا) عبر القناة التي تحددها إن كان التسرّب قد يُلحق ضررًا بالبيانات الشخصية أو بأصحابها أو يتعارض مع حقوقهم أو مصالحهم (المادة 24 من اللائحة التنفيذية للنظام). وقرار عدم الإبلاغ يتطلب استبعاد الحالات الثلاث، وتوثيق الأسباب، ومراجعته مع المستشار القانوني. وأبلغ المتأثرين دون تأخير غير مبرر في الحالات نفسها، بلغة واضحة بالعربية والإنجليزية.
5. **التعافي والتعلّم:** عالج السبب، وراقب سجل التدقيق، واكتب مراجعة قصيرة وحدّث هذه الخطة.
