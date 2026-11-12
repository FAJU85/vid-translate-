"""The translation pipeline: snaps the media, speech, translation and subtitles bricks together."""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Callable

from .. import media, speech, subtitles, translation
from ...shared import config, security
from ...shared.errors import Cancelled, PipelineError
from .model import OUTPUT_FILES, STAGE_SPAN, UPLOAD_NAME, Job

log = logging.getLogger("tarjim.jobs")

Notify = Callable[[Job, bool], None]  # (job, force)


def run(job: Job, workdir: Path, notify: Notify) -> None:
    """Process one job in ``workdir``, updating ``job`` and calling ``notify`` as it goes."""
    spans = STAGE_SPAN[job.mode]
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
    segments = subtitles.clean_segments(segments)
    if not segments:
        raise PipelineError("E_NO_SPEECH", "No speech was detected in this video.")

    # 3. Translation -------------------------------------------------------------
    enter("translating")
    try:
        translations, job.engine = translation.translate_texts(
            [text for _, _, text in segments], detected, job.tgt_lang, reporter("translating")
        )
    except translation.TranslationError as exc:
        raise PipelineError("E_NMT_FAILED", str(exc)) from exc
    cues = subtitles.build_cues(segments, translations)

    (workdir / OUTPUT_FILES["srt"]).write_text(subtitles.to_srt(cues), encoding="utf-8")
    (workdir / OUTPUT_FILES["vtt"]).write_text(subtitles.to_vtt(cues), encoding="utf-8")
    (workdir / OUTPUT_FILES["original_srt"]).write_text(subtitles.to_srt(cues, use_translation=False), encoding="utf-8")
    (workdir / OUTPUT_FILES["cues"]).write_text(
        json.dumps(
            {"src_lang": detected, "tgt_lang": job.tgt_lang, "cues": [c.to_json() for c in cues]},
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    outputs = {k: OUTPUT_FILES[k] for k in ("srt", "vtt", "original_srt", "cues")}

    # 4. Burn-in (hard mode, only when there is a picture to burn into) ------------
    if job.mode == "hard" and info["has_video"]:
        enter("rendering")
        media.burn_subtitles(
            source, OUTPUT_FILES["srt"], workdir / OUTPUT_FILES["mp4"], job.tgt_lang,
            info["duration"], cancelled, reporter("rendering"),
        )
        outputs["mp4"] = OUTPUT_FILES["mp4"]

    job.outputs = outputs
