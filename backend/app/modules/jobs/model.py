"""The job record and the constants that describe a job's files and stages."""
from __future__ import annotations

import time
from dataclasses import dataclass, field

OUTPUT_FILES = {
    "srt": "subtitles.srt",
    "vtt": "subtitles.vtt",
    "original_srt": "original.srt",
    "cues": "cues.json",
    "mp4": "video.mp4",
}
UPLOAD_NAME = "upload.bin"
TERMINAL = {"done", "failed", "cancelled"}

# (start %, end %) of overall progress for each stage, per subtitle mode.
STAGE_SPAN = {
    "soft": {"downloading": (2, 15), "transcribing": (15, 80), "translating": (80, 99)},
    "hard": {"downloading": (2, 12), "transcribing": (12, 60), "translating": (60, 72), "rendering": (72, 99)},
}


@dataclass
class Job:
    id: str
    source_kind: str            # "url" | "direct" | "upload"
    source_url: str | None
    src_lang: str               # ISO code or "auto"
    tgt_lang: str
    mode: str                   # "soft" | "hard"
    callback_url: str | None
    status: str = "queued"
    stage: str = "queued"
    progress: int = 0
    title: str | None = None
    duration: float | None = None
    detected_lang: str | None = None
    engine: str | None = None
    error_code: str | None = None
    error_message: str | None = None
    outputs: dict[str, str] = field(default_factory=dict)
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    cancel_requested: bool = False
    _last_callback: float = 0.0

    def public(self) -> dict:
        return {
            "job_id": self.id,
            "status": self.status,
            "stage": self.stage,
            "progress": self.progress,
            "title": self.title,
            "duration": self.duration,
            "detected_lang": self.detected_lang,
            "engine": self.engine,
            "outputs": self.outputs,
            "error": {"code": self.error_code, "message": self.error_message} if self.error_code else None,
        }
