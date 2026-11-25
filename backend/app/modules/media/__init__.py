"""Media brick: fetching source media and all ffmpeg work.

Public interface: download a link or a file, inspect it, extract audio, burn subtitles in, make a
video from sound alone (visualizer and lyrics), add an ending clip (outro), build and mix a dub track.
"""
from .core import (
    FIT_SLOWER, OUTRO_MAX_SECONDS, STRATEGIES, DubPiece, append_outro, build_dub_track, burn_subtitles, download_direct, download_url,
    extract_audio, mix_dub, probe, speech_bounds, thumbnail,
)
from .visual import BACKDROPS, FRAMES, LOOKS, audio_video

__all__ = ["BACKDROPS", "FRAMES", "LOOKS", "audio_video", "FIT_SLOWER", "OUTRO_MAX_SECONDS", "STRATEGIES", "DubPiece", "append_outro", "build_dub_track", "burn_subtitles", "download_direct", "download_url",
           "extract_audio", "mix_dub", "probe", "speech_bounds", "thumbnail"]
