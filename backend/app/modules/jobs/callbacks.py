"""Signed progress callbacks to the Cloudflare Worker."""
from __future__ import annotations

import logging
import time

import httpx

from ...shared import security

log = logging.getLogger("tarjim.jobs")


def post_callback(url: str, body: str, final: bool) -> None:
    """POST a job state; the final state is retried with backoff, progress updates are not."""
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
