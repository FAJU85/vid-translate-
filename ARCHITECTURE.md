# Architecture: building with bricks

TarjimVideo is built from **bricks**: self-contained modules with a small public interface,
snapped together by thin **bases** (entry points) on top of a shared **baseplate**. This is
the Polylith / modular-monolith idea applied to each of the three deployable parts.

```
                ┌──────────── deployables ────────────┐
                │                                      │
  Hugging Face Space         Cloudflare Worker        Cloudflare Pages
  backend/app                worker/src               web/src
  ├── main.py      (base)    ├── index.ts   (base)    ├── main.tsx, app/   (base)
  ├── modules/     (bricks)  ├── modules/   (bricks)  ├── modules/         (bricks)
  │   ├── media              │   ├── jobs             │   ├── translate
  │   ├── speech             │   ├── telegram         │   ├── history
  │   ├── translation        │   └── web-api          │   └── telegram
  │   ├── subtitles          └── shared/   (baseplate)└── shared/          (baseplate)
  │   └── jobs
  └── shared/   (baseplate)
```

## The rules

1. **A brick's index is its only door.** Other code imports `modules/<brick>` (TypeScript:
   its `index.ts`; Python: the package, whose `__init__.py` lists the public names in `__all__`).
   Nothing outside a brick imports one of its internal files.
2. **The baseplate depends on nothing above it.** `shared/` holds configuration, security,
   HTTP and error helpers and shared types. It never imports a brick or a base.
3. **Bricks never import a base.** Bases (`backend/app/main.py`, `worker/src/index.ts`,
   `web/src/app/`) only route requests and wire bricks together; the work lives in bricks.
4. **A brick owns its data.** The Worker's `jobs` brick is the only code that writes SQL on the
   `jobs` table; the `telegram` brick owns `chats`. The base creates both from the statements
   each brick exports (`JOBS_SCHEMA`, `CHATS_SCHEMA`).
5. **No cycles: depend on a port instead.** When two bricks would need each other, the lower
   one publishes a small interface and the higher one implements it. Example: the `jobs` brick
   exposes `JobListener`; the `telegram` brick implements it (`telegramJobListener`), and the
   Worker base registers it. `jobs` never imports `telegram`.
   The `jobs` brick also exposes a source port (`registerSourceFetcher`): `telegram` supplies
   the files users send to the bot, and the Worker uploads them to the Space.

These rules are checked automatically, and CI (`.github/workflows/checks.yml`) fails when one
is broken:

| Part | Check |
| --- | --- |
| Backend | `backend/tests/test_architecture.py` (part of `pytest`) |
| Worker and website | `node scripts/check-architecture.mjs` |

## The bricks

### Backend (`backend/app`)

| Brick | Public interface | Does |
| --- | --- | --- |
| `media` | `download_url`, `download_direct`, `probe`, `extract_audio`, `burn_subtitles` | yt-dlp downloads and all ffmpeg work |
| `speech` | `transcribe`, `warm_up` | Speech recognition with faster-whisper |
| `translation` | `translate_texts`, `LANGUAGES`, `TranslationError`, `warm_up` | Gemini or local NLLB-200 translation |
| `subtitles` | `clean_segments`, `build_cues`, `to_srt`, `to_vtt`, `Cue` | Pure cue shaping and file formats |
| `jobs` | `Job`, `manager`, `OUTPUT_FILES`, `UPLOAD_NAME`, `TERMINAL` | The queue, and the pipeline that composes the bricks above |

Baseplate: `shared/config.py`, `shared/security.py`, `shared/errors.py` (`PipelineError`, `Cancelled`).

### Worker (`worker/src`)

| Brick | Public interface | Does |
| --- | --- | --- |
| `jobs` | `createJob`, `dispatch`, `cancelJob`, `sweep`, `handleBackendCallback`, `JobListener`, … | Jobs table, Space client, job lifecycle |
| `telegram` | `handleWebhook`, `setupBot`, `fetchTelegramFile`, `telegramJobListener`, … | The bot, the chats table, delivering results in a chat |
| `web-api` | `handleApi` | The website's JSON API |

Baseplate: `shared/env.ts`, `crypto.ts`, `http.ts`, `db.ts`, `languages.ts`, `urls.ts`.

### Website (`web/src`)

| Brick | Public interface | Does |
| --- | --- | --- |
| `translate` | `TranslateView` | Submit, follow progress, preview and edit subtitles, download |
| `history` | `HistoryView` | Translations submitted from this browser |
| `telegram` | `TelegramView` | How to use the Telegram bot |

Baseplate: `shared/api.ts` (typed client for the Worker and shared types).

## Adding a feature

1. Decide whether it is a new brick or belongs to an existing one (one reason to change per brick).
2. Put the code inside the brick; export only what others need from its index.
3. Use other bricks through their index. If that would create a cycle, add a port (rule 5).
4. Wire it up in the base. Run the checks above.
