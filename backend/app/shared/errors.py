"""Error types that cross brick boundaries."""
from __future__ import annotations


class PipelineError(Exception):
    """A job step failed with a stable, user-facing error code (e.g. ``E_DOWNLOAD_FAILED``)."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class Cancelled(Exception):
    """The job was cancelled; raised from progress callbacks to stop work early."""
