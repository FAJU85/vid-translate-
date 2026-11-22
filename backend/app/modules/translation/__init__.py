"""Translation brick: subtitle-line translation by the translation memory (rules learned from
people's corrections) and, for the rest, the local NLLB-200 model.

Public interface: ``translate_texts``, ``Memory`` (its ``sentence`` also serves single subtitles), the
supported ``LANGUAGES``, ``TranslationError`` and ``warm_up`` (loads the local model).
"""
from .core import LANGUAGES, TranslationError, translate_texts, warm_up
from .memory import Memory

__all__ = ["LANGUAGES", "Memory", "TranslationError", "translate_texts", "warm_up"]
