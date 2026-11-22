"""The translation pipeline: snaps the media, speech, translation and subtitles bricks together."""
from __future__ import annotations

import json
import logging
import shutil
from pathlib import Path
from typing import Callable

from .. import media, speech, subtitles, translation, voice
from ...shared import config, security
from ...shared.errors import Cancelled, PipelineError
from .model import KEPT_SOURCE, OUTPUT_FILES, OUTRO_UPLOAD, STAGE_SPAN, UPLOAD_NAME, Job

log = logging.getLogger("tarjim.jobs")

# Styled subtitles for the burn-in; a working file, removed with the other inputs.
BURN_FILE = "burn.ass"
# The KAVOX ending every rendered video gets, unless a subscriber chose their own or none.
KAVOX_OUTRO = Path(__file__).resolve().parents[2] / "assets" / "outro.mp4"

Notify = Callable[[Job, bool], None]  # (job, force)


def run(job: Job, workdir: Path, notify: Notify) -> None:
    """Process one job in ``workdir``, updating ``job`` and calling ``notify`` as it goes."""
    spans = STAGE_SPAN["rerender" if job.source_kind == "rerender" else job.mode]
    cancelled = lambda: job.cancel_requested  # noqa: E731

    def enter(stage: str) -> None:
        if job.cancel_requested:
            raise Cancelled()
        job.status, job.stage, job.progress = "running", stage, spans[stage][0]
        notify(job, True)

    def reporter(stage: str):
        lo, hi = spans[stage]

        def report(fraction: float) -> None:
            if job.cancel_requested:
                raise Cancelled()
            value = int(lo + (hi - lo) * max(0.0, min(1.0, fraction)))
            if value > job.progress:
                job.progress = value
                notify(job, False)

        return report

    if job.source_kind == "rerender":
        _rerender(job, workdir, enter, reporter, cancelled)
        return

    # 1. Fetch the media -----------------------------------------------------
    enter("downloading")
    want_video = job.mode in ("hard", "dub")
    if job.source_kind == "upload":
        source = workdir / UPLOAD_NAME
        if not source.exists():
            raise PipelineError("E_UPLOAD_MISSING", "The uploaded file was not received.")
    elif job.source_kind == "direct":
        source = media.download_direct(job.source_url or "", workdir / "source.bin", cancelled, reporter("downloading"))
    else:
        try:
            security.assert_public_url(job.source_url or "")
        except security.UnsafeUrl as exc:
            raise PipelineError("E_URL_INVALID", str(exc)) from exc
        source, meta = media.download_url(job.source_url or "", workdir, want_video, cancelled, reporter("downloading"))
        job.title = job.title or meta.get("title")

    info = media.probe(source)
    if not info["has_audio"]:
        raise PipelineError("E_MEDIA_INVALID", "The file has no audio track to transcribe.")
    job.duration = info["duration"]
    if info["duration"] > config.MAX_DURATION_SEC:
        raise PipelineError(
            "E_VIDEO_TOO_LONG",
            f"Video is {int(info['duration'] // 60)} min long; the limit is {config.MAX_DURATION_SEC // 60} min.",
        )

    # 2. Speech recognition ----------------------------------------------------
    enter("transcribing")
    audio = workdir / "audio.wav"
    media.extract_audio(source, audio, info["duration"], cancelled, lambda _f: None)
    try:
        segments, detected = speech.transcribe(
            audio,
            None if job.src_lang in ("", "auto") else job.src_lang,
            info["duration"],
            cancelled,
            reporter("transcribing"),
        )
    except (Cancelled, PipelineError):
        raise
    except Exception as exc:  # noqa: BLE001
        log.exception("ASR failed for %s", job.id)
        raise PipelineError("E_ASR_FAILED", f"Speech recognition failed: {exc.__class__.__name__}") from exc
    audio.unlink(missing_ok=True)
    job.detected_lang = detected
    # Whole sentences (from word timestamps) translate better than Whisper's audio chunks.
    segments = subtitles.sentence_segments(subtitles.clean_segments(segments))
    if not segments:
        raise PipelineError("E_NO_SPEECH", "No speech was detected in this video.")

    # 3. Translation -------------------------------------------------------------
    enter("translating")
    # A dub is spoken over the original timing: the translator is told how long each line may last.
    seconds = _speaking_time(segments, info["duration"]) if job.mode == "dub" else None
    try:
        translations, job.engine = translation.translate_texts(
            [seg[2] for seg in segments], detected, job.tgt_lang, reporter("translating"), job.title, seconds
        )
    except translation.TranslationError as exc:
        raise PipelineError("E_NMT_FAILED", str(exc)) from exc
    cues = subtitles.build_cues(segments, translations)

    outputs = write_subtitle_files(workdir, cues, detected, job.tgt_lang)

    # 4. Burn-in (hard mode, only when there is a picture to burn into) ------------
    if job.mode == "hard" and info["has_video"]:
        enter("rendering")
        style = subtitles.SubtitleStyle.from_dict(job.style)
        (workdir / BURN_FILE).write_text(subtitles.to_ass(cues, job.tgt_lang, style, detected), encoding="utf-8")
        media.burn_subtitles(
            source, BURN_FILE, workdir / OUTPUT_FILES["mp4"],
            info["duration"], cancelled, lambda f: reporter("rendering")(f * 0.95),
        )
        _add_outro(job, workdir, workdir / OUTPUT_FILES["mp4"], cancelled, lambda f: reporter("rendering")(0.95 + f * 0.05), True)
        outputs["mp4"] = OUTPUT_FILES["mp4"]
        _add_thumbnail(workdir, workdir / OUTPUT_FILES["mp4"], info["duration"], outputs)
        source.replace(workdir / KEPT_SOURCE)  # kept for "render again with my edits"

    # 5. Dubbing: the translation spoken over the original sound ---------------------
    if job.mode == "dub":
        enter("dubbing")
        # Whole sentences are spoken (not subtitle pieces): the voice keeps a natural intonation.
        spoken = [(seg[0], seg[1], subtitles.clean_text(tr) or seg[2]) for seg, tr in zip(segments, translations)]
        outputs["dubbed"] = _dub(job, workdir, source, spoken, info, reporter("dubbing"), cancelled)
        if info["has_video"]:
            _add_thumbnail(workdir, workdir / OUTPUT_FILES["dubbed"], info["duration"], outputs)

    job.outputs = outputs


def write_subtitle_files(workdir: Path, cues: list, src_lang: str, tgt_lang: str) -> dict[str, str]:
    """Every subtitle file a job offers; returns {output key: file name}."""
    files = {
        "srt": subtitles.to_srt(cues),
        "vtt": subtitles.to_vtt(cues),
        "original_srt": subtitles.to_srt(cues, use_translation=False),
        "bilingual_srt": subtitles.to_bilingual_srt(cues),
        "transcript": subtitles.to_transcript(cues, src_lang, tgt_lang),
        "cues": json.dumps({"src_lang": src_lang, "tgt_lang": tgt_lang, "cues": [c.to_json() for c in cues]}, ensure_ascii=False),
    }
    for key, text in files.items():
        (workdir / OUTPUT_FILES[key]).write_text(text, encoding="utf-8")
    return {key: OUTPUT_FILES[key] for key in files}


def _rerender(job: Job, workdir: Path, enter, reporter, cancelled) -> None:
    """Burn edited subtitles into the video kept from an earlier job: no download, ASR or translation."""
    enter("rendering")
    source = workdir / KEPT_SOURCE
    if not source.exists():
        raise PipelineError("E_UPLOAD_MISSING", "The original video is no longer kept. Translate it again.")
    info = media.probe(source)
    job.duration = info["duration"]
    cues = [
        subtitles.Cue(i + 1, float(c["start"]), float(c["end"]), subtitles.clean_text(str(c.get("text", ""))),
                      subtitles.clean_text(str(c.get("translation", ""))))
        for i, c in enumerate(job.cues or [])
    ]
    cues = [c for c in cues if c.end > c.start and (c.text or c.translation)]
    if not cues:
        raise PipelineError("E_NO_SPEECH", "There are no subtitles to render.")
    src_lang = job.src_lang if job.src_lang not in ("", "auto") else ""
    job.detected_lang = src_lang or None
    outputs = write_subtitle_files(workdir, cues, src_lang or "auto", job.tgt_lang)
    style = subtitles.SubtitleStyle.from_dict(job.style)
    (workdir / BURN_FILE).write_text(subtitles.to_ass(cues, job.tgt_lang, style, src_lang), encoding="utf-8")
    media.burn_subtitles(source, BURN_FILE, workdir / OUTPUT_FILES["mp4"], info["duration"], cancelled,
                         lambda f: reporter("rendering")(f * 0.95))
    _add_outro(job, workdir, workdir / OUTPUT_FILES["mp4"], cancelled, lambda f: reporter("rendering")(0.95 + f * 0.05), True)
    outputs["mp4"] = OUTPUT_FILES["mp4"]
    _add_thumbnail(workdir, workdir / OUTPUT_FILES["mp4"], info["duration"], outputs)
    job.outputs = outputs


def _add_thumbnail(workdir: Path, video: Path, duration: float, outputs: dict) -> None:
    """A still for the share page; a video without one is still delivered."""
    if media.thumbnail(video, workdir / OUTPUT_FILES["thumb"], duration):
        outputs["thumb"] = OUTPUT_FILES["thumb"]


def _add_outro(job: Job, workdir: Path, video: Path, cancelled, report, encoded_here: bool) -> None:
    """End the video with the chosen clip. A subscriber's own clip that cannot be used falls back to
    the KAVOX one; a failing ending never fails the translation (the video is kept without it)."""
    if job.outro == "none":
        return
    custom = workdir / OUTRO_UPLOAD
    choices = ([custom] if job.outro == "custom" and custom.is_file() else []) + [KAVOX_OUTRO]
    for clip in choices:
        try:
            media.append_outro(video, clip, cancelled, report, encoded_here)
            return
        except PipelineError as exc:
            log.warning("job %s: ending %s not added: %s", job.id, clip.name, exc)


# A dubbed line may run into the pause before the next sentence, but never into it.
DUB_GAP = 0.08
# The voice speaks at most this much faster than normal (percent); past that, the track speeds it up.
DUB_MAX_RATE = 35


def _speaking_time(segments: list, duration: float) -> list[float]:
    """How long each sentence may be spoken: until the next one starts."""
    out = []
    for i, seg in enumerate(segments):
        nxt = segments[i + 1][0] if i + 1 < len(segments) else max(duration, seg[1])
        out.append(max(0.4, nxt - seg[0] - DUB_GAP))
    return out


def _dub(job: Job, workdir: Path, source: Path, spoken: list, info: dict, report, cancelled) -> str:
    """Speak every sentence in the target language and mix it over the quietened original sound.

    spoken: (start, end, text) per sentence. A line longer than its time is spoken again, faster,
    by the voice itself; only what still does not fit is sped up (and at worst cut) in the track.
    """
    if not config.DUBBING_ENABLED:
        raise PipelineError("E_NO_VOICE", "Dubbing is switched off on this server.")
    style = subtitles.SubtitleStyle.from_dict(job.style)
    if not voice.voice_for(job.tgt_lang, style.voice):
        raise PipelineError("E_NO_VOICE", "Dubbing is not available for this language yet. Choose subtitles instead.")
    lines_dir = workdir / "voice"
    track = workdir / "dub.wav"
    try:  # the spoken lines and the track are only steps: removed however the job ends
        try:
            texts = [text for _s, _e, text in spoken]
            clips = voice.synthesize(texts, job.tgt_lang, style.voice, lines_dir, cancelled, lambda f: report(f * 0.6))
            # Each sentence may last until the next one starts.
            slots = _speaking_time(spoken, info["duration"])
            rates = []
            for clip, slot in zip(clips, slots, strict=True):
                length = media.probe(clip)["duration"] if clip else 0
                over = length / slot if slot else 1
                rates.append(min(DUB_MAX_RATE, int((over - 1) * 100) + 5) if over > 1.03 else 0)
            if any(rates):
                faster = voice.synthesize(
                    [t if r else "" for t, r in zip(texts, rates)], job.tgt_lang, style.voice, workdir / "voice-fast",
                    cancelled, lambda f: report(0.6 + f * 0.2), rates,
                )
                clips = [f or c for f, c in zip(faster, clips)]
        except voice.VoiceError as exc:
            raise PipelineError("E_TTS_FAILED", f"The voice service did not answer ({exc}). Try again later.") from exc
        lines = [(s, s + slot, clip) for (s, _e, _t), slot, clip in zip(spoken, slots, clips) if clip is not None]
        media.build_dub_track(lines, info["duration"], track)
        media.mix_dub(source, track, workdir / OUTPUT_FILES["dubbed"], info["duration"], info["has_video"],
                      cancelled, lambda f: report(0.8 + f * 0.15))
        _add_outro(job, workdir, workdir / OUTPUT_FILES["dubbed"], cancelled, lambda f: report(0.95 + f * 0.05), False)
    finally:
        shutil.rmtree(lines_dir, ignore_errors=True)
        shutil.rmtree(workdir / "voice-fast", ignore_errors=True)
        track.unlink(missing_ok=True)
    return OUTPUT_FILES["dubbed"]
