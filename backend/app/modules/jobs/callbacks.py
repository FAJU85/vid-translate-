"""Signed progress callbacks to the Cloudflare Worker.

They are a shortcut, not the source of truth: a Space cannot reliably open connections to the
Worker, so the Worker also asks /status about every running job. Callbacks therefore fail fast,
and after a failure progress updates pause for a while instead of queueing behind timeouts.
"""
from __future__ import annotations

import logging
import time

import httpx

from ...shared import security, worker_http

log = logging.getLogger("tarjim.jobs")

# The Worker delivers Telegram files while handling the final callback, hence the long read.
_progress_client = worker_http.client(httpx.Timeout(15, connect=5))
_final_client = worker_http.client(httpx.Timeout(180, connect=5))
_PAUSE_AFTER_FAILURE = 60
_last_failure = 0.0


def post_callback(url: str, body: str, final: bool) -> None:
    """POST a job state; the final state is retried a few times, progress updates are not."""
    global _last_failure
    if not final and time.time() - _last_failure < _PAUSE_AFTER_FAILURE:
        return
    attempts = 3 if final else 1
    client = _final_client if final else _progress_client
    for attempt in range(attempts):
        ts = int(time.time())
        try:
            resp = client.post(
                url,
                content=body.encode(),
                headers={
                    "Content-Type": "application/json",
                    "X-Timestamp": str(ts),
                    "X-Signature": security.callback_signature(ts, body),
                },
            )
            if resp.status_code < 500:
                return
            log.warning("callback HTTP %s (attempt %s)", resp.status_code, attempt + 1)
        except httpx.HTTPError as exc:
            log.warning("callback failed: %s (attempt %s)", exc.__class__.__name__, attempt + 1)
        _last_failure = time.time()
        if attempt + 1 < attempts:
            time.sleep(min(30, 3 * 2 ** attempt))
