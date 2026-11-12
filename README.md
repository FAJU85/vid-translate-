# TarjimVideo

Translate the speech of a video into subtitles — Arabic by default, 15 target languages —
from a Telegram bot or a small website. You get an `.srt` / `.vtt` file, or the video with
the subtitles burned into the picture.

```
Telegram ──webhook──►┌──────────────────────┐  POST /invoke   ┌───────────────────────────┐
                     │  Cloudflare Worker   │────────────────►│  Hugging Face Space       │
Website (Pages) ────►│  worker/             │◄────────────────│  backend/  (Docker)       │
        /api/*       │  bot · job store (D1)│  signed progress│  yt-dlp → Whisper → NMT   │
                     └──────────────────────┘    callbacks    │  → SRT/VTT → ffmpeg burn  │
                                                              └───────────────────────────┘
```

| Folder | Runs on | What it does |
| --- | --- | --- |
| `backend/` | Hugging Face Space (Docker) | Downloads, transcribes, translates, renders. No Telegram access needed. |
| `worker/` | Cloudflare Workers + D1 | Telegram webhook, job records, rate limits, delivery of files to the chat, API for the website. |
| `web/` | Cloudflare Pages | Website: submit a link or upload a file, watch progress, preview and edit subtitles, download. |

All Telegram traffic goes through the Worker. The Space only ever talks to the Worker, so it
works even where Spaces cannot reach `api.telegram.org`.

## Deploy

You need a Hugging Face account, a Cloudflare account, and a bot token from
[@BotFather](https://t.me/BotFather).

First pick one long random string. It is the `SHARED_SECRET` on **both** sides:

```bash
openssl rand -hex 32
```

### 1. Backend → Hugging Face Space

The Space is [`vooom/Kavox`](https://huggingface.co/spaces/vooom/Kavox). It is deployed by the
GitHub Action in `.github/workflows/deploy-space.yml`, which uploads `backend/` on every push to
`main` that touches it (or when run manually from the Actions tab). The action signs in through
the Space's **Settings → Trusted Publishers** entry for this GitHub repository, so no Hugging Face
token is stored here. If you pin the publisher to a workflow, the file name is `deploy-space.yml`.

To deploy to a different Space, change `SPACE_ID` in that workflow and add this repository as a
trusted publisher on the new Space.

In the Space's **Settings → Variables and secrets** add the secret `SHARED_SECRET`.
The first build takes several minutes (it bakes the speech and translation models into the image).
When it is running, `https://vooom-kavox.hf.space/health` returns
`"configured": true`. Keep the Space **public**: every route that matters is protected by the secret.

Optional settings (better translation with Gemini, bigger Whisper model, YouTube cookies) are
listed in [`backend/README.md`](backend/README.md).

### 2. Worker → Cloudflare

The Worker is named `vid-translate` in `worker/wrangler.toml`. If the repository is connected to
Cloudflare **Workers Builds**, set that Worker's build **root directory** to `worker` (Settings →
Build), otherwise the build cannot find the configuration. The database id and the three secrets
below are needed either way.

```bash
cd worker
```

```bash
npm install
```

```bash
npx wrangler login
```

```bash
npx wrangler d1 create tarjim-video
```

Edit `wrangler.toml`: paste the printed `database_id`, and set `BACKEND_URL` to your Space URL
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

### 3. Website → Cloudflare Pages

In the Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect to Git**, pick this
repository and set:

| Setting | Value |
| --- | --- |
| Root directory | `web` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Environment variable | `VITE_API_BASE` = your Worker URL (no trailing slash) |

Once the site has its URL, set `ALLOWED_ORIGINS` in `worker/wrangler.toml` (and `CORS_ORIGINS`
on the Space) to that URL and redeploy, so other websites cannot use your API from a browser.
This is a browser-only restriction: direct HTTP calls are still limited only by the rate limits.

## Using the bot

1. Send a video link, or a video / audio file (up to 20 MB — a Telegram limit for bots).
2. Choose **Subtitle file** or **Video with subtitles**. `/lang` changes the target language.
3. The bot edits one message with live progress, then sends the files.

`/status` lists recent jobs, `/cancel` stops the running one. The bot answers in Arabic to
users whose Telegram is set to Arabic, in English otherwise.

To keep the bot private, set `ALLOWED_CHAT_IDS` in `worker/wrangler.toml`.

## Limits worth knowing

- **YouTube and some other sites block datacenter IPs** ("Sign in to confirm you're not a bot").
  When that happens the bot says so and asks for the file instead. To make such links work,
  add `YTDLP_COOKIES` or `YTDLP_PROXY` to the Space.
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
cd worker && npm install && cp .dev.vars.example .dev.vars && npm run dev
```

```bash
cd web && npm install && npm run dev
```

The website's dev server proxies `/api` to the local Worker. Checks:

```bash
cd backend && python -m pytest tests
```

```bash
cd worker && npm run typecheck
```

```bash
cd web && npm run build
```
