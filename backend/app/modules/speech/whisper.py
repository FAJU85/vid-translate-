"""Speech recognition with faster-whisper (CTranslate2)."""
from __future__ import annotations

import threading
import wave
from pathlib import Path
from typing import Callable

from ...shared import config
from ...shared.errors import Cancelled

_model = None
_lock = threading.Lock()


def _device() -> tuple[str, str]:
    try:
        import ctranslate2

        if ctranslate2.get_cuda_device_count() > 0:
            return "cuda", "float16"
    except Exception:
        pass
    return "cpu", "int8"


def get_model():
    global _model
    with _lock:
        if _model is None:
            from faster_whisper import WhisperModel

            device, compute_type = _device()
            _model = WhisperModel(
                config.WHISPER_MODEL,
                device=device,
                compute_type=compute_type,
                cpu_threads=config.CPU_THREADS,
            )
        return _model


def transcribe(
    audio: Path,
    language: str | None,
    duration: float,
    cancelled: Callable[[], bool],
    progress: Callable[[float], None],
) -> tuple[list[tuple], str]:
    """Return ([(start, end, text, words), ...], detected_language).

    words is [(start, end, text), ...] with WORD_TIMESTAMPS on (the default), else empty: the
    subtitles brick uses them to build whole sentences and time each subtitle to its words.
    """
    import numpy as np

    model = get_model()
    # Decode the 16 kHz mono PCM WAV ourselves: faster-whisper's built-in decoder depends on
    # PyAV, whose API has broken it across releases.
    with wave.open(str(audio), "rb") as wav:
        samples = np.frombuffer(wav.readframes(wav.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
    segments, info = model.transcribe(
        samples,
        language=language or None,
        beam_size=config.WHISPER_BEAM_SIZE,
        vad_filter=True,
        condition_on_previous_text=False,
        word_timestamps=config.WORD_TIMESTAMPS,
    )
    total = duration or info.duration or 0
    out: list[tuple] = []
    for seg in segments:  # lazy generator: decoding happens here
        if cancelled():
            raise Cancelled()
        words = [(w.start, w.end, w.word) for w in (seg.words or [])]
        out.append((seg.start, seg.end, seg.text, words))
        if total:
            progress(min(1.0, seg.end / total))
    return out, info.language
