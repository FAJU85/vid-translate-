# TarjimVideo

Translate the speech of a video into subtitles — Arabic by default, 15 target languages —
from a Telegram bot or a small website. You get an `.srt` / `.vtt` file, or the video with
the subtitles burned into the picture.

```
Telegram ──webhook──►┌──────────────────────┐  POST /invoke   ┌───────────────────────────┐
                     │  Cloudflare Worker   │────────────────►│  Hugging Face Space       │
Website ────────────►│  worker/             │◄────────────────│  backend/  (Docker)       │
        /api/*       │  bot · job store (D1)│  signed progress│  yt-dlp → Whisper → NMT   │
                     └──────────────────────┘    callbacks    │  → SRT/VTT → ffmpeg burn  │
                                                              └───────────────────────────┘
```

| Folder | Runs on | What it does |
| --- | --- | --- |
| `backend/` | Hugging Face Space (Docker) | Downloads, transcribes, translates, renders. No Telegram access needed. |
| `worker/` | Cloudflare Workers + D1 | Telegram webhook, job records, rate limits, delivery of files to the chat, API for the website. |
| `web/` | Cloudflare Worker (static assets) | Website: submit a link or upload a file, watch progress, preview and edit subtitles, download. |

Each part is built from self-contained **bricks** with a small public interface; see
[ARCHITECTURE.md](ARCHITECTURE.md) for the layout and the rules (checked in CI).

All Telegram traffic goes through the Worker. The Space only ever talks to the Worker, so it
works even where Spaces cannot reach `api.telegram.org`.

## Deploy

### Secrets: keep them all in GitHub

Every secret can live in one place, the GitHub repository's **Settings → Secrets and variables →
Actions**, and be pushed to Cloudflare and Hugging Face by the **Sync secrets to Cloudflare and
Hugging Face** workflow (Actions tab → Run workflow). Run it again after changing a secret.

| GitHub secret | Goes to | Notes |
| --- | --- | --- |
| `SHARED_SECRET` | Worker and Space | Any long random string you make up (`openssl rand -hex 32`). |
| `TELEGRAM_BOT_TOKEN` | Worker | From @BotFather. |
| `TELEGRAM_WEBHOOK_SECRET` | Worker | Another random string (letters, digits, `_`, `-`). |
| `ADMIN_PASSWORD` | Worker | Password of the `/admin` settings page (at least 8 characters). Unset: the page stays locked. |
| `RESEND_API_KEY` | Worker | Optional: email sign-in links, sent with [Resend](https://resend.com) (free: 3,000 emails a month). |
| `EMAIL_FROM` | Worker | With `RESEND_API_KEY`: the sender, e.g. `Kavox <login@yourdomain.com>` (a domain verified in Resend). |
| `GOOGLE_CLIENT_ID` | Worker | Optional: "Continue with Google". An OAuth client (Google Cloud console → APIs & Services → Credentials → Web application) with the redirect URI `https://YOUR-WORKER/api/auth/google/callback`. |
| `GOOGLE_CLIENT_SECRET` | Worker | With `GOOGLE_CLIENT_ID`: that client's secret. |
| `STRIPE_SECRET_KEY` | Worker | Optional: card payments on the website. Stripe dashboard → Developers → API keys (`sk_live_…`, or `sk_test_…` to try). |
| `STRIPE_WEBHOOK_SECRET` | Worker | With `STRIPE_SECRET_KEY`: Developers → Webhooks → add the endpoint `https://YOUR-WORKER/api/stripe/webhook` with the events `checkout.session.completed`, `checkout.session.async_payment_succeeded` and `invoice.paid`, then copy its signing secret (`whsec_…`). |
| `YTDLP_COOKIES` | Space | Optional: for sites that need a login to download. |
| `YTDLP_PROXY` | Space | Optional: proxy for video downloads. |
| `CLOUDFLARE_API_TOKEN` | – | Cloudflare token from the "Edit Cloudflare Workers" template; lets the workflow set Worker secrets. |
| `CLOUDFLARE_ACCOUNT_ID` | – | Your Cloudflare account id (dashboard URL or Workers overview). |
| `HF_TOKEN` | – | Hugging Face token with write access to the Space; also used by the backend deploy. |

The workflow skips anything that is not set and also connects the Telegram bot to the Worker.
`SHARED_SECRET` is only synced when both platforms can be reached, so the Worker and the Space never
end up with different values.
Secrets set by hand in the Cloudflare or Hugging Face dashboards keep working too.


You need a Hugging Face account, a Cloudflare account, and a bot token from
[@BotFather](https://t.me/BotFather).

First pick one long random string. It is the `SHARED_SECRET` on **both** sides:

```bash
openssl rand -hex 32
```

### 1. Backend → Hugging Face Space

The Space is [`vooom/Kavox`](https://huggingface.co/spaces/vooom/Kavox). It is deployed by the
GitHub Action in `.github/workflows/deploy-space.yml`, which uploads `backend/` on every push to
`main` that touches it (or when run manually from the Actions tab). It signs in with the
`HF_TOKEN` repository secret when one is set (recommended); otherwise it uses the Space's
**Settings → Trusted Publishers** entry for this GitHub repository (workflow file `deploy-space.yml`).
The Space id is set in both `deploy-space.yml` and `sync-secrets.yml` (`SPACE_ID`).

To deploy to a different Space, change `SPACE_ID` in that workflow and add this repository as a
trusted publisher on the new Space.

In the Space's **Settings → Variables and secrets** add the secret `SHARED_SECRET`.
The first build takes several minutes (it bakes the speech and translation models into the image).
When it is running, `https://vooom-kavox.hf.space/health` returns
`"configured": true`. Keep the Space **public**: every route that matters is protected by the secret.

Optional settings (better translation with Gemini, bigger Whisper model, download cookies) are
listed in [`backend/README.md`](backend/README.md).

### 2. Worker → Cloudflare

The Worker is configured by `wrangler.toml` at the repository root (its code is in `worker/`).
With Cloudflare **Workers Builds** connected to this repository, leave the build root directory
empty and the deploy command as `npx wrangler deploy`: every push to `main` deploys the Worker.
The database id and the three secrets below are needed either way.

To deploy by hand instead, run these from the repository root:

```bash
npm install --prefix worker
```

```bash
npx wrangler login
```

```bash
npx wrangler d1 create tarjim-video
```

```bash
npx wrangler r2 bucket create kavox-media
```

Edit `wrangler.toml` (repository root): paste the printed `database_id`, and set `BACKEND_URL` to your Space URL
(`https://vooom-kavox.hf.space`, already filled in). Then add the three secrets and deploy:

```bash
npx wrangler secret put SHARED_SECRET
```

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
```

```bash
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
```

```bash
npx wrangler deploy
```

`TELEGRAM_WEBHOOK_SECRET` is any random string of letters, digits, `_` and `-`.
The database tables are created automatically on the first request.

Finally connect the bot to the Worker (registers the webhook and the command menu):

```bash
curl -X POST https://vid-translate.YOUR_SUBDOMAIN.workers.dev/admin/setup -H "Authorization: Bearer YOUR_SHARED_SECRET"
```

The reply should contain `"webhook_set": true` and a `backend` block with `"status": "ok"`.
Open the bot in Telegram and send `/start`.

### 3. Website

The Worker builds `web/` on every deploy and serves it at its own URL
(`https://vid-translate.YOUR_SUBDOMAIN.workers.dev/`), so there is nothing more to set up.

To host the website separately on Cloudflare Pages instead: **Workers & Pages → Create → Pages →
Connect to Git**, pick this repository and set:

| Setting | Value |
| --- | --- |
| Root directory | `web` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Environment variable | `VITE_API_BASE` = your Worker URL (no trailing slash) |

Once the site has its URL, set `ALLOWED_ORIGINS` in `wrangler.toml` (and `CORS_ORIGINS`
on the Space) to that URL and redeploy, so other websites cannot use your API from a browser.
This is a browser-only restriction: direct HTTP calls are still limited only by the rate limits.

## Accounts and credits

People can sign in on the website (the **Sign in** button in the header) to keep one account for
the website and the bot:

- **Telegram**: always available. The website opens the bot with a one-time code; the bot shows
  when and from which country the sign-in was asked and signs the website in only after **Yes,
  sign me in** (so a link someone else sends cannot sign them in as you). Nothing to set up.
- **Email link**: with `RESEND_API_KEY` and `EMAIL_FROM` set. A link valid for 15 minutes.
- **Google**: with `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` set.

Signed in, another method can be added to the same account. Without signing in, the browser has a
guest account of its own. Signing in uses a cookie of the Worker's own domain, so it needs the
website served by the Worker (the default setup); a site on another domain can still translate,
but not sign in.

**Credits** (1 credit = 60 seconds of video, counted by the second, 10 seconds at least; dubbing
costs twice) are **off** until `CREDITS_ENABLED = "1"` in `wrangler.toml`. When on, a job's
credits are set aside when it starts, settled to the video's real length once the Space has
measured it (a video longer than the credits cover is stopped before the heavy work), and given
back if it fails or is cancelled. Re-rendering edited subtitles is free. Credits are spent from
what expires first: free daily credits, then a monthly plan, bonus credits, and bought credits
last. In the bot, `/balance` shows them. On `/admin`, **Accounts** lists people and lets you add
or remove credits.

**Free credits** (when credits are on): a browser that has not signed in gets 0.5 credit once to
try it; signing in the first time gives 3 credits; a signed-in account (Telegram, Google or an
email link) gets 0.5 credit a day, refilled 24 hours after the last refill and never adding up.
Without bought credits or a plan, a video may be at most 90 seconds long and dubbing is limited to
one preview of up to 15 seconds (given back if it fails). The website shows the cost before a job
starts, what is left after, and a **Pricing** tab with the plans (Starter $9 for 30 credits, Pro
$29 for 150, Business $79 for 600 a month) and packs (15 credits for $7, 40 for $16), the free
credits and the limits.

**Payments** (when credits are on):

- **Telegram Stars**, in the bot, need nothing set up: `/buy` (or **⭐ Stars** on the Pricing tab)
  sends an invoice for a pack, or a Stars subscription link for a plan (Telegram renews it every
  30 days). Prices are converted at 50 Stars per dollar (`STARS_PER_USD` in `wrangler.toml`
  changes it). Stars arrive in the bot's balance (@BotFather → your bot → Payments, or the
  Fragment platform, to withdraw).
- **Cards (Stripe)**, on the website, with `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`: **Pay
  by card** opens Stripe Checkout in a new tab (a one-off payment for a pack, a monthly subscription
  for a plan). In Stripe → Settings → Billing → Customer portal, save the settings once: that is the
  page **Manage subscription** in the account panel opens (cancel, change card, invoices).

Packs add credits that never expire; a plan sets that month's credits at each payment (unused
ones do not carry over). Every payment is counted once, however often its notice arrives. The
website waits for the credits after opening a payment, then restarts the video that was refused.
Buying needs an account (signing in), so the credits are kept.

### Dubbing and accuracy

Speech is recognised with Whisper `large-v3-turbo` (set `WHISPER_MODEL` on the Space to change it),
with Whisper's invented lines over silence filtered out. Translation is mechanical first: the
**translation memory** (rules, below) decides, and a local model translates only what it does not
know, with small rule-based clean-ups before and after it. No cloud AI is used. The local model is
**OPUS-MT** (Helsinki-NLP) for Arabic→English, English→Arabic and English→French, where it measured
better and about 5× faster than NLLB (FLORES-200 devtest, chrF++: 65.8 vs 61.8, 59.2 vs 52.1,
69.5 vs 67.5), and **NLLB-200** for every other pair. The OPUS-MT models are converted when the
Space image is built (`backend/tools/convert_opus.sh`, pinned versions); `OPUS_ENABLED=0` sends
every pair to NLLB. Glossary terms are kept out of the model's hands with a placeholder each
model copies as it is (`ZQX1` for NLLB, `XQ1` for OPUS-MT, whose Arabic vocabulary has no "Z").

Dubbing uses timing lip-sync (isochrony), done mechanically (`backend/app/modules/jobs/dubbing.py`):

- Each sentence is spoken in **one take**, so its intonation and the way its words are said fit the
  whole sentence (a fragment spoken on its own sounds like a sentence of its own).
- The voice reports when it says each word. The take is cut between words where the speaker
  paused, and each piece is placed where the speaker said that part: the dub starts, pauses and
  stops with the speaker. The silence the voice adds around a line is not counted.
- One speaking speed per sentence (the voice itself, up to +35% or down to −15%), changing
  **gradually** between neighbouring sentences (at most 10 points apart), never in jumps.
- What is still a little off is fitted by stretching each piece slightly (pitch kept, 0.9×–1.12×).
  A translation much shorter than what was said gets longer pauses where the voice breathes
  instead of being dragged out. Only a piece that cannot fit before the next line is sped up
  more (and, at worst, faded out). The picture is not changed.
- **Pronunciations** (admin, **/admin → Learning**): how the voice says a word of a language, with
  diacritics (عَلَم, not علم) or spelled as it sounds; the subtitles keep the word as written.

Voices: **female** and **male** are Microsoft Edge voices; **classic** is eSpeak NG, a rule-based
(formant) voice that runs on the Space itself with no model and no AI. It sounds synthetic, but
it is entirely mechanical and predictable. Kurdish has no Edge voice, so Kurdish dubbing always
uses the classic voice (the website shows it; the Space switches to it whatever was chosen).
Hausa has no voice at all and stays subtitles only.

### Translation memory (learning without AI)

KAVOX learns from the people who use it, with plain rules anyone can read:

- When someone signed in corrects a translation in the subtitle editor (and renders again or
  downloads the edited subtitles), each corrected line counts as their vote for "this spoken text
  is translated like this". Once **3 different people** made the same correction, the rule is
  learned and later videos in that language pair use it. (Up to 3,000 sentence rules and 500
  terms per target language go with each job, the most taught first; for the same spoken text an
  admin's rule comes before a learned one.) Each edit counts at most 100 corrected lines.
- Glossary terms (names, brands, fixed words) are written by an admin and translated as written:
  the term is swapped for a placeholder the model copies, and the term's translation is put back
  afterwards. In the rare case the model drops the placeholder, that line is translated again
  without the glossary, so it may not use the admin's wording.
- **Speech fixes**: when someone signed in corrects a word the speech recognition misheard (the
  original line in the subtitle editor), the words they changed count as their vote for "these
  words were really those" in that spoken language. After 3 people (or an admin's approval), every
  later video in that language gets the fix right after recognition, before translation; the
  words keep their timing. The fixed words are also given to Whisper as hints (hotwords) when the
  video's language is chosen. A fix is at most 6 words; a rewritten line teaches nothing.
- On the website's **/admin → Learning** page an admin sees every rule with its votes, approves one
  at once, corrects, rejects or deletes it, and adds sentences, terms or speech fixes.

Each job is sent the active rules for its target language (and the speech fixes for its spoken
language); the Space applies them before its models (speech fixes, then a whole sentence, then
each subtitle).

### Ratings and download methods (learning without AI)

- **Ratings**: under a finished video its owner gives 👍 / 👎 to the translation and, for a dubbed
  video, to the voice (and may change it). A 👎 on the translation points them to the subtitle
  editor, since corrections are what teach KAVOX. On **/admin → Learning → Quality and sites** an
  admin sees the counts per language pair and per language and voice, worst first. With one
  translation engine per language pair (the memory, then OPUS-MT or NLLB) ratings do not choose an
  engine yet; they show where corrections are needed.
- **Download methods per site**: the Space downloads a link with one of a few methods (plain;
  looking like Chrome at the connection level; IPv4 only; both) and reports every try. The Worker
  counts, per site, the tries that worked and failed; a failed try counts only when the site
  refused it or another method then worked (a broken link teaches nothing). Methods that worked
  more often than not are sent with the next job from that site, best first; the Space tries its
  built-in order after them (Facebook: Chrome over IPv4, three tries; others: plain, then Chrome).
  Counts are halved once a method has 40 tries, so when a site changes, KAVOX follows. When no
  method has worked even 40% of the time for a site (after 3 tries or more), the website warns
  under the link box that downloads from it have been failing lately (`GET /api/site-status`).

### Video ending (outro)

Every video with burned-in subtitles or dubbing ends with the 5-second KAVOX logo
(`backend/app/assets/outro.mp4`), fitted to the video's size. Subscribers to a monthly plan choose
in their account panel: the KAVOX ending, their own (a video up to 30 MB, of which the first 30
seconds are used) or none. Their own endings are kept in the R2 bucket `kavox-media` (binding
`MEDIA` in `wrangler.toml`); the Worker sends the clip to the Space with each job. An ending that
cannot be used is replaced by the KAVOX one, and never fails a translation.

### Share links

Every finished video with burned-in subtitles or dubbing gets its own public page at a short
address, `https://<public address>/<id>` (old `/v/<id>` links redirect there): a player, the title and languages, **Copy link** and **Download**,
with a preview picture for Telegram, WhatsApp and other apps. The website shows the link under the
result and the bot sends it after the video. The Worker copies the video and a still from the
Space to the R2 bucket `kavox-media` within a minute or two (the Space only keeps files a day);
until then the page plays it from the Space. Links from free accounts last 30 days; monthly plans
keep theirs until they delete them (`DELETE /api/shares/<id>`). Expired links are removed by the
scheduled task.

### Public address (your own domain)

Links are made with the Worker's own address (`*.workers.dev`) until an admin sets a domain on
**/admin → Settings → Public address** (for example `kavox.to`). First add the domain to the Worker
in Cloudflare (Workers → `vid-translate` → Settings → Domains & Routes → Add → Custom domain) and
wait until it opens: KAVOX refuses to save a domain that does not reach it yet (it asks
`https://<domain>/api/instance` and compares a fingerprint derived from `SHARED_SECRET`). From then
on every new link uses the domain, and video pages and profiles opened on the old address redirect
to it (the rest of the website still opens on both addresses, and video and picture files are
served on both). Clearing the field goes back to the Worker's address.

The Worker runs first for every address except the home page and the website's files
(`run_worker_first` in `wrangler.toml`), so short links `/<id>` and profiles `/@handle` work; any
other page is handed to the website (`ASSETS` binding).

### Profiles and @handles

A signed-in account claims a unique **@handle** on the Dashboard (3–24 letters, digits, `_` or
`.`; words such as `admin` or `kavox` are reserved), with an optional name and bio; a handle can be
changed once every 7 days. Its public page `https://<public address>/@handle` lists the videos it
posted, with their views. Each video starts as **link only** (only people with the link see it);
**Post to profile** on the Dashboard adds it to the profile, and only then does the video's page
show the creator's @handle (a link-only video does not say who made it). API: `GET/POST /api/profile/me`, `GET /api/handles/<handle>` (is it free?),
`GET /api/profiles/<handle>`, `POST /api/shares/<id>` `{"visibility": "public" | "link"}`.

### Feed, likes and follows

The website's **Feed** tab (`/?tab=feed`) shows posted videos one screen at a time, playing while on
screen (muted until a tap turns sound on) with the creator's @handle, the title and languages, and
**Follow**, **Like**, **Share** and sound buttons. Two tabs:

- **For you**: videos posted in the last 30 days (at most 300), ranked by plain arithmetic, with no
  personal profiling: `(1 + 3 × likes + 0.5 × views) / (hours since posting + 2)^1.3`.
- **Following**: the newest videos of the creators you follow (signed in).

Likes and follows need a signed-in account (one like per video and account; you cannot follow
yourself). Profiles show followers and following and have a **Follow** button; a posted video's
page has a **Like** button. Only videos posted to a profile can be liked or appear in the feed.
API: `GET /api/feed?tab=foryou|following&cursor=`, `GET/POST /api/likes/<id>` `{"liked": bool}`,
`GET/POST /api/follows/<handle>` `{"following": bool}`.

### Comments, reports and moderation

- **Comments**: on a posted video's page and in the feed (the speech-bubble button). Anyone reads
  them; writing needs a signed-in account with an @handle (at most 500 characters, at most 10
  comments in 10 minutes). The author, or the video's creator, can delete a comment.
- **Report**: on every video (feed and page), comment and profile, with a reason (copyright,
  harassment, sexual content, violence, spam, other) and optional details. Signed out works too;
  the reporter is kept as a keyed hash, never the address. A repeated report counts once; at most
  20 reports an hour.
- **Admin → Reports**: open reports grouped by what was reported, the most reported first, with a
  preview and the actions **Dismiss**, **Hide comment**, **Remove video/comment** (copyright
  takedowns: the video, its picture and its page go) and **Block account**. A blocked account
  disappears from the feed, its profile and comments, and cannot comment, like or follow; the
  list of blocked accounts has **Unblock**.
- **Terms** (`/terms`, linked from the site footer and every video and profile page): what may be
  posted, how reports and takedowns work. Set the **Takedown email** in Admin → Settings → Terms
  and takedowns; it is shown there for copyright notices.

API: `GET/POST /api/comments/<video>` (`?before=` for older), `DELETE /api/comments/<id>`,
`POST /api/reports` `{kind: video|comment|profile, target, reason, details}`, and (admin)
`GET/POST /api/admin/moderation` `{action: dismiss|hide|remove|block, kind, target}` or
`{action: "unblock", account_id}`.

### Discover: search, hashtags and trending

The Feed tab has a third tab, **Discover**:

- **Search** creators by @handle (starts with) or name, and videos by caption. Start with `@` for
  creators only, or with `#` to open a hashtag.
- **#Hashtags** in a caption are links everywhere (feed cards, video pages); each opens the videos
  with that hashtag, newest first. Hashtags can use any script (`#عربي`) and match whole words
  (`#cat` is not `#cats`). Links from video pages are `/?tab=feed&tag=<tag>`.
- **Trending**: the most liked videos this week (from those posted in the last 30 days), and the
  hashtags used most lately.
- **Captions**: on the Dashboard, the pencil next to a video edits its caption (up to 150
  characters), which is how creators add hashtags.

API: `GET /api/search?q=`, `GET /api/tags/<tag>`, `GET /api/trending`, and
`POST /api/shares/<id>` `{"title": "..."}` (the video's owner).

### Creator analytics

The Dashboard shows a signed-in creator's numbers for 7, 30 or 90 days: **views**, **likes**,
**comments** and **new followers** (a tile each, with the all-time total; the chosen one as a
daily chart), each video's views in the period and all time with likes and comments, and **your
viewers' languages** (from each viewer's browser language, e.g. Arabic 50%, English 17%).

Views are counted on a video's page and, for posted videos, in the feed after 2 seconds of play
(once per card). Daily counts are kept per video, day and browser language only: no viewer is
identified. Views from before daily counting began appear only in the totals.

API: `GET /api/analytics?days=7|30|90`, `POST /api/views/<id>` (a feed view).

### Notifications

Signed in, the header has a **bell** with the unread count (checked every minute while the page is
open). It opens the inbox: new followers, likes and comments on your videos, and new videos from
creators you follow, newest first; opening it marks them as seen. Nothing is sent for your own
actions; a follow or like undone and done again is told once, and a video posted again reaches
followers once. Notifications are kept 90 days, and those from blocked accounts are hidden.

**Telegram:** an account that signs in with Telegram can tick "Also send them to me on Telegram"
in the inbox; @Kavoxbot then sends each new notification (at most 60 a minute, by the Worker's
cron). Only what happens after turning it on is sent. Links in these messages need the public
domain (Admin → Settings) or the `PUBLIC_URL` variable.

API: `GET /api/notifications?before=`, `GET /api/notifications/unread`,
`POST /api/notifications/read`, `POST /api/notifications/settings` `{"telegram": bool}`.

### Dashboard

The website's **Dashboard** tab (`/?tab=dashboard`) shows, for a signed-in account, everything it
translated on the website and in the Telegram bot (without signing in: what this browser
translated): the credit balance and plan, numbers (videos, minutes, views of shared links, top
languages, videos per day for two weeks, by kind), the video ending setting, and every video with
its thumbnail, share link (copy, open, delete) and, for a day, its files and subtitle editor. It
replaces the old "My translations" list. API: `GET /api/dashboard?client_id=…`.

## Admin dashboard (jobs, name, logo, colour, texts)

Open `/admin` on the website (e.g. `https://vid-translate.YOUR_SUBDOMAIN.workers.dev/admin`) and
sign in with the `ADMIN_PASSWORD` secret. Its workspaces are in the left sidebar:

- **Jobs**: every translation from the website and the bot, shown as a **board** (Queued,
  Translating, Done, Failed, Cancelled), a sortable **table** or a **calendar**. Click a job to
  open its details, files and actions in a side panel. Drag a job to *Cancelled* to stop it, or a
  failed one to *Queued* to run it again (uploaded files cannot be retried: they are not kept).
  Tick several jobs to cancel, retry or delete them together. The top bar has search, quick
  filters, and filters you save yourself. Keyboard: `Ctrl/⌘ K` command palette, `/` search,
  `1` `2` `3` views, arrows or `j` `k` `h` `l` to move, `Enter` to open, `x` to select, `c` cancel,
  `r` retry, `Delete` delete, `Space` then arrows to move a card between columns.
- **Accounts**: everyone who signed in or used the bot, with their credits; open one to add or
  remove credits (and see their history).
- **Insights**: video links by site over the last 7 days (worked, failed, success rate, last
  error), so a site that changes something and breaks shows at once.
- **Settings**: the platform name, logo (upload, remove, and its size in the headers: 24–72 px, default 36), accent colour, the home page heading and introduction,
  and the bot's welcome message (English and Arabic). Saving is live at once; a field left empty
  uses its default.

The defaults, and every other website text and bot message, are in `content/site.json` and
`content/bot.json`. The bot's profile picture is set in Telegram with @BotFather (`/setuserpic`).

## Using the bot

1. Send a video / audio file (up to 20 MB — a Telegram limit for bots) or a video link.
2. Choose **Subtitle file** or **Video with subtitles**. `/lang` changes the target language.
   `/style` (or the **🎨 Subtitle design** button) sets how burned-in subtitles look: a ready-made
   design (Cinema, Bold box, Elegant, Social) or each part on its own: font (Modern, Classic, Bold;
   Arabic in Noto Sans Arabic, Naskh or Kufi), size, position, background and colour.
3. The bot edits one message with live progress (with your place in the queue and an estimated
   wait), then sends the files. If a job fails, **🔄 Try again** runs it again in the same message.

On the website, choosing **Video with burned-in subtitles** shows the same designs and options
(plus any colour) with a live preview of how the subtitles will look. Both offer **Show the
original text too**: the original line, smaller, next to the translation.

**Dynamic captions** (the **Words** option, also in `/style`): *Word highlight* lights each word
as it is spoken; *Pop-up words* shows a few words at a time, popping in, with the spoken one lit
(the short-video look, used by the Social design). The translation has no timing of its own, so a
word's time is estimated from its length within its subtitle.

When a translation is done, the website shows an **interactive transcript** next to the player:
the line being spoken stays in view with its current word lit, any word can be clicked to play
from there, it can show the translation, the original or both, and it can be searched.

Every translation also comes with **subtitles in both languages** (`.srt`) and a plain-text
**transcript** (original and translation). On the website you can fix any subtitle line and, for
a video with burned-in subtitles, **render it again with your edits**: only the burn-in runs,
because the Space keeps the source video with the job's files for 24 hours.

`/status` lists recent jobs, `/cancel` stops the running one. The bot answers in Arabic to
users whose Telegram is set to Arabic, in English otherwise.

To keep the bot private, set `ALLOWED_CHAT_IDS` in `wrangler.toml`.

## Limits worth knowing

- **YouTube links are not supported.** YouTube refuses downloads from datacenter servers
  ("Sign in to confirm you're not a bot"), even from a real Chrome browser, so the bot and the
  website ask for the file instead, before any job starts. Some other sites do the same; the bot
  then says so and asks for the file.
- **Facebook links work** because the Space downloads them with Chrome's connection fingerprint
  (yt-dlp with curl-cffi impersonation), over IPv4, with up to three tries. Without it Facebook
  never answers the Space. Instagram and TikTok links work as they are.
- **Free Spaces sleep** after a period without traffic. The first job afterwards waits while the
  Space boots; the bot shows "Waking up the translation server" and retries every minute for
  about 15 minutes.
- **Speed**: on a free CPU Space expect processing to take about as long as the video itself
  (an estimate, not measured on a Space), longer with burn-in. One job runs at a time.
- Result files live on the Space's disk for 24 hours and are lost if the Space restarts.
  Files delivered in Telegram stay in the chat.
- Videos larger than 50 MB cannot be sent by a bot; the bot sends a 24-hour download link instead.
- Defaults: 5 jobs per hour per user, 60-minute videos, 500 MB uploads (all configurable).
- Licences of the translation models: OPUS-MT `tc-big` ar-en and en-ar are CC-BY 4.0 (credit:
  Helsinki-NLP, OPUS-MT; each model's README is kept next to it in the image) and en-fr is
  Apache 2.0, both fine for commercial use. NLLB-200, used for every other pair, is CC-BY-NC 4.0
  (non-commercial). Before charging for the service, set `NLLB_MODEL` on the Space to a model
  whose licence allows commercial use. It
  must be a CTranslate2 conversion with the NLLB-200 layout: a `sentencepiece.bpe.model` file and
  FLORES-200 language codes (such as `arb_Arab`); a model of another family will not load.

## Local development

Three terminals:

```bash
cd backend && pip install -r requirements.txt && SHARED_SECRET=dev-secret ALLOW_PRIVATE_URLS=1 WHISPER_MODEL=tiny uvicorn app.main:app --port 7860
```

```bash
cp worker/.dev.vars.example .dev.vars && cd worker && npm install && npm run dev
```

```bash
cd web && npm install && npm run dev
```

The website's dev server proxies `/api` to the local Worker. Checks:

```bash
node scripts/check-architecture.mjs
```

```bash
cd backend && python -m pytest tests
```

```bash
cd worker && npm run typecheck
```

```bash
cd web && npm run build
```
