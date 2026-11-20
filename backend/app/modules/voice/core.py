"""Translated speech with edge-tts (Microsoft Edge's online "Read aloud" voices).

Free and good in Arabic, but it is not an official, documented API: it can change or stop
without notice. Dubbing can be switched off with DUBBING_ENABLED=0, and a failure here fails only
the dubbing job, with a clear message.
"""
from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Callable

# (female, male) neural voice per target language.
VOICES: dict[str, tuple[str, str]] = {
    "ar": ("ar-SA-ZariyahNeural", "ar-SA-HamedNeural"),
    "en": ("en-US-AvaNeural", "en-US-AndrewNeural"),
    "fr": ("fr-FR-DeniseNeural", "fr-FR-HenriNeural"),
    "es": ("es-ES-ElviraNeural", "es-ES-AlvaroNeural"),
    "de": ("de-DE-TanjaNeural", "de-DE-ChristophNeural"),
    "it": ("it-IT-ElsaNeural", "it-IT-DiegoNeural"),
    "pt": ("pt-BR-FranciscaNeural", "pt-BR-AntonioNeural"),
    "ru": ("ru-RU-SvetlanaNeural", "ru-RU-DmitryNeural"),
    "tr": ("tr-TR-EmelNeural", "tr-TR-AhmetNeural"),
    "fa": ("fa-IR-DilaraNeural", "fa-IR-FaridNeural"),
    "ur": ("ur-PK-UzmaNeural", "ur-PK-AsadNeural"),
    "hi": ("hi-IN-SwaraNeural", "hi-IN-MadhurNeural"),
    "bn": ("bn-BD-NabanitaNeural", "bn-BD-PradeepNeural"),
    "id": ("id-ID-GadisNeural", "id-ID-ArdiNeural"),
    "ms": ("ms-MY-YasminNeural", "ms-MY-OsmanNeural"),
    "zh": ("zh-CN-XiaoxiaoNeural", "zh-CN-YunxiNeural"),
    "ja": ("ja-JP-NanamiNeural", "ja-JP-KeitaNeural"),
    "ko": ("ko-KR-SunHiNeural", "ko-KR-InJoonNeural"),
    "nl": ("nl-NL-ColetteNeural", "nl-NL-MaartenNeural"),
    "pl": ("pl-PL-ZofiaNeural", "pl-PL-MarekNeural"),
    "uk": ("uk-UA-PolinaNeural", "uk-UA-OstapNeural"),
    "sv": ("sv-SE-SofieNeural", "sv-SE-MattiasNeural"),
    "he": ("he-IL-HilaNeural", "he-IL-AvriNeural"),
    "el": ("el-GR-AthinaNeural", "el-GR-NestorasNeural"),
    "ro": ("ro-RO-AlinaNeural", "ro-RO-EmilNeural"),
    "cs": ("cs-CZ-VlastaNeural", "cs-CZ-AntoninNeural"),
    "hu": ("hu-HU-NoemiNeural", "hu-HU-TamasNeural"),
    "fi": ("fi-FI-NooraNeural", "fi-FI-HarriNeural"),
    "da": ("da-DK-ChristelNeural", "da-DK-JeppeNeural"),
    "no": ("nb-NO-PernilleNeural", "nb-NO-FinnNeural"),
    "vi": ("vi-VN-HoaiMyNeural", "vi-VN-NamMinhNeural"),
    "th": ("th-TH-PremwadeeNeural", "th-TH-NiwatNeural"),
    "sw": ("sw-KE-ZuriNeural", "sw-KE-RafikiNeural"),
    "so": ("so-SO-UbaxNeural", "so-SO-MuuseNeural"),
    "am": ("am-ET-MekdesNeural", "am-ET-AmehaNeural"),
    "ta": ("ta-IN-PallaviNeural", "ta-IN-ValluvarNeural"),
    "az": ("az-AZ-BanuNeural", "az-AZ-BabekNeural"),
    "kk": ("kk-KZ-AigulNeural", "kk-KZ-DauletNeural"),
    "uz": ("uz-UZ-MadinaNeural", "uz-UZ-SardorNeural"),
    "ps": ("ps-AF-LatifaNeural", "ps-AF-GulNawazNeural"),
}

PARALLEL = 4
TRIES = 3
TIMEOUT = 40.0


class VoiceError(Exception):
    """Speech could not be produced (service unreachable or refused)."""


def voice_for(lang: str, gender: str = "female") -> str | None:
    pair = VOICES.get(lang)
    if not pair:
        return None
    return pair[1] if gender == "male" else pair[0]


async def _one(text: str, voice: str, dest: Path, semaphore: asyncio.Semaphore) -> None:
    import edge_tts

    async with semaphore:
        last: Exception | None = None
        for attempt in range(TRIES):
            try:
                await asyncio.wait_for(edge_tts.Communicate(text, voice).save(str(dest)), TIMEOUT)
                if dest.exists() and dest.stat().st_size > 0:
                    return
                last = VoiceError("empty audio")
            except Exception as exc:  # noqa: BLE001 - network and service errors are retried
                last = exc
            await asyncio.sleep(1.5 * (attempt + 1))
        raise VoiceError(f"{last.__class__.__name__}: {last}"[:200] if last else "no audio")


def synthesize(
    texts: list[str],
    lang: str,
    gender: str,
    out_dir: Path,
    cancelled: Callable[[], bool],
    progress: Callable[[float], None],
) -> list[Path | None]:
    """One MP3 per text (None for an empty text), spoken in `lang`."""
    voice = voice_for(lang, gender)
    if not voice:
        raise VoiceError(f"No voice for language '{lang}'.")
    out_dir.mkdir(parents=True, exist_ok=True)
    paths: list[Path | None] = [out_dir / f"line{i:05d}.mp3" if t.strip() else None for i, t in enumerate(texts)]
    todo = [(t, p) for t, p in zip(texts, paths) if p is not None]

    async def run() -> None:
        semaphore = asyncio.Semaphore(PARALLEL)
        done = 0
        tasks = [asyncio.create_task(_one(t, voice, p, semaphore)) for t, p in todo]
        try:
            for finished in asyncio.as_completed(tasks):
                await finished
                done += 1
                progress(done / max(1, len(tasks)))
                if cancelled():
                    raise asyncio.CancelledError
        finally:
            for task in tasks:
                task.cancel()

    try:
        asyncio.run(run())
    except asyncio.CancelledError:
        from ...shared.errors import Cancelled

        raise Cancelled() from None
    return paths
