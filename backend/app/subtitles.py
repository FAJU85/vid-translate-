"""Cue shaping and SRT / WebVTT serialisation."""
from __future__ import annotations

import re
from dataclasses import dataclass, asdict

MAX_CUE_CHARS = 84      # two lines of ~42 characters
MAX_CUE_SECONDS = 7.0
MIN_CUE_SECONDS = 0.6


@dataclass
class Cue:
    index: int
    start: float
    end: float
    text: str
    translation: str = ""

    def to_json(self) -> dict:
        d = asdict(self)
        d["start"] = round(self.start, 3)
        d["end"] = round(self.end, 3)
        return d


def _timestamp(seconds: float, sep: str) -> str:
    ms = max(0, int(round(seconds * 1000)))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d}{sep}{ms:03d}"


def _split_text(text: str, parts: int) -> list[str]:
    """Split text into `parts` chunks of similar length, preferring punctuation."""
    words = text.split()
    if parts <= 1 or len(words) < parts:
        return [text]
    target = len(text) / parts
    chunks: list[str] = []
    current: list[str] = []
    length = 0
    for i, word in enumerate(words):
        current.append(word)
        length += len(word) + 1
        remaining_words = len(words) - i - 1
        remaining_chunks = parts - len(chunks) - 1
        if remaining_chunks == 0:
            continue
        at_break = re.search(r"[.,;:!?،؛؟。，]$", word) is not None
        if (length >= target or (at_break and length >= target * 0.6)) and remaining_words >= remaining_chunks:
            chunks.append(" ".join(current))
            current, length = [], 0
    if current:
        chunks.append(" ".join(current))
    return chunks


def clean_segments(segments: list[tuple[float, float, str]]) -> list[tuple[float, float, str]]:
    """Normalise whitespace and drop empty ASR segments."""
    out = []
    for start, end, raw in segments:
        text = " ".join(raw.split())
        if text:
            out.append((start, max(end, start + MIN_CUE_SECONDS), text))
    return out


def build_cues(segments: list[tuple[float, float, str]], translations: list[str]) -> list[Cue]:
    """Pair segments with their translations and split over-long ones into readable cues.

    Segments are translated whole (better context for the translator) and only split
    afterwards, with the time divided in proportion to the text.
    """
    cues: list[Cue] = []
    for (start, end, text), translated in zip(segments, translations):
        translated = " ".join((translated or text).split())
        duration = end - start
        parts = max(
            1,
            -(-len(translated) // MAX_CUE_CHARS),      # ceil by characters
            int(-(-duration // MAX_CUE_SECONDS)),      # ceil by duration
        )
        src_pieces, tgt_pieces = _split_text(text, parts), _split_text(translated, parts)
        if len(src_pieces) != len(tgt_pieces):
            n = min(len(src_pieces), len(tgt_pieces))
            src_pieces, tgt_pieces = _split_text(text, n), _split_text(translated, n)
            if len(src_pieces) != len(tgt_pieces):
                src_pieces, tgt_pieces = [text], [translated]
        total = sum(len(p) for p in tgt_pieces) or 1
        cursor = start
        for src, tgt in zip(src_pieces, tgt_pieces):
            piece_end = cursor + duration * (len(tgt) / total)
            cues.append(Cue(len(cues) + 1, cursor, piece_end, src, tgt))
            cursor = piece_end
    return cues


def _wrap(text: str, width: int = 42) -> str:
    """Wrap to at most two balanced lines."""
    text = " ".join(text.split())
    if len(text) <= width:
        return text
    words = text.split()
    best, best_diff = None, None
    for i in range(1, len(words)):
        a, b = " ".join(words[:i]), " ".join(words[i:])
        diff = abs(len(a) - len(b))
        if best_diff is None or diff < best_diff:
            best, best_diff = f"{a}\n{b}", diff
    return best or text


def to_srt(cues: list[Cue], use_translation: bool = True) -> str:
    blocks = []
    for n, cue in enumerate(cues, 1):
        text = (cue.translation if use_translation else cue.text) or cue.text
        blocks.append(f"{n}\n{_timestamp(cue.start, ',')} --> {_timestamp(cue.end, ',')}\n{_wrap(text)}\n")
    return "\n".join(blocks)


def to_vtt(cues: list[Cue], use_translation: bool = True) -> str:
    blocks = ["WEBVTT\n"]
    for n, cue in enumerate(cues, 1):
        text = (cue.translation if use_translation else cue.text) or cue.text
        blocks.append(f"{n}\n{_timestamp(cue.start, '.')} --> {_timestamp(cue.end, '.')}\n{_wrap(text)}\n")
    return "\n".join(blocks)
