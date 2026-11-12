"""Subtitles brick: turning timed speech segments into readable cues and SRT / WebVTT files.

Pure functions with no I/O and no dependencies on other bricks.
"""
from .core import Cue, build_cues, clean_segments, to_srt, to_vtt

__all__ = ["Cue", "build_cues", "clean_segments", "to_srt", "to_vtt"]
