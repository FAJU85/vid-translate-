"""Runtime configuration, read once from environment variables."""
from __future__ import annotations

import os
from pathlib import Path


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


def _bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


# Shared with the Cloudflare Worker. Authenticates /invoke, signs callbacks and file URLs.
SHARED_SECRET = os.environ.get("SHARED_SECRET", "")

DATA_DIR = Path(os.environ.get("DATA_DIR", "/tmp/tarjim"))

# Speech recognition (faster-whisper). "large-v3-turbo" is far more accurate than "small" (Arabic
# especially) for about 1.4x the time on a free 2-CPU Space; "small" remains the fast choice.
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "large-v3-turbo")
WHISPER_BEAM_SIZE = _int("WHISPER_BEAM_SIZE", 2)
# Dubbing (translated voice, media.mix_dub + the voice brick). Off: the option is refused.
DUBBING_ENABLED = _bool("DUBBING_ENABLED", True)


def _volume(name: str, default: float) -> float:
    """A 0-1 volume; anything unreadable keeps the default instead of stopping the server."""
    try:
        return min(1.0, max(0.0, float(os.environ.get(name, default))))
    except ValueError:
        return default


DUB_BACKGROUND_VOLUME = _volume("DUB_BACKGROUND_VOLUME", 0.18)  # original sound under the voice

# Word timestamps let subtitles follow whole sentences and the speech itself (a little extra CPU).
WORD_TIMESTAMPS = _bool("WORD_TIMESTAMPS", True)

# Translation: the translation memory (sent with each job) first, then this local model.
NLLB_MODEL = os.environ.get("NLLB_MODEL", "JustFrederik/nllb-200-distilled-600M-ct2-int8")
# OPUS-MT models for the pairs where they beat NLLB (translation/opus.py), converted at image build.
OPUS_DIR = os.environ.get("OPUS_DIR", "/home/user/opus")
OPUS_ENABLED = _bool("OPUS_ENABLED", True)

def _available_cpus() -> int:
    """CPUs this container may really use.

    os.cpu_count() reports the host's cores (often dozens on a Space), not the container's
    quota of 2. Sizing model thread pools from it oversubscribes the CPU so badly that a
    15-second clip never finishes transcribing.
    """
    count = os.cpu_count() or 2
    try:
        count = min(count, len(os.sched_getaffinity(0)))
    except (AttributeError, OSError):
        pass
    try:  # cgroup v2 quota, e.g. "200000 100000" means 2 CPUs
        quota, period = Path("/sys/fs/cgroup/cpu.max").read_text().split()[:2]
        if quota != "max":
            count = min(count, max(1, int(int(quota) // int(period))))
    except (OSError, ValueError):
        pass
    try:  # cgroup v1
        quota = int(Path("/sys/fs/cgroup/cpu/cpu.cfs_quota_us").read_text())
        period = int(Path("/sys/fs/cgroup/cpu/cpu.cfs_period_us").read_text())
        if quota > 0 and period > 0:
            count = min(count, max(1, quota // period))
    except (OSError, ValueError):
        pass
    return max(1, count)


CPU_THREADS = _int("CPU_THREADS", _available_cpus())

# Calls to the Worker: force IPv4 (Spaces cannot reliably reach workers.dev over IPv6) and
# retry failed connections this many times.
WORKER_FORCE_IPV4 = _bool("WORKER_FORCE_IPV4", True)
WORKER_CONNECT_RETRIES = _int("WORKER_CONNECT_RETRIES", 1)
# OpenMP pools (used by CTranslate2) size themselves from the host too; cap them before any model loads.
os.environ.setdefault("OMP_NUM_THREADS", str(CPU_THREADS))

MAX_DURATION_SEC = _int("MAX_DURATION_MIN", 60) * 60
MAX_UPLOAD_BYTES = _int("MAX_UPLOAD_MB", 500) * 1024 * 1024
MAX_DOWNLOAD_BYTES = _int("MAX_DOWNLOAD_MB", 1500) * 1024 * 1024
MAX_QUEUE = _int("MAX_QUEUE", 20)
# With this many videos waiting, speech recognition and translation switch to their quicker
# settings (shared/load.py) until the line is short again. 0: always the careful settings.
FAST_WHEN_WAITING = _int("FAST_WHEN_WAITING", 2)
OUTPUT_TTL_SEC = _int("OUTPUT_TTL_HOURS", 24) * 3600
# A subscriber's own ending clip (outro), sent with each job.
MAX_OUTRO_BYTES = _int("MAX_OUTRO_MB", 30) * 1024 * 1024
# Height cap for burned-in output; keeps CPU encodes and Telegram uploads reasonable.
HARD_SUB_MAX_HEIGHT = _int("HARD_SUB_MAX_HEIGHT", 720)
# Sound alone (a song, a podcast) made into a video: at most this long, drawing every frame is slow.
VISUAL_MAX_SEC = _int("VISUAL_MAX_MIN", 15) * 60

# Optional yt-dlp helpers: Netscape-format cookies and an outbound proxy.
YTDLP_COOKIES = os.environ.get("YTDLP_COOKIES", "")
YTDLP_PROXY = os.environ.get("YTDLP_PROXY", "")

# Comma-separated origins allowed to upload / fetch results from a browser.
CORS_ORIGINS = [o.strip() for o in os.environ.get("CORS_ORIGINS", "*").split(",") if o.strip()]

# Load the models in the background at start-up so the first job does not pay for it.
PRELOAD_MODELS = _bool("PRELOAD_MODELS", True)

# Local development only: lets source/callback URLs point at localhost.
ALLOW_PRIVATE_URLS = _bool("ALLOW_PRIVATE_URLS")
