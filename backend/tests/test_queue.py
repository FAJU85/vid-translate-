"""Queue position and time estimate."""
import time

from app.modules.jobs.manager import INITIAL_RATE, OVERHEAD, UNKNOWN_DURATION, JobManager
from app.modules.jobs.model import Job


def job(i: str, mode: str = "soft", duration: float | None = None, created: float = 0.0) -> Job:
    j = Job(id=i, source_kind="url", source_url="https://x", src_lang="auto", tgt_lang="ar", mode=mode, callback_url=None)
    j.duration = duration
    j.created_at = created
    return j


def test_position_and_estimate_follow_the_jobs_ahead():
    m = JobManager()
    running = job("a", duration=600, created=1)
    running.status, running.started_at = "running", time.time() - 60
    second = job("b", mode="hard", created=2)
    third = job("c", duration=120, created=3)
    m.jobs = {j.id: j for j in (running, second, third)}

    assert m.queue_info(running)["queue_position"] == 0
    assert m.queue_info(second)["queue_position"] == 1
    info = m.queue_info(third)
    assert info["queue_position"] == 2
    expected = (
        (OVERHEAD + INITIAL_RATE["soft"] * 600 - 60)            # rest of the running job
        + (OVERHEAD + INITIAL_RATE["hard"] * UNKNOWN_DURATION)  # the job ahead, length unknown
        + (OVERHEAD + INITIAL_RATE["soft"] * 120)               # this job
    )
    assert abs(info["eta_seconds"] - expected) <= 2


def test_finished_jobs_have_no_queue_info_and_teach_the_rate():
    m = JobManager()
    done = job("d", duration=100)
    done.status, done.started_at = "done", time.time() - (OVERHEAD + 2.0 * 100)
    m._learn(done)
    assert INITIAL_RATE["soft"] < m._rate["soft"] < 2.0  # moved toward the measured 2.0 s/s
    assert m.queue_info(done) == {"queue_position": None, "eta_seconds": None}
    assert "queue_position" in m.public(done)
