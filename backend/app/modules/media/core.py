"""Fetching source media and all ffmpeg work."""
from __future__ import annotations

import json
import re
import subprocess
import tempfile
from pathlib import Path
from typing import Callable

import httpx

from ...shared import config, security, worker_http
from ...shared.errors import Cancelled, PipelineError as MediaError

ProgressFn = Callable[[float], None]
CancelFn = Callable[[], bool]

RTL_LANGS = {"ar", "fa", "ur", "he", "ps"}


def _clean_ytdlp_error(text: str) -> str:
    text = re.sub(r"\x1b\[[0-9;]*m", "", text)
    text = re.sub(r"^ERROR:\s*", "", text.strip())
    return text[:300]


def download_url(url: str, dest_dir: Path, want_video: bool, cancelled: CancelFn, progress: ProgressFn) -> tuple[Path, dict]:
    """Download with yt-dlp (YouTube, X, TikTok, Vimeo, direct links, ...)."""
    import yt_dlp

    def hook(d: dict) -> None:
        if cancelled():
            raise Cancelled()
        if d.get("status") == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate")
            if total:
                progress(min(1.0, d.get("downloaded_bytes", 0) / total))

    height = config.HARD_SUB_MAX_HEIGHT
    opts: dict = {
        "format": (f"bv*[height<={height}]+ba/b[height<={height}]/b" if want_video else "ba/b"),
        "outtmpl": str(dest_dir / "source.%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "socket_timeout": 30,
        "retries": 3,
        "max_filesize": config.MAX_DOWNLOAD_BYTES,
        "merge_output_format": "mp4",
        "progress_hooks": [hook],
    }
    if config.YTDLP_PROXY:
        opts["proxy"] = config.YTDLP_PROXY
    cookie_file = None
    if config.YTDLP_COOKIES:
        cookie_file = tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False)
        cookie_file.write(config.YTDLP_COOKIES)
        cookie_file.close()
        opts["cookiefile"] = cookie_file.name

    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
            if info.get("_type") == "playlist":
                entries = [e for e in (info.get("entries") or []) if e]
                if not entries:
                    raise MediaError("E_URL_INVALID", "No video found at that link.")
                info = entries[0]
            if info.get("is_live"):
                raise MediaError("E_URL_INVALID", "Live streams are not supported.")
            duration = info.get("duration")
            if duration and duration > config.MAX_DURATION_SEC:
                raise MediaError(
                    "E_VIDEO_TOO_LONG",
                    f"Video is {int(duration // 60)} min long; the limit is {config.MAX_DURATION_SEC // 60} min.",
                )
            # The page may have redirected or pointed somewhere else: re-check every media URL.
            for fmt in [info, *(info.get("requested_formats") or [])]:
                if fmt.get("url"):
                    try:
                        security.assert_public_url(fmt["url"])
                    except security.UnsafeUrl as exc:
                        raise MediaError("E_URL_INVALID", str(exc)) from exc
            ydl.process_ie_result(info, download=True)
    except Cancelled:
        raise
    except MediaError:
        raise
    except yt_dlp.utils.DownloadError as exc:
        message = _clean_ytdlp_error(str(exc))
        if re.search(r"not a bot|sign in to confirm|HTTP Error 429|login required|cookies", message, re.I):
            # The site is refusing this server's IP address rather than the video itself.
            raise MediaError("E_SITE_BLOCKED", message) from exc
        raise MediaError("E_DOWNLOAD_FAILED", message) from exc
    finally:
        if cookie_file:
            Path(cookie_file.name).unlink(missing_ok=True)

    files = sorted(
        (p for p in dest_dir.glob("source.*") if not p.name.endswith((".part", ".ytdl"))),
        key=lambda p: p.stat().st_size,
        reverse=True,
    )
    if not files:
        raise MediaError("E_DOWNLOAD_FAILED", "The download produced no file (it may exceed the size limit).")
    return files[0], {"title": info.get("title"), "duration": info.get("duration")}


def download_direct(url: str, dest: Path, cancelled: CancelFn, progress: ProgressFn) -> Path:
    """Plain streaming GET, used for files relayed by the Worker (Telegram uploads)."""
    try:
        with worker_http.client(httpx.Timeout(30, read=120)) as client, client.stream("GET", url) as resp:
            if resp.status_code != 200:
                raise MediaError("E_DOWNLOAD_FAILED", f"Source file request failed with HTTP {resp.status_code}.")
            total = int(resp.headers.get("content-length") or 0)
            done = 0
            with dest.open("wb") as fh:
                for chunk in resp.iter_bytes(1 << 16):
                    if cancelled():
                        raise Cancelled()
                    done += len(chunk)
                    if done > config.MAX_DOWNLOAD_BYTES:
                        raise MediaError("E_FILE_TOO_LARGE", "The file is larger than the download limit.")
                    fh.write(chunk)
                    if total:
                        progress(min(1.0, done / total))
    except httpx.HTTPError as exc:
        raise MediaError("E_DOWNLOAD_FAILED", f"Could not fetch the source file: {exc.__class__.__name__}.") from exc
    return dest


def probe(path: Path) -> dict:
    """Return {"duration": seconds, "has_video": bool, "has_audio": bool}."""
    proc = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type,disposition",
         "-of", "json", str(path)],
        capture_output=True, text=True, timeout=120,
    )
    if proc.returncode != 0:
        raise MediaError("E_MEDIA_INVALID", "The file is not a readable audio or video file.")
    data = json.loads(proc.stdout or "{}")
    streams = data.get("streams", [])
    has_video = any(
        s.get("codec_type") == "video" and not (s.get("disposition") or {}).get("attached_pic")
        for s in streams
    )
    try:
        duration = float(data.get("format", {}).get("duration") or 0)
    except ValueError:
        duration = 0.0
    return {
        "duration": duration,
        "has_video": has_video,
        "has_audio": any(s.get("codec_type") == "audio" for s in streams),
    }


def _run_ffmpeg(args: list[str], cwd: Path, duration: float, cancelled: CancelFn, progress: ProgressFn) -> None:
    cmd = ["ffmpeg", "-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-progress", "pipe:1", *args]
    with tempfile.TemporaryFile() as err:
        proc = subprocess.Popen(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=err, text=True)
        assert proc.stdout is not None
        try:
            for line in proc.stdout:
                if cancelled():
                    proc.kill()
                    raise Cancelled()
                if line.startswith("out_time_us=") and duration > 0:
                    try:
                        progress(min(1.0, int(line.split("=", 1)[1]) / 1e6 / duration))
                    except ValueError:
                        pass
        finally:
            proc.wait()
        if proc.returncode != 0:
            err.seek(0)
            tail = err.read().decode("utf-8", "replace").strip().splitlines()[-3:]
            raise MediaError("E_RENDER_FAILED", "ffmpeg failed: " + " | ".join(tail)[:300])


def extract_audio(src: Path, dest: Path, duration: float, cancelled: CancelFn, progress: ProgressFn) -> None:
    """16 kHz mono WAV, which is what Whisper wants."""
    try:
        _run_ffmpeg(["-i", str(src), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(dest)],
                    src.parent, duration, cancelled, progress)
    except MediaError as exc:
        raise MediaError("E_MEDIA_INVALID", "Could not read an audio track from the file.") from exc


def burn_subtitles(src: Path, srt_name: str, dest: Path, lang: str, duration: float,
                   cancelled: CancelFn, progress: ProgressFn) -> None:
    """Re-encode the video with subtitles drawn into the picture."""
    font = "Noto Sans Arabic" if lang in RTL_LANGS else "Noto Sans"
    style = f"FontName={font},FontSize=18,Outline=1.2,Shadow=0,MarginV=22"
    vf = (
        f"scale=-2:'min({config.HARD_SUB_MAX_HEIGHT},ih)',"
        f"subtitles={srt_name}:force_style='{style}'"
    )
    _run_ffmpeg(
        ["-i", str(src), "-vf", vf, "-c:v", "libx264", "-preset", "veryfast", "-crf", "24",
         "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(dest)],
        dest.parent, duration, cancelled, progress,
    )
