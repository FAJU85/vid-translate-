"""Job queue and the translation pipeline (one job at a time)."""
from __future__ import annotations

import json
import logging
import queue
import shutil
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

import httpx

from . import asr, config, media, security, subtitles, translate
from .media import Cancelled, MediaError

log = logging.getLogger("tarjim.jobs")

OUTPUT_FILES = {
    "srt": "subtitles.srt",
    "vtt": "subtitles.vtt",
    "original_srt": "original.srt",
    "cues": "cues.json",
    "mp4": "video.mp4",
}
UPLOAD_NAME = "upload.bin"
TERMINAL = {"done", "failed", "cancelled"}

# (start %, end %) of overall progress for each stage, per subtitle mode.
STAGE_SPAN = {
    "soft": {"downloading": (2, 15), "transcribing": (15, 80), "translating": (80, 99)},
    "hard": {"downloading": (2, 12), "transcribing": (12, 60), "translating": (60, 72), "rendering": (72, 99)},
}


@dataclass
class Job:
    id: str
    source_kind: str            # "url" | "direct" | "upload"
    source_url: str | None
    src_lang: str               # ISO code or "auto"
    tgt_lang: str
    mode: str                   # "soft" | "hard"
    callback_url: str | None
    status: str = "queued"
    stage: str = "queued"
    progress: int = 0
    title: str | None = None
    duration: float | None = None
    detected_lang: str | None = None
    engine: str | None = None
    error_code: str | None = None
    error_message: str | None = None
    outputs: dict[str, str] = field(default_factory=dict)
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    cancel_requested: bool = False
    _last_callback: float = 0.0

    def public(self) -> dict:
        return {
            "job_id": self.id,
            "status": self.status,
            "stage": self.stage,
            "progress": self.progress,
            "title": self.title,
            "duration": self.duration,
            "detected_lang": self.detected_lang,
            "engine": self.engine,
            "outputs": self.outputs,
            "error": {"code": self.error_code, "message": self.error_message} if self.error_code else None,
        }


class JobManager:
    def __init__(self) -> None:
        self.jobs: dict[str, Job] = {}
        self._queue: "queue.Queue[str]" = queue.Queue()
        self._lock = threading.Lock()
        self._callbacks = ThreadPoolExecutor(max_workers=1, thread_name_prefix="callback")
        self._worker: threading.Thread | None = None

    # ------------------------------------------------------------------ lifecycle

    def start(self) -> None:
        config.DATA_DIR.mkdir(parents=True, exist_ok=True)
        if self._worker is None:
            self._worker = threading.Thread(target=self._run, name="pipeline", daemon=True)
            self._worker.start()
            threading.Thread(target=self._janitor, name="janitor", daemon=True).start()

    def job_dir(self, job_id: str) -> Path:
        return config.DATA_DIR / job_id

    def pending_count(self) -> int:
        return sum(1 for j in self.jobs.values() if j.status in ("queued", "running"))

    def submit(self, job: Job) -> Job:
        """Idempotent: re-submitting a known job id returns the existing job."""
        with self._lock:
            existing = self.jobs.get(job.id)
            if existing:
                return existing
            if self.pending_count() >= config.MAX_QUEUE:
                raise OverflowError("queue full")
            self.jobs[job.id] = job
        self.job_dir(job.id).mkdir(parents=True, exist_ok=True)
        self._queue.put(job.id)
        return job

    def cancel(self, job_id: str) -> Job | None:
        with self._lock:
            job = self.jobs.get(job_id)
            if not job or job.status in TERMINAL:
                return job
            job.cancel_requested = True
            still_queued = job.status == "queued"
            if still_queued:
                # Free its queue slot right away; the worker thread skips it when it gets there.
                job.status = "cancelled"
                job.error_code, job.error_message = "E_CANCELLED", "The job was cancelled."
        if still_queued:
            self._cleanup_inputs(job)
            self._notify(job, force=True)
        return job

    # ------------------------------------------------------------------ callbacks

    def _notify(self, job: Job, force: bool = False) -> None:
        job.updated_at = time.time()
        if not job.callback_url:
            return
        now = time.time()
        if not force and now - job._last_callback < 4:
            return
        job._last_callback = now
        body = json.dumps(job.public(), ensure_ascii=False)
        final = job.status in TERMINAL
        self._callbacks.submit(self._post_callback, job.callback_url, body, final)

    @staticmethod
    def _post_callback(url: str, body: str, final: bool) -> None:
        attempts = 6 if final else 1
        for attempt in range(attempts):
            ts = int(time.time())
            try:
                resp = httpx.post(
                    url,
                    content=body.encode(),
                    headers={
                        "Content-Type": "application/json",
                        "X-Timestamp": str(ts),
                        "X-Signature": security.callback_signature(ts, body),
                    },
                    # The Worker delivers Telegram files while handling the final callback.
                    timeout=180 if final else 15,
                )
                if resp.status_code < 500:
                    return
                log.warning("callback HTTP %s (attempt %s)", resp.status_code, attempt + 1)
            except httpx.HTTPError as exc:
                log.warning("callback failed: %s (attempt %s)", exc.__class__.__name__, attempt + 1)
            if attempt + 1 < attempts:
                time.sleep(min(60, 3 * 2 ** attempt))

    # ------------------------------------------------------------------- pipeline

    def _run(self) -> None:
        while True:
            job_id = self._queue.get()
            job = self.jobs.get(job_id)
            if not job or job.status in TERMINAL:
                continue  # cancelled while it was still waiting
            try:
                if job.cancel_requested:
                    raise Cancelled()
                self._process(job)
                if job.cancel_requested:
                    raise Cancelled()
                job.status, job.stage, job.progress = "done", "done", 100
            except Cancelled:
                job.status = "cancelled"
                job.error_code, job.error_message = "E_CANCELLED", "The job was cancelled."
            except MediaError as exc:
                job.status = "failed"
                job.error_code, job.error_message = exc.code, exc.message
            except translate.TranslationError as exc:
                job.status = "failed"
                job.error_code, job.error_message = "E_NMT_FAILED", str(exc)
            except Exception as exc:  # noqa: BLE001 - last-resort guard so the worker survives
                log.exception("job %s crashed", job_id)
                job.status = "failed"
                job.error_code = "E_INTERNAL"
                job.error_message = f"Unexpected error: {exc.__class__.__name__}"
            finally:
                self._cleanup_inputs(job)
                log.info("job %s finished: %s %s", job.id, job.status, job.error_code or "")
                self._notify(job, force=True)

    def _process(self, job: Job) -> None:
        workdir = self.job_dir(job.id)
        spans = STAGE_SPAN[job.mode]
        cancelled = lambda: job.cancel_requested  # noqa: E731

        def enter(stage: str) -> None:
            if job.cancel_requested:
                raise Cancelled()
            job.status, job.stage, job.progress = "running", stage, spans[stage][0]
            self._notify(job, force=True)

        def reporter(stage: str):
            lo, hi = spans[stage]

            def report(fraction: float) -> None:
                if job.cancel_requested:
                    raise Cancelled()
                value = int(lo + (hi - lo) * max(0.0, min(1.0, fraction)))
                if value > job.progress:
                    job.progress = value
                    self._notify(job)

            return report

        # 1. Fetch the media -----------------------------------------------------
        enter("downloading")
        want_video = job.mode == "hard"
        if job.source_kind == "upload":
            source = workdir / UPLOAD_NAME
            if not source.exists():
                raise MediaError("E_UPLOAD_MISSING", "The uploaded file was not received.")
        elif job.source_kind == "direct":
            source = media.download_direct(job.source_url or "", workdir / "source.bin", cancelled, reporter("downloading"))
        else:
            try:
                security.assert_public_url(job.source_url or "")
            except security.UnsafeUrl as exc:
                raise MediaError("E_URL_INVALID", str(exc)) from exc
            source, meta = media.download_url(job.source_url or "", workdir, want_video, cancelled, reporter("downloading"))
            job.title = job.title or meta.get("title")

        info = media.probe(source)
        if not info["has_audio"]:
            raise MediaError("E_MEDIA_INVALID", "The file has no audio track to transcribe.")
        job.duration = info["duration"]
        if info["duration"] > config.MAX_DURATION_SEC:
            raise MediaError(
                "E_VIDEO_TOO_LONG",
                f"Video is {int(info['duration'] // 60)} min long; the limit is {config.MAX_DURATION_SEC // 60} min.",
            )

        # 2. Speech recognition ----------------------------------------------------
        enter("transcribing")
        audio = workdir / "audio.wav"
        media.extract_audio(source, audio, info["duration"], cancelled, lambda _f: None)
        try:
            segments, detected = asr.transcribe(
                audio,
                None if job.src_lang in ("", "auto") else job.src_lang,
                info["duration"],
                cancelled,
                reporter("transcribing"),
            )
        except (Cancelled, MediaError):
            raise
        except Exception as exc:  # noqa: BLE001
            log.exception("ASR failed for %s", job.id)
            raise MediaError("E_ASR_FAILED", f"Speech recognition failed: {exc.__class__.__name__}") from exc
        audio.unlink(missing_ok=True)
        job.detected_lang = detected
        segments = subtitles.clean_segments(segments)
        if not segments:
            raise MediaError("E_NO_SPEECH", "No speech was detected in this video.")

        # 3. Translation -------------------------------------------------------------
        enter("translating")
        translations, job.engine = translate.translate_texts(
            [text for _, _, text in segments], detected, job.tgt_lang, reporter("translating")
        )
        cues = subtitles.build_cues(segments, translations)

        (workdir / OUTPUT_FILES["srt"]).write_text(subtitles.to_srt(cues), encoding="utf-8")
        (workdir / OUTPUT_FILES["vtt"]).write_text(subtitles.to_vtt(cues), encoding="utf-8")
        (workdir / OUTPUT_FILES["original_srt"]).write_text(subtitles.to_srt(cues, use_translation=False), encoding="utf-8")
        (workdir / OUTPUT_FILES["cues"]).write_text(
            json.dumps(
                {"src_lang": detected, "tgt_lang": job.tgt_lang, "cues": [c.to_json() for c in cues]},
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        outputs = {k: OUTPUT_FILES[k] for k in ("srt", "vtt", "original_srt", "cues")}

        # 4. Burn-in (hard mode, only when there is a picture to burn into) ------------
        if job.mode == "hard" and info["has_video"]:
            enter("rendering")
            media.burn_subtitles(
                source, OUTPUT_FILES["srt"], workdir / OUTPUT_FILES["mp4"], job.tgt_lang,
                info["duration"], cancelled, reporter("rendering"),
            )
            outputs["mp4"] = OUTPUT_FILES["mp4"]

        job.outputs = outputs

    def _cleanup_inputs(self, job: Job) -> None:
        workdir = self.job_dir(job.id)
        keep = set(OUTPUT_FILES.values()) if job.status == "done" else set()
        for path in workdir.glob("*"):
            if path.name not in keep:
                path.unlink(missing_ok=True)

    def _janitor(self) -> None:
        """Delete expired job folders and forget finished jobs."""
        while True:
            time.sleep(600)
            cutoff = time.time() - config.OUTPUT_TTL_SEC
            try:
                for job_id, job in list(self.jobs.items()):
                    if job.status in TERMINAL and job.updated_at < cutoff:
                        self.jobs.pop(job_id, None)
                for path in config.DATA_DIR.iterdir():
                    job = self.jobs.get(path.name)
                    if path.is_dir() and not (job and job.status not in TERMINAL) and path.stat().st_mtime < cutoff:
                        shutil.rmtree(path, ignore_errors=True)
            except OSError:
                log.exception("janitor pass failed")


manager = JobManager()
