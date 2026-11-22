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


# Words a voice says per second, roughly (used to tell the translator how long a dubbed line may be).
_WORDS_PER_SECOND = 2.6


def _gemini_prompt(
    lines: list[str],
    src_name: str,
    tgt_name: str,
    title: str | None = None,
    before: list[tuple[str, str]] | None = None,
    seconds: list[float] | None = None,
) -> str:
    """The instructions for one chunk: the lines, what came just before, and (dubbing) their time."""
    rules = [
        f"You translate the speech of a video from {src_name} into {tgt_name}.",
        "The input is a JSON array of consecutive sentences from the video's transcript, made by speech "
        "recognition: it can contain small recognition mistakes; translate what the speaker most likely said.",
        "Translate each line faithfully and naturally, as a native speaker would say it, using the neighbouring "
        "lines for context. Keep names, brands, numbers and units exactly; keep the same word for the same thing "
        "across the whole video.",
        "Keep exactly one output line per input line, in the same order. Do not merge, split, drop or explain lines.",
    ]
    if tgt_name == "Arabic":
        rules.append("Write clear Modern Standard Arabic, without diacritics except where needed to avoid ambiguity.")
    if title:
        rules.append(f"The video is titled: {json.dumps(title, ensure_ascii=False)}.")
    if seconds:
        limits = [max(1, round(s * _WORDS_PER_SECOND)) for s in seconds]
        rules.append(
            "The translation will be spoken aloud as a dub, over the original timing. Each line must be sayable in "
            "its time: keep it at most about the given number of words, shortening wording (never meaning) when "
            "needed. Word limits, one per line: " + json.dumps(limits)
        )
    if before:
        rules.append(
            "For context only (already translated, do not output them), the lines just before were: "
            + json.dumps([{"source": s, "translation": t} for s, t in before], ensure_ascii=False)
        )
    rules.append(f"Return only a JSON array of {len(lines)} strings.")
    return "\n".join(rules) + "\n\n" + json.dumps(lines, ensure_ascii=False)


def _gemini_chunk(lines: list[str], src_name: str, tgt_name: str, **context) -> list[str]:
    prompt = _gemini_prompt(lines, src_name, tgt_name, **context)
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


def _gemini_translate(
    texts: list[str], src: str, tgt: str, progress: ProgressFn, title: str | None = None, seconds: list[float] | None = None
) -> list[str]:
    src_name = LANGUAGES.get(src, (None, src))[1]
    tgt_name = LANGUAGES[tgt][1]
    out: list[str] = []
    size = 40
    for i in range(0, len(texts), size):
        chunk = texts[i:i + size]
        context = {
            "title": title,
            # The last lines of the previous chunk, so a chunk does not start without context.
            "before": list(zip(texts[max(0, i - 4):i], out[max(0, i - 4):i])) or None,
            "seconds": seconds[i:i + size] if seconds else None,
        }
        last: Exception | None = None
        for _ in range(2):
            try:
                out.extend(_gemini_chunk(chunk, src_name, tgt_name, **context))
                last = None
                break
            except (TranslationError, httpx.HTTPError) as exc:
                last = exc
        if last is not None:
            raise TranslationError(str(last))
        progress(min(1.0, (i + len(chunk)) / len(texts)))
    return out


# -------------------------------------------------------------------------- entry

def translate_texts(
    texts: list[str],
    src: str,
    tgt: str,
    progress: ProgressFn,
    title: str | None = None,
    seconds: list[float] | None = None,
) -> tuple[list[str], str]:
    """Translate lines; returns (translations, engine_used).

    title: the video's title (context). seconds: for a dub, how long each line may last when spoken
    (the translator keeps lines sayable in that time; the local model cannot, the voice speeds up).
    """
    if tgt not in LANGUAGES:
        raise TranslationError(f"Target language '{tgt}' is not supported.")
    if not texts:
        return [], "none"
    if src == tgt:
        return list(texts), "none"

    use_gemini = config.TRANSLATOR == "gemini" or (config.TRANSLATOR == "auto" and config.GEMINI_API_KEY)
    if use_gemini and config.GEMINI_API_KEY:
        try:
            return _gemini_translate(texts, src, tgt, progress, title, seconds), "gemini"
        except TranslationError as exc:
            log.warning("Gemini translation failed (%s); falling back to NLLB", exc)
    return _nllb_translate(texts, src, tgt, progress), "nllb"


def warm_up() -> None:
    """Load the local model now, unless Gemini will do all the translating."""
    if not (config.TRANSLATOR == "gemini" and config.GEMINI_API_KEY):
        _get_nllb()
