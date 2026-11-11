import shutil
import subprocess
import time

import pytest
from fastapi.testclient import TestClient

from app import asr, security, translate
from app.main import app

AUTH = {"Authorization": "Bearer test-secret"}
JOB = "0a0a0a0a-0000-4000-8000-00000000000{}"


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def fake_models(monkeypatch):
    monkeypatch.setattr(asr, "get_model", lambda: None)
    monkeypatch.setattr(translate, "_get_nllb", lambda: None)
    monkeypatch.setattr(
        asr, "transcribe",
        lambda audio, language, duration, cancelled, progress: ([(0.0, 1.5, " Hello there. ")], "en"),
    )
    monkeypatch.setattr(
        translate, "translate_texts",
        lambda texts, src, tgt, progress: ([f"[{tgt}] {t}" for t in texts], "fake"),
    )


def signed(scope: str, ttl: int = 60) -> dict:
    exp = int(time.time()) + ttl
    return {"exp": exp, "sig": security.sign(f"{scope}:{exp}")}


def make_clip(tmp_path, video: bool = True) -> bytes:
    out = tmp_path / "clip.mp4"
    cmd = ["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=2"]
    if video:
        cmd += ["-f", "lavfi", "-i", "color=c=black:s=160x120:d=2"]
    subprocess.run([*cmd, "-shortest", str(out)], check=True)
    return out.read_bytes()


def wait_done(client, job_id):
    for _ in range(100):
        data = client.get(f"/status/{job_id}", headers=AUTH).json()
        if data["status"] in ("done", "failed", "cancelled"):
            return data
        time.sleep(0.2)
    raise AssertionError("job did not finish")


def test_health_is_public(client):
    assert client.get("/health").json()["status"] == "ok"


def test_invoke_requires_bearer(client):
    body = {"job_id": JOB.format(1), "source_kind": "url", "source_url": "https://example.com/a.mp4"}
    assert client.post("/invoke", json=body).status_code == 401
    assert client.post("/invoke", json=body, headers={"Authorization": "Bearer nope"}).status_code == 401


def test_invoke_rejects_private_urls_and_bad_input(client):
    base = {"job_id": JOB.format(2), "source_kind": "url"}
    for url in ("http://127.0.0.1/x.mp4", "http://169.254.169.254/latest", "file:///etc/passwd", "ftp://example.com/x"):
        assert client.post("/invoke", json={**base, "source_url": url}, headers=AUTH).status_code == 400
    assert client.post("/invoke", json={**base, "job_id": "../../etc"}, headers=AUTH).status_code == 400
    assert client.post("/invoke", json={**base, "source_url": "https://example.com/a", "tgt_lang": "xx"}, headers=AUTH).status_code == 400
    assert client.post("/invoke", json={"job_id": JOB.format(2), "source_kind": "upload"}, headers=AUTH).status_code == 409


def test_upload_needs_valid_signature(client):
    job = JOB.format(3)
    assert client.put(f"/upload/{job}", content=b"x").status_code == 403
    expired = {"exp": int(time.time()) - 5}
    expired["sig"] = security.sign(f"upload:{job}:{expired['exp']}")
    assert client.put(f"/upload/{job}", params=expired, content=b"x").status_code == 403
    other = signed(f"upload:{JOB.format(9)}")
    assert client.put(f"/upload/{job}", params=other, content=b"x").status_code == 403


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg not installed")
def test_upload_job_end_to_end_hard_mode(client, tmp_path):
    job = JOB.format(4)
    clip = make_clip(tmp_path)
    assert client.put(f"/upload/{job}", params=signed(f"upload:{job}"), content=clip).status_code == 200
    body = {"job_id": job, "source_kind": "upload", "tgt_lang": "ar", "subtitle_mode": "hard"}
    assert client.post("/invoke", json=body, headers=AUTH).status_code == 202
    assert client.post("/invoke", json=body, headers=AUTH).status_code == 202  # idempotent

    data = wait_done(client, job)
    assert data["status"] == "done", data
    assert data["detected_lang"] == "en"
    assert set(data["outputs"]) == {"srt", "vtt", "original_srt", "cues", "mp4"}

    srt = client.get(f"/files/{job}/subtitles.srt", params=signed(f"file:{job}:subtitles.srt"))
    assert srt.status_code == 200 and "[ar] Hello there." in srt.text
    mp4 = client.get(f"/files/{job}/video.mp4", params=signed(f"file:{job}:video.mp4"))
    assert mp4.status_code == 200 and mp4.content[4:8] == b"ftyp"

    assert client.get(f"/files/{job}/subtitles.srt").status_code == 403
    assert client.get(f"/files/{job}/upload.bin", params=signed(f"file:{job}:upload.bin")).status_code == 404
    wrong = signed(f"file:{job}:subtitles.vtt")
    assert client.get(f"/files/{job}/subtitles.srt", params=wrong).status_code == 403


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg not installed")
def test_audio_only_hard_mode_skips_render(client, tmp_path):
    job = JOB.format(5)
    clip = make_clip(tmp_path, video=False)
    client.put(f"/upload/{job}", params=signed(f"upload:{job}"), content=clip)
    client.post("/invoke", json={"job_id": job, "source_kind": "upload", "subtitle_mode": "hard"}, headers=AUTH)
    data = wait_done(client, job)
    assert data["status"] == "done" and "mp4" not in data["outputs"]


def test_garbage_upload_fails_cleanly(client):
    job = JOB.format(6)
    client.put(f"/upload/{job}", params=signed(f"upload:{job}"), content=b"this is not a video")
    client.post("/invoke", json={"job_id": job, "source_kind": "upload"}, headers=AUTH)
    data = wait_done(client, job)
    assert data["status"] == "failed" and data["error"]["code"] == "E_MEDIA_INVALID"


def test_callback_signature_roundtrip():
    sig = security.callback_signature(1700000000, '{"a":1}')
    assert sig == security.sign('1700000000.{"a":1}')
    assert security.verify('1700000000.{"a":1}', sig)
    assert not security.verify('1700000000.{"a":2}', sig)


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg not installed")
def test_cancel_frees_queue_slot_and_is_not_overwritten(client, tmp_path, monkeypatch):
    import threading

    from app.jobs import manager

    release = threading.Event()

    def slow_transcribe(audio, language, duration, cancelled, progress):
        release.wait(10)
        return [(0.0, 1.0, "hi")], "en"

    monkeypatch.setattr(asr, "transcribe", slow_transcribe)
    clip = make_clip(tmp_path, video=False)
    first, second = JOB.format(7), JOB.format(8)
    for job in (first, second):
        client.put(f"/upload/{job}", params=signed(f"upload:{job}"), content=clip)
        client.post("/invoke", json={"job_id": job, "source_kind": "upload"}, headers=AUTH)
    for _ in range(50):
        if client.get(f"/status/{first}", headers=AUTH).json()["stage"] == "transcribing":
            break
        time.sleep(0.1)

    # A job still waiting in the queue is cancelled immediately and stops counting.
    assert client.post(f"/cancel/{second}", headers=AUTH).json()["status"] == "cancelled"
    assert manager.pending_count() == 1

    # A running job cancelled mid-flight must not finish as "done".
    client.post(f"/cancel/{first}", headers=AUTH)
    release.set()
    assert wait_done(client, first)["status"] == "cancelled"
    assert client.get(f"/status/{second}", headers=AUTH).json()["status"] == "cancelled"
