"""The job queue: accepts jobs, runs them one at a time, reports progress, cleans up."""
from __future__ import annotations

import json
import logging
import queue
import shutil
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from ...shared import config
from ...shared.errors import Cancelled, PipelineError
from . import pipeline
from .callbacks import post_callback
from .model import KEPT_SOURCE, OUTPUT_FILES, TERMINAL, Job

log = logging.getLogger("tarjim.jobs")

# Processing time per second of video, learned from finished jobs (a moving average per mode).
# Starting values are measured on the free 2-CPU Space; burning subtitles in re-encodes the video.
INITIAL_RATE = {"soft": 0.6, "hard": 1.4}
RATE_SMOOTHING = 0.3
UNKNOWN_DURATION = 300.0  # a video whose length is not known yet counts as 5 minutes
OVERHEAD = 20.0  # seconds per job outside the per-minute work (download, start-up)


class JobManager:
    def __init__(self) -> None:
        self.jobs: dict[str, Job] = {}
        self._queue: "queue.Queue[str]" = queue.Queue()
        self._lock = threading.Lock()
        self._callbacks = ThreadPoolExecutor(max_workers=1, thread_name_prefix="callback")
        self._worker: threading.Thread | None = None
        self._rate = dict(INITIAL_RATE)

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

    # ------------------------------------------------------------------ queue estimate

    def _estimate(self, job: Job) -> float:
        rate = self._rate.get(job.mode, INITIAL_RATE["soft"])
        return OVERHEAD + rate * (job.duration or UNKNOWN_DURATION)

    def _remaining(self, job: Job, now: float) -> float:
        total = self._estimate(job)
        if job.status == "running" and job.started_at:
            # Never claim it is about to finish: keep at least a tenth of the estimate.
            return max(total - (now - job.started_at), total * 0.1)
        return total

    def queue_info(self, job: Job) -> dict:
        """Place in line (1 = next; 0 = running now) and estimated seconds until it is done."""
        if job.status not in ("queued", "running"):
            return {"queue_position": None, "eta_seconds": None}
        now = time.time()
        with self._lock:
            active = [j for j in self.jobs.values() if j.status in ("queued", "running")]
        if job.status == "running":
            return {"queue_position": 0, "eta_seconds": int(self._remaining(job, now))}
        ahead = [j for j in active if j is not job and (j.status == "running" or j.created_at < job.created_at)]
        waiting = sum(1 for j in ahead if j.status == "queued")
        eta = sum(self._remaining(j, now) for j in ahead) + self._estimate(job)
        return {"queue_position": waiting + 1, "eta_seconds": int(eta)}

    def public(self, job: Job) -> dict:
        """What the Worker sees: the job's state plus its place in the queue."""
        return {**job.public(), **self.queue_info(job)}

    def _learn(self, job: Job) -> None:
        if job.status != "done" or not job.started_at or not job.duration or job.duration < 10:
            return
        rate = max(0.05, (time.time() - job.started_at - OVERHEAD) / job.duration)
        old = self._rate.get(job.mode, INITIAL_RATE["soft"])
        self._rate[job.mode] = old + RATE_SMOOTHING * (rate - old)

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
        body = json.dumps(self.public(job), ensure_ascii=False)
        final = job.status in TERMINAL
        self._callbacks.submit(post_callback, job.callback_url, body, final)

    # ------------------------------------------------------------------- pipeline

    def _run(self) -> None:
        while True:
            job_id = self._queue.get()
            job = self.jobs.get(job_id)
            if not job or job.status in TERMINAL:
                continue  # cancelled while it was still waiting
            job.started_at = time.time()
            try:
                if job.cancel_requested:
                    raise Cancelled()
                pipeline.run(job, self.job_dir(job.id), self._notify)
                with self._lock:  # same lock as cancel(): a cancel cannot slip in between
                    if job.cancel_requested:
                        raise Cancelled()
                    job.status, job.stage, job.progress = "done", "done", 100
            except Cancelled:
                job.status = "cancelled"
                job.error_code, job.error_message = "E_CANCELLED", "The job was cancelled."
            except PipelineError as exc:
                job.status = "failed"
                job.error_code, job.error_message = exc.code, exc.message
            except Exception as exc:  # noqa: BLE001 - last-resort guard so the worker survives
                log.exception("job %s crashed", job_id)
                job.status = "failed"
                job.error_code = "E_INTERNAL"
                job.error_message = f"Unexpected error: {exc.__class__.__name__}"
            finally:
                self._learn(job)
                self._cleanup_inputs(job)
                log.info("job %s finished: %s %s", job.id, job.status, job.error_code or "")
                self._notify(job, force=True)

    def _cleanup_inputs(self, job: Job) -> None:
        workdir = self.job_dir(job.id)
        keep = {*OUTPUT_FILES.values(), KEPT_SOURCE} if job.status == "done" else set()
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
