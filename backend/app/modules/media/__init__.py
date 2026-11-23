"""Media brick: fetching source media and all ffmpeg work.

Public interface: download a link or a file, inspect it, extract audio, burn subtitles in, add an
ending clip (outro), build and mix a dub track.
"""
from .core import (
    FIT_SLOWER, OUTRO_MAX_SECONDS, DubPiece, append_outro, build_dub_track, burn_subtitles, download_direct, download_url,
    extract_audio, mix_dub, probe, speech_bounds, thumbnail,
)

__all__ = ["FIT_SLOWER", "OUTRO_MAX_SECONDS", "DubPiece", "append_outro", "build_dub_track", "burn_subtitles", "download_direct", "download_url",
           "extract_audio", "mix_dub", "probe", "speech_bounds", "thumbnail"]
