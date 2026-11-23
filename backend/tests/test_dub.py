"""Dubbing: spoken lines placed on a track, mixed over the original sound, and the whole job."""
import shutil
import subprocess
import wave

import pytest

from app.modules import media, voice
from test_api import AUTH, JOB, client, fake_models, make_clip, signed, wait_done  # noqa: F401

pytestmark = pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg not installed")
np = pytest.importorskip("numpy")


def tone(path, seconds, freq=440):
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
                    f"sine=frequency={freq}:duration={seconds}", str(path)], check=True)
    return path


def read(path):
    with wave.open(str(path)) as w:
        return w.getframerate(), np.frombuffer(w.readframes(w.getnframes()), dtype="<i2")


def loud(samples, rate, start, end):
    return np.abs(samples[int(start * rate):int(end * rate)]).mean() > 1000


def test_lines_start_on_time_and_never_run_into_the_next(tmp_path):
    short = tone(tmp_path / "a.wav", 0.5)
    long = tone(tmp_path / "b.wav", 3.0)  # 3 s in a 1 s slot: sped up 1.5x, then cut with a fade
    track = tmp_path / "dub.wav"
    media.build_dub_track([(1.0, 2.0, short), (3.0, 4.0, long)], 6.0, track)
    rate, s = read(track)
    assert len(s) == 6 * rate
    assert not loud(s, rate, 0.0, 0.95) and loud(s, rate, 1.05, 1.45) and not loud(s, rate, 1.6, 2.95)
    assert loud(s, rate, 3.05, 3.85) and not loud(s, rate, 4.05, 6.0)


def test_the_mix_keeps_the_picture_and_the_length(tmp_path):
    src = tmp_path / "clip.mp4"
    src.write_bytes(make_clip(tmp_path))
    track = tmp_path / "dub.wav"
    media.build_dub_track([(0.2, 1.5, tone(tmp_path / "v.wav", 1.0, 880))], 2.0, track)
    out = tmp_path / "dubbed.mp4"
    media.mix_dub(src, track, out, 2.0, True, lambda: False, lambda _f: None)
    info = media.probe(out)
    assert info["has_video"] and info["has_audio"] and abs(info["duration"] - 2.0) < 0.2


def test_a_dubbed_job_gives_a_video_and_the_subtitles(client, tmp_path, monkeypatch):
    def fake_synthesize(texts, lang, gender, out_dir, cancelled, progress, rates=None):
        out_dir.mkdir(parents=True, exist_ok=True)
        assert lang == "ar" and gender == "male"
        return [tone(out_dir / f"{i}.wav", 0.8) for i, _ in enumerate(texts)]

    monkeypatch.setattr(voice, "synthesize", fake_synthesize)
    job = JOB.format("d")
    client.put(f"/upload/{job}", params=signed(f"upload:{job}"), content=make_clip(tmp_path))
    r = client.post("/invoke", json={"job_id": job, "source_kind": "upload", "tgt_lang": "ar", "subtitle_mode": "dub",
                                      "subtitle_style": {"voice": "male"}}, headers=AUTH)
    assert r.status_code == 202, r.text
    data = wait_done(client, job)
    assert data["status"] == "done", data
    assert {"dubbed", "srt", "transcript"} <= set(data["outputs"])
    got = client.get(f"/files/{job}/dubbed.mp4", params=signed(f"file:{job}:dubbed.mp4"))
    assert got.status_code == 200 and got.content[4:8] == b"ftyp"


def test_dubbing_a_language_without_voices_fails_clearly(client, tmp_path):
    job = JOB.format("e")
    client.put(f"/upload/{job}", params=signed(f"upload:{job}"), content=make_clip(tmp_path))
    client.post("/invoke", json={"job_id": job, "source_kind": "upload", "tgt_lang": "ku", "subtitle_mode": "dub"},
                headers=AUTH)
    data = wait_done(client, job)
    assert data["status"] == "failed" and data["error"]["code"] == "E_NO_VOICE"


def test_every_target_language_but_two_has_both_voices():
    from app.modules import translation

    missing = {lang for lang in translation.LANGUAGES if not voice.voice_for(lang)}
    assert missing <= {"ku", "ha"}
    assert all(voice.voice_for(lang, "male") for lang in translation.LANGUAGES if lang not in missing)


def test_an_unknown_video_length_still_fits_every_line(tmp_path):
    track = tmp_path / "dub.wav"
    media.build_dub_track([(2.0, 3.0, tone(tmp_path / "a.wav", 0.8))], 0.0, track)
    rate, s = read(track)
    assert len(s) >= 3 * rate and loud(s, rate, 2.1, 2.7)


def test_a_cancel_is_noticed_while_the_voice_service_is_slow(tmp_path, monkeypatch):
    import asyncio
    import time

    from app.modules.voice import core
    from app.shared.errors import Cancelled

    async def slow(text, voice_name, dest, semaphore, rate=0):
        await asyncio.sleep(30)

    monkeypatch.setattr(core, "_one", slow)
    started = time.monotonic()
    with pytest.raises(Cancelled):
        voice.synthesize(["hello"], "en", "female", tmp_path, lambda: time.monotonic() - started > 0.3, lambda _f: None)
    assert time.monotonic() - started < 3


def test_a_bad_background_volume_keeps_the_default(monkeypatch):
    from app.shared import config

    monkeypatch.setenv("X_VOL", "loud")
    assert config._volume("X_VOL", 0.18) == 0.18
    monkeypatch.setenv("X_VOL", "7")
    assert config._volume("X_VOL", 0.18) == 1.0


def test_the_classic_voice_is_espeak_ng():
    assert voice.voice_for("ar", "classic") == "espeak:ar"
    assert voice.voice_for("so", "classic") is None  # no eSpeak NG voice: no dubbing


@pytest.mark.skipif(not shutil.which("espeak-ng"), reason="espeak-ng is not installed")
def test_the_classic_voice_speaks_without_any_model(tmp_path):
    import asyncio

    from app.modules.voice import core

    dest = tmp_path / "line.wav"
    asyncio.run(core._espeak("Welcome to KAVOX", "en", dest, 0))
    with wave.open(str(dest)) as w:
        assert w.getnframes() / w.getframerate() > 0.5


def test_a_piece_is_gently_fitted_to_the_speakers_timing(tmp_path):
    take = tone(tmp_path / "t.wav", 3.0)
    track = tmp_path / "dub.wav"
    # 1 s of the take, where the speaker spoke for 0.95 s: close enough, left as spoken
    # 1 s of the take over 0.5 s of speech: stretched, but only by FIT_FASTER at most
    media.build_dub_track([media.DubPiece(0.0, 2.0, take, 0.0, 1.0, 0.95), media.DubPiece(3.0, 5.0, take, 1.0, 2.0, 0.5)], 6.0, track)
    rate, s = read(track)
    assert loud(s, rate, 0.05, 0.95) and not loud(s, rate, 1.05, 2.9)
    assert loud(s, rate, 3.05, 3.85) and not loud(s, rate, 1 / media.core.FIT_FASTER + 3.05, 6.0)


def test_the_silence_around_a_voice_is_not_counted(tmp_path):
    clip = tmp_path / "padded.wav"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
                    "-af", "adelay=500,apad=pad_dur=0.7", str(clip)], check=True)
    start, end = media.speech_bounds(clip)
    assert start == pytest.approx(0.5, abs=0.03) and end == pytest.approx(1.5, abs=0.03)


def test_a_slowed_down_piece_keeps_its_last_word(tmp_path):
    take = tone(tmp_path / "t.wav", 2.0)
    track = tmp_path / "dub.wav"
    # 1 s of the take over 2 s of speech: played at FIT_SLOWER, so it lasts 1/0.9 s, all of it
    media.build_dub_track([media.DubPiece(1.0, 4.0, take, 0.5, 1.5, 2.0)], 5.0, track)
    rate, s = read(track)
    assert loud(s, rate, 1.05, 1.0 + 1 / media.core.FIT_SLOWER - 0.05)
    assert loud(s, rate, 2.02, 2.06)  # the last bit, past where a 1 s cut would have stopped
    assert not loud(s, rate, 1.0 + 1 / media.core.FIT_SLOWER + 0.05, 5.0)


def test_pronunciation_rules_alone_reach_the_voice(client, tmp_path, monkeypatch):
    said = []

    def fake_synthesize(texts, lang, gender, out_dir, cancelled, progress, rates=None):
        out_dir.mkdir(parents=True, exist_ok=True)
        said.extend(texts)
        return [tone(out_dir / f"{i}.wav", 0.8) if t else None for i, t in enumerate(texts)]

    monkeypatch.setattr(voice, "synthesize", fake_synthesize)
    job = "0c0c0c0c-0000-4000-8000-000000000003"
    client.put(f"/upload/{job}", params=signed(f"upload:{job}"), content=make_clip(tmp_path))
    memory = {"say": [{"src": "ar", "source": "Hello", "translation": "هالو"}]}  # nothing else in the memory
    r = client.post("/invoke", json={"job_id": job, "source_kind": "upload", "tgt_lang": "ar", "subtitle_mode": "dub",
                                      "memory": memory}, headers=AUTH)
    assert r.status_code == 202
    assert wait_done(client, job)["status"] == "done"
    assert said and "هالو" in said[0] and "Hello" not in said[0]  # the fake translation is "[ar] Hello there."
