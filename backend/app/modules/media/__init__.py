"""Media brick: fetching source media and all ffmpeg work.

Public interface: download a link or a file, inspect it, extract audio, burn subtitles in, add an
ending clip (outro).
"""
from .core import (
    OUTRO_MAX_SECONDS, append_outro, build_dub_track, burn_subtitles, download_direct, download_url, extract_audio,
    mix_dub, probe, thumbnail,
)

__all__ = ["OUTRO_MAX_SECONDS", "append_outro", "build_dub_track", "burn_subtitles", "download_direct", "download_url", "extract_audio", "mix_dub", "probe", "thumbnail"]
