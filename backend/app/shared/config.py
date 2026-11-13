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

# Speech recognition (faster-whisper). "small" is a sane default for a free CPU Space.
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "small")
WHISPER_BEAM_SIZE = _int("WHISPER_BEAM_SIZE", 2)

# Translation. "auto" = Gemini when GEMINI_API_KEY is set, otherwise the local NLLB model.
TRANSLATOR = os.environ.get("TRANSLATOR", "auto").lower()
NLLB_MODEL = os.environ.get("NLLB_MODEL", "JustFrederik/nllb-200-distilled-600M-ct2-int8")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")

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
WORKER_CONNECT_RETRIES = _int("WORKER_CONNECT_RETRIES", 3)
# OpenMP pools (used by CTranslate2) size themselves from the host too; cap them before any model loads.
os.environ.setdefault("OMP_NUM_THREADS", str(CPU_THREADS))

MAX_DURATION_SEC = _int("MAX_DURATION_MIN", 60) * 60
MAX_UPLOAD_BYTES = _int("MAX_UPLOAD_MB", 500) * 1024 * 1024
MAX_DOWNLOAD_BYTES = _int("MAX_DOWNLOAD_MB", 1500) * 1024 * 1024
MAX_QUEUE = _int("MAX_QUEUE", 20)
OUTPUT_TTL_SEC = _int("OUTPUT_TTL_HOURS", 24) * 3600
# Height cap for burned-in output; keeps CPU encodes and Telegram uploads reasonable.
HARD_SUB_MAX_HEIGHT = _int("HARD_SUB_MAX_HEIGHT", 720)

# Optional yt-dlp helpers: Netscape-format cookies and an outbound proxy.
YTDLP_COOKIES = os.environ.get("YTDLP_COOKIES", "")
YTDLP_PROXY = os.environ.get("YTDLP_PROXY", "")

# Comma-separated origins allowed to upload / fetch results from a browser.
CORS_ORIGINS = [o.strip() for o in os.environ.get("CORS_ORIGINS", "*").split(",") if o.strip()]

# Load the models in the background at start-up so the first job does not pay for it.
PRELOAD_MODELS = _bool("PRELOAD_MODELS", True)

# Local development only: lets source/callback URLs point at localhost.
ALLOW_PRIVATE_URLS = _bool("ALLOW_PRIVATE_URLS")
