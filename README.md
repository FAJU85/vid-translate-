<div align="center">

<img src="web/public/assets/kavox-icon.png" alt="KAVOX" width="88" height="88" />

# KAVOX

**Any video, in your language.**

[![Checks](https://github.com/FAJU85/vid-translate-/actions/workflows/checks.yml/badge.svg?branch=main)](https://github.com/FAJU85/vid-translate-/actions/workflows/checks.yml)
[![Backend deploy](https://github.com/FAJU85/vid-translate-/actions/workflows/deploy-space.yml/badge.svg?branch=main)](https://github.com/FAJU85/vid-translate-/actions/workflows/deploy-space.yml)
[![Security policy](https://img.shields.io/badge/security-policy-1f6feb)](SECURITY.md)
[![PDPL](https://img.shields.io/badge/privacy-Saudi%20PDPL-2ea44f)](docs/OPERATIONS.md#personal-data-saudi-pdpl)
[![License](https://img.shields.io/badge/license-all%20rights%20reserved-lightgrey)](#license)

![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers%20%C2%B7%20D1%20%C2%B7%20R2-F38020?logo=cloudflare&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-backend-009688?logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)

</div>

> **Executive summary:** KAVOX turns the speech of any video into another language: subtitles
> (`.srt` / `.vtt`), subtitles burned into the picture, a dubbed voice, or a lyrics video for songs
> and podcasts. Arabic is the default, with 15 target languages. People use it from an installable
> web app (PWA, Arabic and English) or a Telegram bot, and can share their videos on public
> profiles with a feed, likes, comments and moderation. It runs entirely on free-tier infrastructure
> (Cloudflare and a Hugging Face Space), with an optional pay-per-second GPU on Modal for peak load.
> **Service tier:** best effort, no formal SLA.

---

## Table of Contents
1. [Architecture & Tech Stack](#architecture--tech-stack)
2. [Prerequisites](#prerequisites)
3. [Getting Started](#getting-started)
4. [Configuration & Environment Variables](#configuration--environment-variables)
5. [Usage & API Reference](#usage--api-reference)
6. [Testing & Quality Assurance](#testing--quality-assurance)
7. [Deployment & CI/CD](#deployment--cicd)
8. [Observability & Operations](#observability--operations)
9. [Security & Compliance](#security--compliance)
10. [Governance & Contributing](#governance--contributing)
11. [Support & Ownership](#support--ownership)
12. [License](#license)

---

## Architecture & Tech Stack

KAVOX consists of three independently deployed parts. Each one is a **modular monolith built from
"bricks"**: self-contained modules with one public interface, which CI checks on every change. The
rules are in [ARCHITECTURE.md](ARCHITECTURE.md).

```text
                 ┌────────────────────────── Cloudflare (edge) ───────────────────────────┐
 Web app (PWA) ──►  Worker  worker/                                                       │
 Telegram ───────►  API · bot · jobs · accounts · social · moderation · admin             │
                 │     │            │                    │                                │
                 │  D1 (SQL)   R2 (videos, photos)   static assets (web/ build)           │
                 └─────┼──────────────────────────────────────────────────────────────────┘
                       │  POST /invoke  ▲  signed progress callbacks (HMAC-SHA256)
                       ▼                │
                 ┌─────────────────────────────────────────────┐
                 │ Processing backend  backend/  (Docker)      │
                 │ Hugging Face Space (CPU) · or Modal (GPU)   │
                 │ yt-dlp → Whisper → NLLB / OPUS-MT → SRT/VTT │
                 │ → ffmpeg burn-in · edge-tts dubbing         │
                 └─────────────────────────────────────────────┘
```

| Layer | Folder | Runs on | Stack |
| :--- | :--- | :--- | :--- |
| Web app | `web/` | Static assets served by the Worker | React 19, TypeScript 5, Vite 7, Tailwind CSS 4, PWA (service worker) |
| API & bot | `worker/` | Cloudflare Workers (cron every minute) | TypeScript, D1 (SQLite), R2 object storage, Wrangler 4 |
| Processing | `backend/` | Hugging Face Space (Docker), optional Modal GPU | Python 3.12, FastAPI, faster-whisper `large-v3-turbo`, CTranslate2 (NLLB-200, OPUS-MT), ffmpeg, yt-dlp, edge-tts / eSpeak NG |

* **Data storage:** Cloudflare D1 for records, R2 for shared videos and profile photos (never
  deleted by KAVOX; moderation hides content and tells the owner).
* **Messaging:** no broker. The Worker dispatches jobs over HTTP, and the backend pushes signed
  callbacks; a one-minute cron retries and reconciles.
* **Infrastructure:** Cloudflare Workers Builds (Worker and web app), GitHub Actions (backend
  deploy, secret sync, checks), Docker (backend image). No servers to manage.

---

## Prerequisites

* **Node.js 22** and npm (Worker and web app; the version used in CI)
* **Python 3.12** and pip (backend)
* **ffmpeg** and **eSpeak NG** on the PATH (backend tests and local runs)
* **Accounts**, only to deploy: Cloudflare, Hugging Face, a Telegram bot token from
  [@BotFather](https://t.me/BotFather); optional: Modal, Resend, Google OAuth

---

## Getting Started

### 1. Clone the repository
```bash
git clone https://github.com/FAJU85/vid-translate-.git
```
```bash
cd vid-translate-
```

### 2. Start the processing backend (terminal 1)
```bash
cd backend && pip install -r requirements.txt && SHARED_SECRET=dev-secret ALLOW_PRIVATE_URLS=1 WHISPER_MODEL=tiny uvicorn app.main:app --port 7860
```

### 3. Start the Worker (terminal 2)
```bash
cp worker/.dev.vars.example .dev.vars && cd worker && npm install && npm run dev
```
The database tables are created automatically on the first request; there are no migrations to run.

### 4. Start the web app (terminal 3)
```bash
cd web && npm install && npm run dev
```
The web app's dev server proxies `/api` to the local Worker.

---

## Configuration & Environment Variables

Configuration follows [12-Factor](https://12factor.net) principles. Secrets are kept in the GitHub
repository's **Actions secrets** and pushed to Cloudflare and Hugging Face by the
**Sync secrets** workflow. Day-to-day switches (credits, limits, features, banners, texts) are set in
the **`/admin`** panel, not in code.

| Variable | Where | Description | Required | Default |
| :--- | :--- | :--- | :---: | :--- |
| `SHARED_SECRET` | Worker + backend | Authenticates `/invoke`, signs callbacks and file links | Yes | — |
| `BACKEND_URL` | Worker (`wrangler.toml`) | Processing backend address (Space or Modal) | Yes | Space URL |
| `TELEGRAM_BOT_TOKEN` | Worker | Telegram bot token | For the bot | — |
| `TELEGRAM_WEBHOOK_SECRET` | Worker | Verifies Telegram webhook calls | For the bot | — |
| `ADMIN_PASSWORD` | Worker | `/admin` password (page locked while unset) | Yes | — |
| `ADMIN_TOTP_SECRET` | Worker | Two-step sign-in for `/admin` (or set it up in the panel) | Recommended | — |
| `ALLOWED_ORIGINS` | Worker | Websites allowed to call the API from a browser | No | `*` |
| `RESEND_API_KEY`, `EMAIL_FROM` | Worker | Email sign-in links | No | — |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Worker | "Continue with Google" | No | — |
| `WHISPER_MODEL` | Backend | Speech-recognition model | No | `large-v3-turbo` |
| `MAX_DURATION_MIN` / `MAX_UPLOAD_MB` | Backend | Longest video / largest upload | No | `60` / `500` |
| `OUTPUT_TTL_HOURS` | Backend | How long result files are kept | No | `24` |
| `YTDLP_COOKIES`, `YTDLP_PROXY` | Backend | Download help for sites that need it | No | — |

The complete list, with every optional setting, is in
[docs/OPERATIONS.md](docs/OPERATIONS.md#deploy) and [backend/README.md](backend/README.md#settings).
Never commit secrets: the repository is public.

---

## Usage & API Reference

### Health checks
```bash
curl -s https://YOUR-WORKER/api/health
```
Answers `{"status":"ok","backend":{...}}`: the Worker is up and reports the processing backend's
health, including `models_ready` and `pending_jobs`.
```bash
curl -s https://YOUR-BACKEND/health
```
Answers the backend's own liveness: `"configured": true` means `SHARED_SECRET` is set.
```bash
curl -s https://YOUR-WORKER/version.json
```
Answers the build that is live, which installed apps use to offer updates.

### Interfaces
* **Web app:** `/` (translate, lyrics, feed, discover, dashboard, profiles), `/admin` (operations panel).
* **Telegram bot:** send a link or a file; `/start` for the menu. See [docs/OPERATIONS.md](docs/OPERATIONS.md#using-the-bot).
* **Worker HTTP API:** `/api/*` for the web app: jobs, accounts and sign-in, profiles, feed,
  search, notifications, reports, personal-data export and deletion, and admin routes. They are
  documented by feature in [docs/OPERATIONS.md](docs/OPERATIONS.md).
* **Backend API** (Worker-to-backend, bearer `SHARED_SECRET` or signed links): `POST /invoke`,
  `GET /status/{id}`, `POST /cancel/{id}`, `PUT /upload/{id}`, `GET /files/{id}/{name}`. See
  [backend/README.md](backend/README.md#api).

There is no OpenAPI document; the route tables above are the reference.

---

## Testing & Quality Assurance

Every pull request and every push to `main` runs the **Checks** workflow; a pull request is merged only when it passes.

```bash
node scripts/check-architecture.mjs
```
Brick boundaries: bricks may only import each other through their public interface.
```bash
cd backend && python -m pytest -q tests
```
Backend unit and API tests: pipeline, subtitles, dubbing, queue and load behaviour, security. The
speech and translation models are replaced with stand-ins.
```bash
cd worker && npm run typecheck && npm test
```
Worker: strict TypeScript and unit tests (`node --test`).
```bash
cd web && npm run build
```
Web app: TypeScript and production build.

Pull requests also get an automated code review, and a **preview deployment** on Cloudflare with
its own empty database and storage. User-facing changes are verified in a real browser
(Playwright) against a local Worker before review. No coverage percentage is measured today.

---

## Deployment & CI/CD

| Part | Trigger | How |
| :--- | :--- | :--- |
| Worker + web app | Push to `main` | Cloudflare **Workers Builds** builds `web/` and deploys the Worker; every pull request gets a preview URL |
| Processing backend | Push to `main` touching `backend/` | GitHub Action `deploy-space.yml` uploads to the Hugging Face Space, which rebuilds the Docker image |
| Secrets | Manual (Actions tab) | `sync-secrets.yml` pushes GitHub secrets to Cloudflare and Hugging Face, and connects the bot |
| GPU backend (optional) | Manual | `modal deploy backend/modal_app.py`, then point `BACKEND_URL` at it ([guide](backend/README.md#run-on-modal-gpu-paid-only-while-working)) |

* **Branching:** work happens on a branch and lands through a pull request. Merges are squashed
  and made only by the owner.
* **Database changes:** additive and automatic. Tables and columns are created on first use and
  versioned by a schema fingerprint, so a rollback never needs a down-migration.
* **Rollback:** revert the commit on `main` (both pipelines redeploy the previous code), or in
  Cloudflare use **Workers → Deployments → Rollback**. For the backend, switch `BACKEND_URL`
  between the Space and Modal.
* **Updates for users:** installed apps detect a new build within minutes and update safely,
  never in the middle of an upload or a video in progress.

---

## Observability & Operations

* **Operations panel (`/admin`):** live jobs board (cancel, retry), Insights (download success by
  site, stored videos against the free 10 GB), growth, moderation queue, feedback and audit log.
* **Logs:** the **Logs** workflow (Actions tab, or comment `/logs` on an issue or pull request)
  prints the Space status and build/run logs, Worker builds and live log, and the latest jobs. It
  masks every secret, token, signed link and IP address.
* **Health:** `/api/health` (Worker and backend), and Cloudflare's dashboard for Worker traffic and errors.
* **Runbooks:** [docs/INCIDENT-RESPONSE.md](docs/INCIDENT-RESPONSE.md) for data breaches, and
  [docs/OPERATIONS.md](docs/OPERATIONS.md) for set-up, features and the
  [limits worth knowing](docs/OPERATIONS.md#limits-worth-knowing).
* **Capacity:** one video is processed at a time on the free CPU Space. For launch peaks, switch
  to the GPU backend on Modal; it costs nothing while stopped.

---

## Security & Compliance

* **Vulnerability reporting:** do not open public issues. Follow [SECURITY.md](SECURITY.md): use
  the contact email on the site's `/privacy` page, or GitHub's private vulnerability reporting.
* **Secrets:** kept in GitHub Actions secrets and synced to the platforms. Never committed.
* **Transport and storage:** HTTPS only with HSTS and strict security headers. D1 and R2 are
  encrypted at rest by Cloudflare. Videos are never in a public bucket. Backend files are reached
  only through expiring signed links.
* **Identity:** users have no passwords (email link, Google or Telegram), and session tokens are
  stored as SHA-256 hashes. The admin panel has two-step sign-in, a 12-hour token and lock-out
  after repeated failures. A one-year audit log records admin and personal-data actions.
* **Privacy:** built for Saudi Arabia's **Personal Data Protection Law (PDPL)**. Users give
  consent, and can view, edit, export and delete their data from the dashboard. A breach plan
  covers notifying SDAIA within 72 hours. The [Terms](https://vid-translate.ee-ee455.workers.dev/terms)
  and [Privacy Policy](https://vid-translate.ee-ee455.workers.dev/privacy) are implemented as written.
* **Content moderation:** reports are reviewed in `/admin`. Content is taken down (hidden, never
  deleted), and the owner is always notified.
* **Not claimed:** KAVOX has no SOC 2 or ISO 27001 audit.

---

## Governance & Contributing

1. Read [ARCHITECTURE.md](ARCHITECTURE.md): new code goes into a brick and is reached only
   through the brick's public interface.
2. Branch off `main` and open a pull request. Keep each change small and testable.
3. All **Checks** must pass. User-facing changes are verified in a browser, on phone and desktop
   widths and in Arabic (right to left).
4. Real findings from the automated review are fixed before merge.
5. Rules that apply to every change: no fake or placeholder features; KAVOX never deletes a
   user's videos or photos; features can be switched on and off in `/admin`; and no secrets or
   personal data in code, logs or outside requests.

---

## Support & Ownership

* **Owner:** the repository owner ([@FAJU85](https://github.com/FAJU85)).
* **Users:** the in-app **Feedback** button, or the contact email on `/privacy`.
* **Issues:** [GitHub Issues](https://github.com/FAJU85/vid-translate-/issues). For security
  problems, see [SECURITY.md](SECURITY.md) instead.
* **Availability:** best effort on free-tier infrastructure. There is no on-call rotation or formal SLA.

---

## License

Copyright © 2026 KAVOX. All rights reserved.

The source is visible for transparency, but no licence is granted to use, copy or redistribute it.
Third-party models keep their own licences: OPUS-MT is CC-BY 4.0 / Apache 2.0, and NLLB-200 is
CC-BY-NC 4.0 (non-commercial; see [Limits](docs/OPERATIONS.md#limits-worth-knowing) before charging).
