"""Speech brick: speech recognition (faster-whisper).

Public interface: ``transcribe`` and ``warm_up`` (loads the model ahead of the first job).
"""
from .whisper import get_model as warm_up, transcribe

__all__ = ["transcribe", "warm_up"]
