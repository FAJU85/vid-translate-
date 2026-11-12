"""Subtitle translation: Gemini (optional, needs an API key) or local NLLB-200."""
from __future__ import annotations

import json
import logging
import threading
from typing import Callable

import httpx

from ...shared import config

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

            path = snapshot_download(config.NLLB_MODEL)
            device = "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"
            translator = ctranslate2.Translator(path, device=device, intra_threads=config.CPU_THREADS)
            sp = spm.SentencePieceProcessor()
            sp.load(f"{path}/sentencepiece.bpe.model")
            _nllb = (translator, sp)
        return _nllb


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
            out.append(sp.decode(pieces).strip())
        progress(min(1.0, (i + len(chunk)) / len(texts)))
    return out


# ------------------------------------------------------------------------- Gemini

_GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"


def _gemini_chunk(lines: list[str], src_name: str, tgt_name: str) -> list[str]:
    prompt = (
        f"You translate video subtitles from {src_name} into {tgt_name}.\n"
        "The input is a JSON array of consecutive subtitle lines from one video. "
        "Translate each line naturally and concisely, using the neighbouring lines for context, "
        "but keep exactly one output line per input line, in the same order. Do not merge, split, "
        "drop or explain lines.\n"
        f"Return only a JSON array of {len(lines)} strings.\n\n"
        + json.dumps(lines, ensure_ascii=False)
    )
    resp = httpx.post(
        _GEMINI_URL.format(model=config.GEMINI_MODEL),
        headers={"x-goog-api-key": config.GEMINI_API_KEY},
        json={
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.2, "responseMimeType": "application/json"},
        },
        timeout=120,
    )
    if resp.status_code != 200:
        raise TranslationError(f"Gemini returned HTTP {resp.status_code}")
    try:
        text = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
        result = json.loads(text)
    except (KeyError, IndexError, TypeError, ValueError) as exc:
        raise TranslationError("Gemini returned an unreadable response") from exc
    if not isinstance(result, list) or len(result) != len(lines) or not all(isinstance(x, str) for x in result):
        raise TranslationError("Gemini returned a different number of lines")
    return [x.strip() for x in result]


def _gemini_translate(texts: list[str], src: str, tgt: str, progress: ProgressFn) -> list[str]:
    src_name = LANGUAGES.get(src, (None, src))[1]
    tgt_name = LANGUAGES[tgt][1]
    out: list[str] = []
    size = 40
    for i in range(0, len(texts), size):
        chunk = texts[i:i + size]
        last: Exception | None = None
        for _ in range(2):
            try:
                out.extend(_gemini_chunk(chunk, src_name, tgt_name))
                last = None
                break
            except (TranslationError, httpx.HTTPError) as exc:
                last = exc
        if last is not None:
            raise TranslationError(str(last))
        progress(min(1.0, (i + len(chunk)) / len(texts)))
    return out


# -------------------------------------------------------------------------- entry

def translate_texts(texts: list[str], src: str, tgt: str, progress: ProgressFn) -> tuple[list[str], str]:
    """Translate lines; returns (translations, engine_used)."""
    if tgt not in LANGUAGES:
        raise TranslationError(f"Target language '{tgt}' is not supported.")
    if not texts:
        return [], "none"
    if src == tgt:
        return list(texts), "none"

    use_gemini = config.TRANSLATOR == "gemini" or (config.TRANSLATOR == "auto" and config.GEMINI_API_KEY)
    if use_gemini and config.GEMINI_API_KEY:
        try:
            return _gemini_translate(texts, src, tgt, progress), "gemini"
        except TranslationError as exc:
            log.warning("Gemini translation failed (%s); falling back to NLLB", exc)
    return _nllb_translate(texts, src, tgt, progress), "nllb"


def warm_up() -> None:
    """Load the local model now, unless Gemini will do all the translating."""
    if not (config.TRANSLATOR == "gemini" and config.GEMINI_API_KEY):
        _get_nllb()
