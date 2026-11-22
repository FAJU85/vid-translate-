---
title: Kavox
emoji: 🎬
colorFrom: yellow
colorTo: gray
short_description: Video translation backend (subtitles)
sdk: docker
app_port: 7860
pinned: false
---

# TarjimVideo backend

Translation engine for TarjimVideo. It downloads a video (yt-dlp), transcribes the speech
(faster-whisper), translates the lines (NLLB-200, or Gemini when a key is set), writes
SRT / WebVTT files and optionally burns the subtitles into the video (ffmpeg).

It is driven by the Cloudflare Worker in `worker/`; nothing here talks to Telegram.

## Settings

Set these under **Settings → Variables and secrets** of the Space.

| Name | Kind | Default | Purpose |
| --- | --- | --- | --- |
| `SHARED_SECRET` | secret, **required** | – | Same value as the Worker's `SHARED_SECRET`. |
| `WHISPER_MODEL` | variable | `large-v3-turbo` | `tiny`, `base`, `small`, `medium`, `large-v3-turbo`, `large-v3`… Larger is slower and more accurate; `large-v3-turbo` is the best balance on a free CPU Space (`small` is about 1.4× faster, with many more mistakes). |
| `WORD_TIMESTAMPS` | variable | `1` | Word timings for sentence-aware subtitles timed to the speech (about 6% more speech-recognition time). `0` turns them off. |
| `MAX_DURATION_MIN` | variable | `60` | Longest video accepted. |
| `MAX_UPLOAD_MB` | variable | `500` | Largest browser upload. |
| `OUTPUT_TTL_HOURS` | variable | `24` | How long result files are kept. |
| `YTDLP_COOKIES` | secret | – | Contents of a Netscape `cookies.txt`, for sites that need a login to download. |
| `YTDLP_PROXY` | secret | – | Proxy URL for downloads, e.g. `http://user:pass@host:port`. |
| `CORS_ORIGINS` | variable | `*` | Origins allowed to upload from a browser (your Pages URL). |
| `CPU_THREADS` | variable | container's CPU quota | Threads for Whisper and the translator. |
| `WORKER_FORCE_IPV4` | variable | `1` | Reach the Worker over IPv4 only; Spaces cannot reliably use IPv6. |
| `WORKER_CONNECT_RETRIES` | variable | `1` | Retries of a failed connection to the Worker. |

## API

| Route | Auth | Purpose |
| --- | --- | --- |
| `GET /health` | none | Liveness and model status. |
| `POST /invoke` | `Authorization: Bearer <SHARED_SECRET>` | Queue a job. Returns `202`. |
| `GET /status/{job_id}` | bearer | Current state of a job. |
| `POST /cancel/{job_id}` | bearer | Stop a job. |
| `PUT /upload/{job_id}?exp&sig` | signed URL | Browser upload of the source file. |
| `GET /files/{job_id}/{name}?exp&sig` | signed URL | Download a result file. |

Progress is pushed to the job's `callback_url` as JSON with `X-Timestamp` and
`X-Signature = HMAC-SHA256(SHARED_SECRET, "<timestamp>.<body>")`.

## Run locally

```bash
pip install -r requirements.txt pytest
SHARED_SECRET=dev-secret ALLOW_PRIVATE_URLS=1 WHISPER_MODEL=tiny uvicorn app.main:app --port 7860
```

```bash
python -m pytest tests
```

Needs `ffmpeg` on the PATH. The default translation model (NLLB-200) is licensed CC-BY-NC 4.0
(non-commercial): before charging for the service, swap `NLLB_MODEL` for a model whose licence allows
commercial use. The translation memory (rules learned from people's corrections, sent by the Worker with
each job) is applied before the model.
