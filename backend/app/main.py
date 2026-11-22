"""Base: the HTTP API of the translation backend (runs as a Hugging Face Docker Space).

A base only wires bricks together and speaks HTTP; the work lives in ``app.modules``.
"""
from __future__ import annotations

import logging
import os
import re
import shutil
import threading
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from .modules import speech, subtitles, translation
from .modules.jobs import KEPT_SOURCE, OUTPUT_FILES, OUTRO_UPLOAD, UPLOAD_NAME, Job, manager
from .shared import config, security

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("tarjim")

JOB_ID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
MEDIA_TYPES = {
    "subtitles.srt": "application/x-subrip",
    "original.srt": "application/x-subrip",
    "bilingual.srt": "application/x-subrip",
    "transcript.txt": "text/plain; charset=utf-8",
    "subtitles.vtt": "text/vtt",
    "cues.json": "application/json",
    "video.mp4": "video/mp4",
    "dubbed.mp4": "video/mp4",
    "thumb.jpg": "image/jpeg",
}
_models_ready = threading.Event()


def _warm_models() -> None:
    try:
        speech.warm_up()
        translation.warm_up()
        log.info("models loaded")
    except Exception:  # noqa: BLE001 - jobs retry the load themselves
        log.exception("model warm-up failed")
    finally:
        _models_ready.set()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    if not config.SHARED_SECRET:
        log.error("SHARED_SECRET is not set: every authenticated request will be rejected.")
    manager.start()
    if config.PRELOAD_MODELS:
        threading.Thread(target=_warm_models, name="warmup", daemon=True).start()
    else:
        _models_ready.set()
    yield


app = FastAPI(title="TarjimVideo backend", lifespan=lifespan, docs_url=None, redoc_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_methods=["GET", "PUT", "OPTIONS"],
    allow_headers=["*"],
)


class InvokeRequest(BaseModel):
    job_id: str
    source_kind: str = Field(pattern="^(url|direct|upload|rerender)$")
    source_url: str | None = None
    src_lang: str = "auto"
    tgt_lang: str = "ar"
    subtitle_mode: str = Field(default="soft", pattern="^(soft|hard|dub)$")
    callback_url: str | None = None
    title: str | None = None
    # Burned-in subtitle style: {size, position, color, background}; unknown values use defaults.
    subtitle_style: dict | None = None
    # rerender: burn these edited subtitles into the video kept from `parent_job_id`.
    parent_job_id: str | None = None
    cues: list[dict] | None = Field(default=None, max_length=5000)
    # The ending added to rendered videos; "custom" uses the clip PUT to /outro/{job_id} first.
    outro: str = Field(default="kavox", pattern="^(kavox|custom|none)$")
    # Translation memory for the target language, learned by the Worker from people's corrections.
    memory: dict | None = None


def _require_auth(authorization: str | None) -> None:
    if not security.verify_bearer(authorization):
        raise HTTPException(status_code=401, detail="Unauthorized")


def _require_job_id(job_id: str) -> None:
    if not JOB_ID_RE.match(job_id):
        raise HTTPException(status_code=400, detail="Invalid job id")


@app.get("/")
@app.get("/health")
def health() -> dict:
    return {
        "service": "tarjimvideo-backend",
        "status": "ok",
        "configured": bool(config.SHARED_SECRET),
        "models_ready": _models_ready.is_set(),
        "whisper_model": config.WHISPER_MODEL,
        "cpu_threads": config.CPU_THREADS,
        "pending_jobs": manager.pending_count(),
    }


def _prepare_rerender(req: InvokeRequest) -> Path | None:
    """Link the video kept from the parent job into the new job's folder (no copy, no download).

    Returns the file it created, or None when it was already there (the same job sent again)."""
    if not req.parent_job_id or not JOB_ID_RE.match(req.parent_job_id) or not req.cues:
        raise HTTPException(status_code=400, detail="parent_job_id and cues are required")
    for cue in req.cues:
        try:
            ok = 0 <= float(cue["start"]) < float(cue["end"]) and isinstance(cue.get("translation", ""), str)
        except (KeyError, TypeError, ValueError):
            ok = False
        if not ok:
            raise HTTPException(status_code=400, detail="Each cue needs start < end and text")
    kept = manager.job_dir(req.parent_job_id) / KEPT_SOURCE
    if not kept.exists():
        raise HTTPException(status_code=409, detail="The original video is no longer kept")
    target = manager.job_dir(req.job_id) / KEPT_SOURCE
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        return None
    try:
        os.link(kept, target)
    except OSError:
        shutil.copyfile(kept, target)
    return target


@app.post("/invoke", status_code=202)
def invoke(req: InvokeRequest, authorization: str | None = Header(default=None)) -> dict:
    _require_auth(authorization)
    _require_job_id(req.job_id)
    if req.tgt_lang not in translation.LANGUAGES:
        raise HTTPException(status_code=400, detail=f"Unsupported target language: {req.tgt_lang}")
    if req.subtitle_mode == "dub" and not config.DUBBING_ENABLED:
        raise HTTPException(status_code=400, detail="Dubbing is switched off on this server")
    created = None  # a video this request linked into place, removed again if the job is refused
    if req.source_kind in ("url", "direct"):
        if not req.source_url:
            raise HTTPException(status_code=400, detail="source_url is required")
        try:
            security.assert_public_url(req.source_url)
        except security.UnsafeUrl as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    elif req.source_kind == "rerender":
        created = _prepare_rerender(req)
    elif not (manager.job_dir(req.job_id) / UPLOAD_NAME).exists():
        raise HTTPException(status_code=409, detail="No uploaded file for this job")

    job = Job(
        id=req.job_id,
        source_kind=req.source_kind,
        source_url=req.source_url,
        src_lang=req.src_lang,
        tgt_lang=req.tgt_lang,
        mode=req.subtitle_mode,
        callback_url=req.callback_url,
        title=req.title,
        style=subtitles.SubtitleStyle.from_dict(req.subtitle_style).to_dict(),
        cues=req.cues if req.source_kind == "rerender" else None,
        outro=req.outro,
        memory=req.memory,
    )
    try:
        job = manager.submit(job)
    except OverflowError:
        if created:  # nothing will clean up a video linked for a job that was not taken
            created.unlink(missing_ok=True)
        raise HTTPException(status_code=429, detail="The backend queue is full") from None
    return {"job_id": job.id, "status": "accepted", "state": job.status, "queue": manager.pending_count()}


@app.get("/status/{job_id}")
def status(job_id: str, authorization: str | None = Header(default=None)) -> dict:
    _require_auth(authorization)
    job = manager.jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Unknown job")
    return manager.public(job)


@app.post("/cancel/{job_id}")
def cancel(job_id: str, authorization: str | None = Header(default=None)) -> dict:
    _require_auth(authorization)
    job = manager.cancel(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Unknown job")
    return job.public()


@app.put("/upload/{job_id}")
async def upload(job_id: str, request: Request, exp: str = "", sig: str = "") -> dict:
    """Browser uploads go straight here using a short-lived URL signed by the Worker."""
    _require_job_id(job_id)
    if not security.verify_signed_url(f"upload:{job_id}", exp, sig):
        raise HTTPException(status_code=403, detail="Invalid or expired upload link")
    if job_id in manager.jobs:
        raise HTTPException(status_code=409, detail="Job already started")
    declared = int(request.headers.get("content-length") or 0)
    if declared > config.MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File too large")

    workdir = manager.job_dir(job_id)
    workdir.mkdir(parents=True, exist_ok=True)
    partial = workdir / (UPLOAD_NAME + ".part")
    size = 0
    try:
        with partial.open("wb") as fh:
            async for chunk in request.stream():
                size += len(chunk)
                if size > config.MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="File too large")
                fh.write(chunk)
        if size == 0:
            raise HTTPException(status_code=400, detail="Empty upload")
        partial.replace(workdir / UPLOAD_NAME)
    finally:
        partial.unlink(missing_ok=True)
    return {"job_id": job_id, "bytes": size}


@app.put("/outro/{job_id}")
async def outro(job_id: str, request: Request, authorization: str | None = Header(default=None)) -> dict:
    """A subscriber's own ending clip for one job, sent by the Worker before /invoke."""
    _require_auth(authorization)
    _require_job_id(job_id)
    if job_id in manager.jobs:
        raise HTTPException(status_code=409, detail="Job already started")
    workdir = manager.job_dir(job_id)
    workdir.mkdir(parents=True, exist_ok=True)
    partial = workdir / (OUTRO_UPLOAD + ".part")
    size = 0
    try:
        with partial.open("wb") as fh:
            async for chunk in request.stream():
                size += len(chunk)
                if size > config.MAX_OUTRO_BYTES:
                    raise HTTPException(status_code=413, detail="Ending clip too large")
                fh.write(chunk)
        if size == 0:
            raise HTTPException(status_code=400, detail="Empty upload")
        partial.replace(workdir / OUTRO_UPLOAD)
    finally:
        partial.unlink(missing_ok=True)
    return {"job_id": job_id, "bytes": size}


@app.get("/files/{job_id}/{name}")
def files(job_id: str, name: str, exp: str = "", sig: str = "", filename: str | None = None):
    _require_job_id(job_id)
    if name not in OUTPUT_FILES.values():
        raise HTTPException(status_code=404, detail="Unknown file")
    if not security.verify_signed_url(f"file:{job_id}:{name}", exp, sig):
        raise HTTPException(status_code=403, detail="Invalid or expired link")
    path = manager.job_dir(job_id) / name
    if not path.is_file():
        raise HTTPException(status_code=404, detail="File expired or not found")
    safe = re.sub(r'[\\/\r\n"]', "_", filename)[:120] if filename else None
    return FileResponse(path, media_type=MEDIA_TYPES[name], filename=safe)


@app.exception_handler(HTTPException)
async def http_error(_request: Request, exc: HTTPException) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"error": exc.detail})
