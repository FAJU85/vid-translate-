"""Subtitle translation: what the translation memory knows (rules learned from people's
corrections), and the local NLLB-200 model for the rest."""
from __future__ import annotations

import logging
import re
import threading
from typing import Callable

from ...shared import config
from . import opus
from .memory import PLACEHOLDER, Memory

log = logging.getLogger("tarjim.translate")

# ISO 639-1 -> (NLLB / FLORES-200 code, English name)
LANGUAGES: dict[str, tuple[str, str]] = {
    "ar": ("arb_Arab", "Arabic"),
    "en": ("eng_Latn", "English"),
    "fr": ("fra_Latn", "French"),
    "es": ("spa_Latn", "Spanish"),
    "de": ("deu_Latn", "German"),
    "it": ("ita_Latn", "Italian"),
    "pt": ("por_Latn", "Portuguese"),
    "ru": ("rus_Cyrl", "Russian"),
    "tr": ("tur_Latn", "Turkish"),
    "fa": ("pes_Arab", "Persian"),
    "ur": ("urd_Arab", "Urdu"),
    "hi": ("hin_Deva", "Hindi"),
    "bn": ("ben_Beng", "Bengali"),
    "id": ("ind_Latn", "Indonesian"),
    "ms": ("zsm_Latn", "Malay"),
    "zh": ("zho_Hans", "Chinese"),
    "ja": ("jpn_Jpan", "Japanese"),
    "ko": ("kor_Hang", "Korean"),
    "nl": ("nld_Latn", "Dutch"),
    "pl": ("pol_Latn", "Polish"),
    "uk": ("ukr_Cyrl", "Ukrainian"),
    "sv": ("swe_Latn", "Swedish"),
    "he": ("heb_Hebr", "Hebrew"),
    "el": ("ell_Grek", "Greek"),
    "ro": ("ron_Latn", "Romanian"),
    "cs": ("ces_Latn", "Czech"),
    "hu": ("hun_Latn", "Hungarian"),
    "fi": ("fin_Latn", "Finnish"),
    "da": ("dan_Latn", "Danish"),
    "no": ("nob_Latn", "Norwegian"),
    "vi": ("vie_Latn", "Vietnamese"),
    "th": ("tha_Thai", "Thai"),
    "sw": ("swh_Latn", "Swahili"),
    "ku": ("kmr_Latn", "Kurdish"),
    "so": ("som_Latn", "Somali"),
    "ha": ("hau_Latn", "Hausa"),
    "am": ("amh_Ethi", "Amharic"),
    "ta": ("tam_Taml", "Tamil"),
    "az": ("azj_Latn", "Azerbaijani"),
    "kk": ("kaz_Cyrl", "Kazakh"),
    "uz": ("uzn_Latn", "Uzbek"),
    "ps": ("pbt_Arab", "Pashto"),
}

ProgressFn = Callable[[float], None]


class TranslationError(Exception):
    pass


# --------------------------------------------------------------------------- NLLB

_nllb = None
_nllb_lock = threading.Lock()


def _get_nllb():
    global _nllb
    with _nllb_lock:
        if _nllb is None:
            import ctranslate2
            import sentencepiece as spm
            from huggingface_hub import snapshot_download

            try:
                path = snapshot_download(config.NLLB_MODEL)
                device = "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"
                translator = ctranslate2.Translator(path, device=device, intra_threads=config.CPU_THREADS)
                sp = spm.SentencePieceProcessor()
                sp.load(f"{path}/sentencepiece.bpe.model")
            except Exception as exc:  # noqa: BLE001 - a missing or incompatible model is a translation failure
                raise TranslationError(f"The translation model {config.NLLB_MODEL} could not be loaded ({exc.__class__.__name__}).") from exc
            _nllb = (translator, sp)
        return _nllb


# Arabic unit names that speech recognition often writes as two words ("كيلو متر"): the local
# model reads the pair as something else (miles, kilos), so they are joined first.
_AR_UNIT = re.compile(r"(?<!\S)(كيلو|سنتي|ميلي|ملي|ميكرو|ميغا|ميجا|جيجا|غيغا)\s+(متر|مترا|مترات|غرام|غراما|جرام|جراما|لتر|لترا|واط|بايت|هرتز)(?!\S)")


def normalize_source(text: str, src: str) -> str:
    """Small, rule-based clean-up of recognised speech before translation."""
    if src == "ar":
        text = _AR_UNIT.sub(r"\1\2", text)
    return text


# The local model's output has tokenizer spacing: "word ." / "didn 't" / "( word )".
_SPACE_BEFORE = re.compile(r"\s+([.,!?;:%)\]}»”،؛؟…])")
_SPACE_AFTER = re.compile(r"([(\[{«“])\s+")
_CONTRACTION = re.compile(r"(\w) (n't|'(?:t|s|re|ve|ll|d|m))\b", re.IGNORECASE)


def tidy(text: str) -> str:
    """Remove the tokenizer's stray spaces around punctuation and in English contractions."""
    text = _SPACE_BEFORE.sub(r"\1", text)
    text = _SPACE_AFTER.sub(r"\1", text)
    text = _CONTRACTION.sub(r"\1\2", text)
    return re.sub(r"\s{2,}", " ", text).strip()


def _nllb_translate(texts: list[str], src: str, tgt: str, progress: ProgressFn) -> list[str]:
    if src not in LANGUAGES:
        raise TranslationError(f"Source language '{src}' is not supported by the translation model.")
    translator, sp = _get_nllb()
    src_code, tgt_code = LANGUAGES[src][0], LANGUAGES[tgt][0]
    out: list[str] = []
    batch = 16
    for i in range(0, len(texts), batch):
        chunk = texts[i:i + batch]
        tokens = [[src_code, *sp.encode(t, out_type=str), "</s>"] for t in chunk]
        results = translator.translate_batch(
            tokens,
            target_prefix=[[tgt_code]] * len(chunk),
            beam_size=4,
            max_decoding_length=256,
            repetition_penalty=1.1,
        )
        for res in results:
            pieces = [p for p in res.hypotheses[0] if p != tgt_code]
            out.append(tidy(sp.decode(pieces)))
        progress(min(1.0, (i + len(chunk)) / len(texts)))
    return out


def _model_translate(texts: list[str], src: str, tgt: str, progress: ProgressFn) -> tuple[list[str], str]:
    """The model that translates what the memory does not know: OPUS-MT for the pairs where it
    measured better (opus.PAIRS), NLLB for the rest and whenever OPUS-MT cannot be used."""
    done = opus.translate(texts, src, tgt, progress, tidy)
    if done is not None:
        return done, "opus-mt"
    return _nllb_translate(texts, src, tgt, progress), "nllb"


# -------------------------------------------------------------------------- entry

def translate_texts(
    texts: list[str],
    src: str,
    tgt: str,
    progress: ProgressFn,
    memory: Memory | None = None,
) -> tuple[list[str], str]:
    """Translate lines; returns (translations, engine_used).

    The memory decides first: a sentence it knows is taken from it as is, and its glossary terms
    are kept out of the model's hands (a placeholder the model copies, replaced afterwards). Only
    what the memory does not know goes to the local model.
    """
    if tgt not in LANGUAGES:
        raise TranslationError(f"Target language '{tgt}' is not supported.")
    if not texts:
        return [], "none"
    if src == tgt:
        return list(texts), "none"
    memory = memory or Memory()
    # The memory is asked with the text as recognised and as cleaned up (its rule may be either).
    cleaned = [normalize_source(t, src) for t in texts]
    out: list[str | None] = [memory.sentence(t) or memory.sentence(c) for t, c in zip(texts, cleaned)]
    texts = cleaned
    todo = [i for i, known in enumerate(out) if known is None]
    model = "nllb"
    if todo:
        # Each model has a placeholder it copies as it is (if OPUS-MT then cannot be loaded, NLLB
        # gets "XQ1" and copies it almost as well; a lost one is retried without the glossary).
        tag = opus.PLACEHOLDER if opus.available(src, tgt) else PLACEHOLDER
        protected = [memory.protect(texts[i], tag) for i in todo]
        done, model = _model_translate([p for p, _ in protected], src, tgt, progress)
        retry = []
        for i, (_, slots), result in zip(todo, protected, done):
            restored = memory.restore(result, slots, tag)
            if restored is None:  # the model lost a placeholder: translate the plain text instead
                retry.append(i)
            else:
                out[i] = restored
        if retry:
            for i, result in zip(retry, _model_translate([texts[i] for i in retry], src, tgt, lambda _f: None)[0]):
                out[i] = result
    progress(1.0)
    engine = model if len(todo) == len(texts) else "memory" if not todo else f"memory+{model}"
    return [t or "" for t in out], engine


def warm_up() -> None:
    """Load the local models now, so the first job does not wait for them."""
    _get_nllb()
    for src, tgt in opus.PAIRS:
        opus.translate(["."], src, tgt, lambda _f: None, tidy)
