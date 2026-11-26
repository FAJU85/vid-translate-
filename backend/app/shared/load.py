"""How busy the engine is, so the slow steps can go faster while people are waiting.

The jobs brick sets how many videos wait behind the one starting; speech recognition and
translation read it. Under load they use their quicker settings (greedy search instead of a wider
beam): a little less careful, much less waiting. Quiet again, they go back to the careful ones.
"""
from __future__ import annotations

from . import config

_waiting = 0


def set_waiting(count: int) -> None:
    global _waiting
    _waiting = max(0, int(count))


def waiting() -> int:
    return _waiting


def under_load() -> bool:
    """True when FAST_WHEN_WAITING videos or more are waiting (0 turns the fast mode off)."""
    return config.FAST_WHEN_WAITING > 0 and _waiting >= config.FAST_WHEN_WAITING
