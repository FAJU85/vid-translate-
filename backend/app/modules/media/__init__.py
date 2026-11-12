"""Media brick: fetching source media and all ffmpeg work.

Public interface: download a link or a file, inspect it, extract audio, burn subtitles in.
"""
from .core import burn_subtitles, download_direct, download_url, extract_audio, probe

__all__ = ["burn_subtitles", "download_direct", "download_url", "extract_audio", "probe"]
