"""Speech recognition with faster-whisper (CTranslate2)."""
from __future__ import annotations

import re
import threading
import unicodedata
import wave
from pathlib import Path
from typing import Callable

from ...shared import config
from ...shared.errors import Cancelled

_model = None
_lock = threading.Lock()

# Lines Whisper is known to invent over silence or music, learned from its training subtitles.
# Always dropped: nobody says them in a video they are subtitling.
_ALWAYS_INVENTED = [
    "ترجمة نانسي قنقر", "نانسي قنقر",
    "sous-titrage st' 501", "amara.org",
    "untertitel im auftrag des zdf", "untertitel der amara.org-community", "subtitles by the amara.org community",
    "субтитры сделал dimatorzok", "субтитры создавал dimatorzok", "редактор субтитров а.семкин корректор а.егорова",
]
# Often invented, sometimes really said: dropped only when Whisper itself was unsure.
_OFTEN_INVENTED = [
    "thanks for watching", "thank you for watching", "please subscribe", "subscribe to the channel",
    "like and subscribe", "شكرا للمشاهدة", "شكرا على المشاهدة", "اشتركوا في القناة", "اشترك في القناة",
    "لا تنسوا الاشتراك في القناة", "merci d'avoir regardé", "gracias por ver", "danke fürs zuschauen",
    "спасибо за просмотр", "izlediğiniz için teşekkürler", "ご視聴ありがとうございました", "谢谢观看",
]


def _norm(text: str) -> str:
    """Lower case, without accents, diacritics (tashkeel) or punctuation, single spaces."""
    text = unicodedata.normalize("NFKD", text.lower())
    text = "".join(c for c in text if not unicodedata.combining(c) and unicodedata.category(c)[0] not in "PS")
    return re.sub(r"\s+", " ", text).strip()


_ALWAYS = [_norm(p) for p in _ALWAYS_INVENTED]
_OFTEN = [_norm(p) for p in _OFTEN_INVENTED]


def is_invented(text: str, no_speech_prob: float, avg_logprob: float, compression_ratio: float) -> bool:
    """True for a segment that is most likely not speech but one of Whisper's inventions.

    - a loop: the same words over and over (text that compresses far too well);
    - probably no speech and a low-confidence guess at some;
    - a known invented line (always, or when Whisper was unsure).
    """
    if compression_ratio > 2.6:
        return True
    if no_speech_prob > 0.6 and avg_logprob < -1.0:
        return True
    norm = _norm(text)
    if not norm:
        return False
    if any(p and p in norm for p in _ALWAYS):
        return True
    unsure = no_speech_prob > 0.3 or avg_logprob < -0.7
    return unsure and any(p and (norm == p or (p in norm and len(norm) <= len(p) + 12)) for p in _OFTEN)


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
        # The language is decided from several 30-second windows, not only the first one (an
        # intro with music or another language picked the wrong one).
        language_detection_segments=4,
        # Skips silent stretches where Whisper starts to invent text (needs word timestamps).
        hallucination_silence_threshold=2.0 if config.WORD_TIMESTAMPS else None,
    )
    total = duration or info.duration or 0
    out: list[tuple] = []
    for seg in segments:  # lazy generator: decoding happens here
        if cancelled():
            raise Cancelled()
        if total:
            progress(min(1.0, seg.end / total))
        if is_invented(seg.text, seg.no_speech_prob, seg.avg_logprob, seg.compression_ratio):
            continue
        words = [(w.start, w.end, w.word) for w in (seg.words or [])]
        out.append((seg.start, seg.end, seg.text, words))
    return out, info.language
