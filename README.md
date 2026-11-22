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
| `GEMINI_API_KEY` | Space | Optional: better translation. |
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

### Video ending (outro)

Every video with burned-in subtitles or dubbing ends with the 5-second KAVOX logo
(`backend/app/assets/outro.mp4`), fitted to the video's size. Subscribers to a monthly plan choose
in their account panel: the KAVOX ending, their own (a video up to 30 MB, of which the first 30
seconds are used) or none. Their own endings are kept in the R2 bucket `kavox-media` (binding
`MEDIA` in `wrangler.toml`); the Worker sends the clip to the Space with each job. An ending that
cannot be used is replaced by the KAVOX one, and never fails a translation.

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
- **Settings**: the platform name, logo, accent colour, the home page heading and introduction,
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
- The default translation model, NLLB-200, is CC-BY-NC 4.0 (non-commercial). For commercial use
  set `GEMINI_API_KEY` on the Space or choose another model.

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
