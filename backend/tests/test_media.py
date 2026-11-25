from app.modules.media.core import is_site_block


def test_site_block_messages():
    assert is_site_block("[youtube] abc: Sign in to confirm you're not a bot.")
    assert is_site_block(
        "[youtube] wuSCssgYAz4: Unable to download API page: [SSL: UNEXPECTED_EOF_WHILE_READING] "
        "EOF occurred in violation of protocol (_ssl.c:1011)"
    )
    assert is_site_block("HTTP Error 429: Too Many Requests")


def test_other_download_errors_are_not_site_blocks():
    assert not is_site_block("[generic] Unsupported URL: https://example.com/page")
    assert not is_site_block("HTTP Error 404: Not Found")


# ---------------------------------------------------------------- Facebook

from pathlib import Path

import pytest

from app.modules.media import core
from app.shared.errors import PipelineError


@pytest.mark.parametrize("url", [
    "https://www.facebook.com/share/v/1JYZnwE3hX/",
    "https://m.facebook.com/watch/?v=1689004206075325",
    "https://fb.watch/abc123/",
    "https://facebook.com/reel/1689004206075325/",
])
def test_facebook_links_use_chrome_impersonation_over_ipv4(url):
    opts, attempts = core.site_options(url)
    assert opts["impersonate"] == "chrome"
    assert opts["source_address"] == "0.0.0.0" and attempts == 3


@pytest.mark.parametrize("url", ["https://www.instagram.com/p/abc/", "https://notfacebook.com/v", "https://example.com/fb.watch"])
def test_other_links_are_unchanged(url):
    assert core.site_options(url) == ({}, 1)


def test_facebook_download_is_retried_after_a_stalled_connection(monkeypatch, tmp_path):
    outcomes = [PipelineError("E_DOWNLOAD_FAILED", "Connection timed out"), (Path("x.mp4"), {})]
    calls = []

    def fake(url, dest_dir, want_video, cancelled, progress, extra):
        calls.append(extra)
        result = outcomes.pop(0)
        if isinstance(result, Exception):
            raise result
        return result

    monkeypatch.setattr(core, "_download_url", fake)
    path, _ = core.download_url("https://www.facebook.com/reel/1/", tmp_path, True, lambda: False, lambda p: None)
    assert path == Path("x.mp4") and len(calls) == 2


def test_errors_a_retry_cannot_fix_are_not_retried(monkeypatch, tmp_path):
    calls = []

    def fake(*args):
        calls.append(1)
        raise PipelineError("E_VIDEO_TOO_LONG", "too long")

    monkeypatch.setattr(core, "_download_url", fake)
    with pytest.raises(PipelineError):
        core.download_url("https://www.facebook.com/reel/1/", tmp_path, True, lambda: False, lambda p: None)
    assert calls == [1]


def test_a_cancel_during_a_failing_try_stops_the_retries(monkeypatch, tmp_path):
    calls = []
    cancelled = {"now": False}

    def fake(*args):
        calls.append(1)
        cancelled["now"] = True  # the user cancels while this try is failing
        raise PipelineError("E_DOWNLOAD_FAILED", "Connection timed out")

    monkeypatch.setattr(core, "_download_url", fake)
    with pytest.raises(core.Cancelled):
        core.download_url("https://www.facebook.com/reel/1/", tmp_path, True, lambda: cancelled["now"], lambda p: None)
    assert calls == [1]


def test_the_learned_methods_come_first_then_the_built_in_ones():
    assert core.download_order("https://www.tiktok.com/@a/video/1") == ["plain", "chrome"]
    assert core.download_order("https://www.tiktok.com/@a/video/1", ["chrome"]) == ["chrome", "plain"]
    assert core.download_order("https://fb.watch/x/", ["chrome"]) == ["chrome", "chrome-ipv4", "chrome-ipv4", "chrome-ipv4"]
    assert core.download_order("https://x.com/a/status/1", ["made-up", "ipv4"]) == ["ipv4", "plain", "chrome"]


def test_every_try_is_reported_and_the_next_method_is_used(monkeypatch, tmp_path):
    used, tried = [], []

    def fake(url, dest_dir, want_video, cancelled, progress, extra):
        used.append(extra)
        if not extra:  # the plain try is refused, the Chrome one works
            raise PipelineError("E_SITE_BLOCKED", "HTTP Error 429")
        return Path("x.mp4"), {}

    monkeypatch.setattr(core, "_download_url", fake)
    core.download_url("https://www.instagram.com/p/a/", tmp_path, True, lambda: False, lambda p: None, None, tried)
    assert used == [{}, {"impersonate": "chrome"}]
    assert tried == [{"strategy": "plain", "ok": False, "code": "E_SITE_BLOCKED"}, {"strategy": "chrome", "ok": True, "code": None}]


def test_a_bad_video_says_nothing_about_the_site(monkeypatch, tmp_path):
    tried = []
    monkeypatch.setattr(core, "_download_url", lambda *a: (_ for _ in ()).throw(PipelineError("E_VIDEO_TOO_LONG", "long")))
    with pytest.raises(PipelineError):
        core.download_url("https://www.instagram.com/p/a/", tmp_path, True, lambda: False, lambda p: None, None, tried)
    assert tried == []


# ---------------------------------------------------------------- sound alone

import shutil
import subprocess


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg not installed")
def test_album_art_is_not_a_video_and_becomes_the_background(tmp_path):
    """A song with album art is sound alone: it gets a visualizer video, its cover as the background."""
    from app.modules.media import audio_video, probe

    art, song = tmp_path / "art.jpg", tmp_path / "song.mp3"
    run = lambda *a: subprocess.run(["ffmpeg", "-loglevel", "error", "-y", *a], check=True)  # noqa: E731
    run("-f", "lavfi", "-i", "color=c=orange:s=200x200", "-frames:v", "1", str(art))
    run("-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-i", str(art), "-map", "0", "-map", "1",
        "-c:a", "libmp3lame", "-c:v", "mjpeg", "-disposition:v", "attached_pic", str(song))
    assert probe(song)["has_video"] is False

    (tmp_path / "lyrics.ass").write_text("[Script Info]\nScriptType: v4.00+\n", encoding="utf-8")
    out = tmp_path / "video.mp4"
    audio_video(song, "lyrics.ass", out, 2.0, "bars", "cover", "wide", lambda: False, lambda _f: None)
    info = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
                           "-of", "csv=p=0", str(out)], capture_output=True, text=True).stdout.strip()
    assert info == "1280,720" and probe(out)["has_audio"]
    # The corner (outside the visualizer band) is the blurred orange cover, not the default navy.
    pixel = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", str(out), "-frames:v", "1", "-vf", "crop=2:2:4:4",
                            "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True).stdout
    assert pixel[0] > 120 and pixel[2] < 100, pixel
    assert not (tmp_path / "visual_bg.png").exists()  # the working picture is removed
