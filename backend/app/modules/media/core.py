"""Fetching source media and all ffmpeg work."""
from __future__ import annotations

import json
import logging
import re
import subprocess
import tempfile
from pathlib import Path
from typing import Callable
from urllib.parse import urlparse

import httpx

from ...shared import config, security, worker_http
from ...shared.errors import Cancelled, PipelineError as MediaError

log = logging.getLogger("media")

ProgressFn = Callable[[float], None]
CancelFn = Callable[[], bool]



def _clean_ytdlp_error(text: str) -> str:
    text = re.sub(r"\x1b\[[0-9;]*m", "", text)
    text = re.sub(r"^ERROR:\s*", "", text.strip())
    return text[:300]


_SITE_BLOCK = re.compile(
    r"not a bot|sign in to confirm|HTTP Error 429|login required|cookies"
    # YouTube also drops connections from datacenter IPs mid-handshake.
    r"|UNEXPECTED_EOF|EOF occurred in violation of protocol|Connection reset by peer",
    re.I,
)


def is_site_block(message: str) -> bool:
    """True when a download error means the site refuses this server, not that the video is bad."""
    return bool(_SITE_BLOCK.search(message))


_FACEBOOK = re.compile(r"(^|\.)(facebook\.com|fb\.watch|fb\.com)$")


def site_options(url: str) -> tuple[dict, int]:
    """Extra yt-dlp options for a site, and how many times to try it.

    Facebook never answers this server unless the request looks like Chrome at the connection
    level (TLS fingerprint): with curl-cffi's Chrome impersonation it answers at once. Some of its
    addresses also stall at random (and it publishes IPv6 ones this server cannot use), so
    Facebook goes over IPv4 and gets three tries. Measured from the Space: 5 of 6 downloads
    succeeded on the first try, the failure was a stalled connection.
    """
    host = (urlparse(url).hostname or "").lower()
    if _FACEBOOK.search(host):
        return {
            "impersonate": "chrome",  # turned into yt-dlp's ImpersonateTarget at download time
            "source_address": "0.0.0.0",  # IPv4 only
            "extractor_retries": 3,
        }, 3
    return {}, 1


def download_url(url: str, dest_dir: Path, want_video: bool, cancelled: CancelFn, progress: ProgressFn) -> tuple[Path, dict]:
    """Download with yt-dlp (Facebook, Instagram, TikTok, X, direct links, ...)."""
    extra, attempts = site_options(url)
    for attempt in range(1, attempts + 1):
        if attempt > 1 and cancelled():  # the user cancelled while the last try was failing
            raise Cancelled()
        try:
            return _download_url(url, dest_dir, want_video, cancelled, progress, extra)
        except MediaError as exc:
            if attempt == attempts or exc.code not in ("E_DOWNLOAD_FAILED", "E_SITE_BLOCKED"):
                raise
            log.warning("download attempt %d of %d failed (%s); retrying", attempt, attempts, exc.message)
            for partial in dest_dir.glob("source.*"):
                partial.unlink(missing_ok=True)
    raise AssertionError("unreachable")


def _download_url(
    url: str, dest_dir: Path, want_video: bool, cancelled: CancelFn, progress: ProgressFn, extra: dict
) -> tuple[Path, dict]:
    import yt_dlp

    if isinstance(extra.get("impersonate"), str):
        from yt_dlp.networking.impersonate import ImpersonateTarget

        extra = {**extra, "impersonate": ImpersonateTarget.from_str(extra["impersonate"])}

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
        **extra,
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
        if is_site_block(message):
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


def burn_subtitles(src: Path, ass_name: str, dest: Path, duration: float,
                   cancelled: CancelFn, progress: ProgressFn) -> None:
    """Re-encode the video with the styled subtitles (an .ass file in dest's folder) drawn in.

    `shaping=complex` makes libass shape text with HarfBuzz. The simple shaper it otherwise uses
    turns Arabic lam-alef (لا) into a presentation-form glyph the font lacks: a square.
    """
    vf = (
        f"scale=-2:'min({config.HARD_SUB_MAX_HEIGHT},ih)',"
        f"ass={ass_name}:shaping=complex"
    )
    _run_ffmpeg(
        ["-i", str(src), "-vf", vf, "-c:v", "libx264", "-preset", "veryfast", "-crf", "24",
         "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(dest)],
        dest.parent, duration, cancelled, progress,
    )


# ---------------------------------------------------------------------------------- outro

OUTRO_MAX_SECONDS = 30  # a longer ending is cut


def _streams(path: Path) -> dict:
    """The first video and audio stream's format: {"v": {...} | None, "a": {...} | None}."""
    try:
        proc = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries",
             "stream=codec_type,codec_name,width,height,r_frame_rate,time_base,sample_rate,channels:stream_disposition=attached_pic",
             "-of", "json", str(path)],
            capture_output=True, text=True, timeout=120,
        )
    except subprocess.TimeoutExpired:
        raise MediaError("E_RENDER_FAILED", "The ending video could not be read.") from None
    if proc.returncode != 0:
        raise MediaError("E_RENDER_FAILED", "The ending video could not be read.")
    streams = json.loads(proc.stdout or "{}").get("streams", [])
    video = next((s for s in streams if s.get("codec_type") == "video"
                  and not (s.get("disposition") or {}).get("attached_pic")), None)
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    return {"v": video, "a": audio}


def append_outro(video: Path, outro: Path, cancelled: CancelFn, progress: ProgressFn, encoded_here: bool) -> None:
    """Add an ending clip after `video`, in place, fitted to its size, frame rate and sound.

    `encoded_here`: the video was made by burn_subtitles, so the ending is encoded the same way and
    the two are joined without encoding the video again. Otherwise (a picture copied from the
    source) both are encoded into one new file.
    """
    main = _streams(video)
    if not main["v"]:
        return  # audio only: no picture to end with
    end = _streams(outro)
    if not end["v"]:
        raise MediaError("E_RENDER_FAILED", "The ending has no picture.")
    v = main["v"]
    w, h, fps = int(v["width"]), int(v["height"]), v.get("r_frame_rate") or "30/1"
    timescale = (v.get("time_base") or "1/15360").split("/")[-1]
    work = video.parent
    fitted = work / "outro_fitted.mp4"
    joined = work / "outro_joined.mp4"
    try:
        vf = (f"scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=black,"
              f"setsar=1,fps={fps},format=yuv420p")
        args = ["-i", str(outro)]
        audio_out: list[str] = ["-an"]
        if main["a"]:
            rate, channels = int(main["a"].get("sample_rate") or 44100), int(main["a"].get("channels") or 2)
            if not end["a"]:  # a silent ending still needs a sound track to join onto
                args += ["-f", "lavfi", "-i", f"anullsrc=r={rate}:cl={'mono' if channels == 1 else 'stereo'}"]
            # Sound shorter than the picture is padded with silence: the picture sets the length.
            audio_out = ["-map", f"{0 if end['a'] else 1}:a:0", *(["-af", "apad"] if end["a"] else []), "-c:a", "aac", "-b:a", "128k",
                         "-ar", str(rate), "-ac", str(channels)]
        _run_ffmpeg(
            [*args, "-t", str(OUTRO_MAX_SECONDS), "-map", "0:v:0", "-vf", vf, "-c:v", "libx264", "-preset", "veryfast",
             "-crf", "24", "-pix_fmt", "yuv420p", "-video_track_timescale", timescale, *audio_out, "-shortest", str(fitted)],
            work, 0, cancelled, lambda _f: None,
        )
        same_codecs = v.get("codec_name") == "h264" and (not main["a"] or main["a"].get("codec_name") == "aac")
        if encoded_here and same_codecs:
            listing = work / "outro_list.txt"
            listing.write_text(f"file '{video.name}'\nfile '{fitted.name}'\n", encoding="utf-8")
            try:
                _run_ffmpeg(["-f", "concat", "-safe", "0", "-i", listing.name, "-c", "copy", "-movflags", "+faststart",
                             str(joined)], work, 0, cancelled, lambda _f: None)
            finally:
                listing.unlink(missing_ok=True)
        else:
            streams = "[0:v]setsar=1[v0];[v0][0:a][1:v][1:a]concat=n=2:v=1:a=1[v][a]" if main["a"] else \
                "[0:v]setsar=1[v0];[v0][1:v]concat=n=2:v=1:a=0[v]"
            maps = ["-map", "[v]", *(["-map", "[a]", "-c:a", "aac", "-b:a", "128k"] if main["a"] else [])]
            duration = probe(video)["duration"]
            _run_ffmpeg(["-i", str(video), "-i", str(fitted), "-filter_complex", streams, *maps, "-c:v", "libx264",
                         "-preset", "veryfast", "-crf", "24", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(joined)],
                        work, duration, cancelled, progress)
        joined.replace(video)
    finally:
        fitted.unlink(missing_ok=True)
        joined.unlink(missing_ok=True)


# ---------------------------------------------------------------------------------- dubbing

DUB_RATE = 24000  # Hz; what the voices are made at
MAX_SPEEDUP = 1.5  # a line that does not fit its gap is sped up this much at most, then faded out
FADE = 0.08  # seconds


def _decode(path: Path, tempo: float = 1.0):
    """A clip as mono float32 samples at DUB_RATE (optionally sped up without changing the pitch)."""
    import numpy as np

    args = ["ffmpeg", "-nostdin", "-loglevel", "error", "-i", str(path)]
    if abs(tempo - 1.0) > 0.01:
        args += ["-filter:a", f"atempo={tempo:.3f}"]
    args += ["-f", "f32le", "-ac", "1", "-ar", str(DUB_RATE), "-"]
    try:
        proc = subprocess.run(args, capture_output=True, timeout=120)
    except subprocess.TimeoutExpired:
        raise MediaError("E_TTS_FAILED", "A spoken line took too long to read.") from None
    if proc.returncode != 0:
        raise MediaError("E_TTS_FAILED", "A spoken line could not be read.")
    return np.frombuffer(proc.stdout, dtype=np.float32)


def build_dub_track(lines: list[tuple[float, float, Path]], duration: float, dest: Path) -> None:
    """Place each spoken line at its start time in one WAV the length of the video.

    lines: (start, latest end, clip). A clip longer than its slot is sped up (up to MAX_SPEEDUP)
    and, if still too long, cut with a short fade so it never runs into the next line.
    """
    import wave

    import numpy as np

    # An unknown length (0) must not cut every line after the first second: fit the last line too.
    duration = max(duration, max((end for _s, end, _c in lines), default=0.0))
    track = np.zeros(int((duration + 1) * DUB_RATE), dtype=np.float32)
    for start, latest_end, clip in lines:
        samples = _decode(clip)
        slot = max(0.2, latest_end - start)
        length = len(samples) / DUB_RATE
        if length > slot * 1.02:
            samples = _decode(clip, min(length / slot, MAX_SPEEDUP))
        room = int(slot * DUB_RATE)
        if len(samples) > room:
            samples = samples[:room].copy()
            fade = min(len(samples), int(FADE * DUB_RATE))
            samples[-fade:] *= np.linspace(1, 0, fade, dtype=np.float32)
        at = int(start * DUB_RATE)
        end = min(len(track), at + len(samples))
        if end > at:
            track[at:end] += samples[: end - at]
    pcm = (np.clip(track[: int(duration * DUB_RATE) or len(track)], -1, 1) * 32767).astype("<i2")
    with wave.open(str(dest), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(DUB_RATE)
        out.writeframes(pcm.tobytes())


def mix_dub(src: Path, dub_wav: Path, dest: Path, duration: float, has_video: bool,
            cancelled: CancelFn, progress: ProgressFn) -> None:
    """The video with the translated voice over the original sound, kept quietly underneath."""
    mix = (
        f"[0:a]volume={config.DUB_BACKGROUND_VOLUME}[bg];"
        "[bg][1:a]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]"
    )
    common = ["-i", str(src), "-i", str(dub_wav), "-filter_complex", mix, "-map", "[a]"]
    audio = ["-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(dest)]
    if not has_video:
        _run_ffmpeg([*common, *audio], dest.parent, duration, cancelled, progress)
        return
    try:  # the picture as it is: fast, and no quality lost
        _run_ffmpeg([*common, "-map", "0:v:0", "-c:v", "copy", *audio], dest.parent, duration, cancelled, progress)
    except MediaError:  # a codec MP4 cannot hold: re-encode the picture
        _run_ffmpeg(
            [*common, "-map", "0:v:0", "-vf", f"scale=-2:'min({config.HARD_SUB_MAX_HEIGHT},ih)'", "-c:v", "libx264",
             "-preset", "veryfast", "-crf", "24", "-pix_fmt", "yuv420p", *audio],
            dest.parent, duration, cancelled, progress,
        )
