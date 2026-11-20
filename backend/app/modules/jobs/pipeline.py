"""The translation pipeline: snaps the media, speech, translation and subtitles bricks together."""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Callable

from .. import media, speech, subtitles, translation
from ...shared import config, security
from ...shared.errors import Cancelled, PipelineError
from .model import KEPT_SOURCE, OUTPUT_FILES, STAGE_SPAN, UPLOAD_NAME, Job

log = logging.getLogger("tarjim.jobs")

# Styled subtitles for the burn-in; a working file, removed with the other inputs.
BURN_FILE = "burn.ass"

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
    want_video = job.mode == "hard"
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
    try:
        translations, job.engine = translation.translate_texts(
            [seg[2] for seg in segments], detected, job.tgt_lang, reporter("translating")
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
            info["duration"], cancelled, reporter("rendering"),
        )
        outputs["mp4"] = OUTPUT_FILES["mp4"]
        source.replace(workdir / KEPT_SOURCE)  # kept for "render again with my edits"

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
    media.burn_subtitles(source, BURN_FILE, workdir / OUTPUT_FILES["mp4"], info["duration"], cancelled, reporter("rendering"))
    outputs["mp4"] = OUTPUT_FILES["mp4"]
    job.outputs = outputs
