"""The ending clip (outro) added to rendered videos."""
import shutil
import subprocess

import pytest

from app.modules import media
from app.modules.jobs.pipeline import KAVOX_OUTRO

pytestmark = pytest.mark.skipif(not shutil.which("ffmpeg"), reason="needs ffmpeg")


def _clip(path, size="640x360", rate=25, seconds=2, audio=True, codec="libx264"):
    args = ["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", f"testsrc=size={size}:rate={rate}:duration={seconds}"]
    if audio:
        args += ["-f", "lavfi", "-i", f"sine=frequency=440:sample_rate=48000:duration={seconds}", "-ac", "2"]
    args += ["-c:v", codec, "-pix_fmt", "yuv420p", *(["-c:a", "aac"] if audio else []), "-shortest", str(path)]
    subprocess.run(args, check=True)
    return path


def _len(path):
    return media.probe(path)["duration"]


@pytest.mark.parametrize("encoded_here", [True, False])
def test_the_kavox_ending_is_added_and_fitted(tmp_path, encoded_here):
    video = _clip(tmp_path / "video.mp4")  # 640x360, 25 fps, while the ending is 1920x1080, 30 fps
    before = _len(video)
    media.append_outro(video, KAVOX_OUTRO, lambda: False, lambda _f: None, encoded_here)
    after = _len(video)
    assert after == pytest.approx(before + _len(KAVOX_OUTRO), abs=0.3)
    streams = media.core._streams(video)
    assert (streams["v"]["width"], streams["v"]["height"]) == (640, 360)
    assert streams["a"] and int(streams["a"]["sample_rate"]) == 48000
    assert not list(tmp_path.glob("outro_*"))  # no working files left


def test_a_silent_ending_on_a_video_with_sound(tmp_path):
    video = _clip(tmp_path / "video.mp4")
    silent = _clip(tmp_path / "end.mp4", size="320x320", seconds=1, audio=False)
    media.append_outro(video, silent, lambda: False, lambda _f: None, True)
    assert _len(video) == pytest.approx(3, abs=0.3)


def test_a_video_without_sound_gets_a_silent_ending(tmp_path):
    video = _clip(tmp_path / "video.mp4", audio=False)
    media.append_outro(video, KAVOX_OUTRO, lambda: False, lambda _f: None, True)
    assert media.core._streams(video)["a"] is None
    assert _len(video) > 7


def test_a_clip_without_picture_is_refused(tmp_path):
    video = _clip(tmp_path / "video.mp4")
    sound = tmp_path / "sound.m4a"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-f", "lavfi", "-i", "sine=duration=1", str(sound)], check=True)
    with pytest.raises(Exception):
        media.append_outro(video, sound, lambda: False, lambda _f: None, True)
    assert _len(video) == pytest.approx(2, abs=0.2)  # unchanged
