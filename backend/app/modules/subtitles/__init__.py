"""Subtitles brick: turning timed speech segments into readable cues and SRT / WebVTT / ASS files.

Pure functions with no I/O and no dependencies on other bricks.
"""
from .ass import SubtitleStyle, to_ass
from .core import Cue, build_cues, clean_segments, clean_text, to_srt, to_vtt

__all__ = ["Cue", "SubtitleStyle", "build_cues", "clean_segments", "clean_text", "to_ass", "to_srt", "to_vtt"]
