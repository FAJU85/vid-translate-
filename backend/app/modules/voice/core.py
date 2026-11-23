"""Translated speech: Microsoft Edge's online "Read aloud" voices (edge-tts), or eSpeak NG, a
rule-based (formant) synthesizer with no AI that runs on this machine ("classic" voice).

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

# eSpeak NG voices (rule-based, offline). Somali, Hausa and Pashto have none.
ESPEAK: dict[str, str] = {
    "ar": "ar", "en": "en-us", "fr": "fr-fr", "es": "es", "de": "de", "it": "it", "pt": "pt-br", "ru": "ru",
    "tr": "tr", "fa": "fa", "ur": "ur", "hi": "hi", "bn": "bn", "id": "id", "ms": "ms", "zh": "cmn", "ja": "ja",
    "ko": "ko", "nl": "nl", "pl": "pl", "uk": "uk", "sv": "sv", "he": "he", "el": "el", "ro": "ro", "cs": "cs",
    "hu": "hu", "fi": "fi", "da": "da", "no": "nb", "vi": "vi", "th": "th", "sw": "sw", "ku": "ku", "am": "am",
    "ta": "ta", "az": "az", "kk": "kk", "uz": "uz",
}
ESPEAK_WPM = 165  # words per minute at the normal rate (eSpeak's own default is 175)
CLASSIC = "classic"

PARALLEL = 4
TRIES = 3
TIMEOUT = 40.0


class VoiceError(Exception):
    """Speech could not be produced (service unreachable or refused)."""


def voice_for(lang: str, gender: str = "female") -> str | None:
    if gender == CLASSIC:
        return f"espeak:{ESPEAK[lang]}" if lang in ESPEAK else None
    pair = VOICES.get(lang)
    if not pair:
        return None
    return pair[1] if gender == "male" else pair[0]


async def _espeak(text: str, voice: str, dest: Path, rate: int) -> None:
    """One line with eSpeak NG, as a WAV file (the speed is set in words per minute)."""
    speed = max(80, round(ESPEAK_WPM * (1 + rate / 100)))
    proc = await asyncio.create_subprocess_exec(
        "espeak-ng", "-v", voice, "-s", str(speed), "-w", str(dest), "--", text,
        stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE,
    )
    try:
        _, err = await asyncio.wait_for(proc.communicate(), TIMEOUT)
    except asyncio.TimeoutError:
        proc.kill()
        raise VoiceError("eSpeak NG took too long") from None
    if proc.returncode != 0 or not dest.exists() or dest.stat().st_size == 0:
        raise VoiceError(f"eSpeak NG failed: {err.decode(errors='replace')[:150]}")


async def _one(text: str, voice: str, dest: Path, semaphore: asyncio.Semaphore, rate: int = 0) -> None:
    if voice.startswith("espeak:"):
        async with semaphore:
            await _espeak(text, voice.split(":", 1)[1], dest, rate)
        return
    import edge_tts

    async with semaphore:
        last: Exception | None = None
        for attempt in range(TRIES):
            try:
                await asyncio.wait_for(edge_tts.Communicate(text, voice, rate=f"{rate:+d}%").save(str(dest)), TIMEOUT)
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
    rates: list[int] | None = None,
) -> list[Path | None]:
    """One MP3 per text (None for an empty text), spoken in `lang`.

    rates: speaking speed per text, in percent faster than normal (0 = normal). The voice itself
    speaks faster, which sounds far better than speeding the sound up afterwards.
    """
    voice = voice_for(lang, gender)
    if not voice:
        raise VoiceError(f"No voice for language '{lang}'.")
    out_dir.mkdir(parents=True, exist_ok=True)
    ext = "wav" if voice.startswith("espeak:") else "mp3"
    paths: list[Path | None] = [out_dir / f"line{i:05d}.{ext}" if t.strip() else None for i, t in enumerate(texts)]
    speeds = rates or [0] * len(texts)
    todo = [(t, p, r) for t, p, r in zip(texts, paths, speeds) if p is not None]

    async def run() -> None:
        semaphore = asyncio.Semaphore(PARALLEL)
        done = 0
        tasks = [asyncio.create_task(_one(t, voice, p, semaphore, r)) for t, p, r in todo]
        try:
            pending = set(tasks)
            while pending:  # wake every half second so a cancel is noticed even while the service is slow
                finished, pending = await asyncio.wait(pending, timeout=0.5, return_when=asyncio.FIRST_COMPLETED)
                for task in finished:
                    task.result()  # raises the line's VoiceError
                done += len(finished)
                if finished:
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
