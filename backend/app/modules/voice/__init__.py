"""Voice brick: speaking translated subtitles (dubbing) with Microsoft Edge's online voices.

Public interface: ``synthesize`` (one audio clip per subtitle), ``voice_for`` and ``VoiceError``.
"""
from .core import VOICES, VoiceError, synthesize, voice_for

__all__ = ["VOICES", "VoiceError", "synthesize", "voice_for"]
