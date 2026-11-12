"""Translation brick: subtitle-line translation with Gemini (optional) or local NLLB-200.

Public interface: ``translate_texts``, the supported ``LANGUAGES``, ``TranslationError`` and
``warm_up`` (loads the local model when it will be used).
"""
from .core import LANGUAGES, TranslationError, translate_texts, warm_up

__all__ = ["LANGUAGES", "TranslationError", "translate_texts", "warm_up"]
