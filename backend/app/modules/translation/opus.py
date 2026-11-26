"""OPUS-MT (Helsinki-NLP): small models for one language pair each, used where they measured
better than NLLB. Commercial use is allowed (CC-BY 4.0: credit Helsinki-NLP; or Apache 2.0).

Measured on FLORES-200 devtest (100 sentences, 2 CPU threads, int8; chrF++, higher is better):

    pair    NLLB-600M   OPUS-MT    speed
    ar->en    61.8       65.8      0.39 -> 0.10 s per sentence
    en->ar    52.1       59.2      0.50 -> 0.10
    en->fr    67.5       69.5      0.48 -> 0.09

Other pairs stay on NLLB (OPUS-MT was worse on ar->fr and en->ha, and has no model for many of
KAVOX's languages). The models are converted to CTranslate2 when the image is built (see the
Dockerfile); without them (tests, local runs) every pair uses NLLB.
"""
from __future__ import annotations

import logging
import threading
from pathlib import Path

from ...shared import config, load

log = logging.getLogger("translation.opus")

# (source, target) -> (folder under OPUS_DIR, token the model needs in front of the text)
PAIRS: dict[tuple[str, str], tuple[str, str | None]] = {
    ("ar", "en"): ("opus-mt-tc-big-ar-en", None),
    ("en", "ar"): ("opus-mt-tc-big-en-ar", ">>ara<<"),  # a model for several Arabic varieties
    ("en", "fr"): ("opus-mt-en-fr", None),
}

# Glossary placeholder these models copy as they are (their Arabic vocabulary has no "Z", so
# NLLB's "ZQX1" would come back as "⁇X1"); measured on all three pairs.
PLACEHOLDER = "XQ"

_models: dict[str, tuple] = {}
_lock = threading.Lock()
_broken: set[str] = set()


def _folder(src: str, tgt: str) -> Path | None:
    pair = PAIRS.get((src, tgt))
    if not pair or not config.OPUS_ENABLED:
        return None
    folder = Path(config.OPUS_DIR) / pair[0]
    return folder if (folder / "model.bin").is_file() and pair[0] not in _broken else None


def available(src: str, tgt: str) -> bool:
    """True when this pair has an OPUS-MT model on this machine."""
    return _folder(src, tgt) is not None


def _load(folder: Path):
    with _lock:
        if folder.name not in _models:
            import ctranslate2
            import sentencepiece as spm

            device = "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"
            _models[folder.name] = (
                ctranslate2.Translator(str(folder), device=device, compute_type="int8", intra_threads=config.CPU_THREADS),
                spm.SentencePieceProcessor(model_file=str(folder / "source.spm")),
                spm.SentencePieceProcessor(model_file=str(folder / "target.spm")),
            )
        return _models[folder.name]


def translate(texts: list[str], src: str, tgt: str, progress, tidy) -> list[str] | None:
    """The texts translated by this pair's OPUS-MT model; None when it cannot be used (the
    caller then uses NLLB)."""
    folder = _folder(src, tgt)
    if folder is None:
        return None
    try:
        translator, source_sp, target_sp = _load(folder)
    except Exception:  # noqa: BLE001 - a broken model must not stop translation: NLLB takes over
        log.exception("OPUS-MT model %s could not be loaded; using NLLB for %s-%s", folder.name, src, tgt)
        _broken.add(folder.name)
        return None
    prefix = PAIRS[(src, tgt)][1]
    out: list[str] = []
    for i in range(0, len(texts), 16):
        chunk = texts[i : i + 16]
        tokens = [[*([prefix] if prefix else []), *source_sp.encode(t, out_type=str), "</s>"] for t in chunk]
        results = translator.translate_batch(tokens, beam_size=2 if load.under_load() else 4, max_decoding_length=256, repetition_penalty=1.1)
        out += [tidy(target_sp.decode(r.hypotheses[0])) for r in results]
        progress(min(1.0, (i + len(chunk)) / len(texts)))
    return out
