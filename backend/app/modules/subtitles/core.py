"""Cue shaping and SRT / WebVTT serialisation."""
from __future__ import annotations

import re
from dataclasses import dataclass, asdict

from . import sentences

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


# Characters that only ever show up as garbage: the replacement character, C0/C1 controls,
# line/paragraph separators, and the translator's unknown-token marker.
_GARBAGE = re.compile(r"[�\x00-\x08\x0b-\x1f\x7f-\x9f  ]|<unk>")


def clean_text(text: str) -> str:
    """Remove characters that render as squares or question marks, and normalise spaces."""
    return " ".join(_GARBAGE.sub(" ", text or "").split())


def clean_segments(segments: list[tuple]) -> list[tuple]:
    """Normalise whitespace and drop empty ASR segments.

    A segment is (start, end, text) or, with word timestamps, (start, end, text, words) where
    words are (start, end, text); unreadable characters are removed from the words too.
    """
    out = []
    for seg in segments:
        start, end, raw = seg[:3]
        text = clean_text(raw)
        if not text:
            continue
        if len(seg) > 3 and seg[3]:
            words = [(ws, we, _GARBAGE.sub("", wt)) for ws, we, wt in seg[3]]
            out.append((start, max(end, start + MIN_CUE_SECONDS), text, [w for w in words if w[2].strip()]))
        else:
            out.append((start, max(end, start + MIN_CUE_SECONDS), text))
    return out


def sentence_segments(segments: list[tuple]) -> list[tuple]:
    """Regroup ASR segments into whole sentences (when they carry word timestamps)."""
    return [
        (s.start, s.end, s.text, s.words) if s.words else (s.start, s.end, s.text)
        for s in sentences.sentences_from_segments(segments)
    ]


def _word_cues(words: list, translated: str, depth: int = 0) -> list[tuple[float, float, str, str]]:
    """Subtitles for one sentence, timed from its words.

    A part that is still longer than two lines after the split (a natural cut at a comma can
    leave one side long) is split again.
    """
    groups = sentences.split_words_for_cues(words, translated)
    pieces = sentences.split_text_like(translated, groups)
    if len(pieces) != len(groups):  # the translation cannot be cut that many times
        groups, pieces = [words], [translated]
    out: list[tuple[float, float, str, str]] = []
    for group, piece in zip(groups, pieces):
        if len(piece) > MAX_CUE_CHARS and len(group) > 1 and len(piece.split()) > 1 and depth < 4:
            out.extend(_word_cues(group, piece, depth + 1))
        else:
            out.append((group[0][0], group[-1][1], sentences._join(group), piece))
    return out


def build_cues(segments: list[tuple], translations: list[str]) -> list[Cue]:
    """Pair segments with their translations and split over-long ones into readable cues.

    Segments are translated whole (better context for the translator) and only split
    afterwards. With word timestamps the split follows the words (pauses, commas) and each
    subtitle is timed from its own words; without them the time is divided by text length.
    """
    cues: list[Cue] = []
    timed: list[int] = []  # indexes of cues timed from words
    for seg, translated in zip(segments, translations):
        start, end, text = seg[:3]
        translated = clean_text(translated) or text
        if len(seg) > 3 and seg[3]:
            for s, e, src, tgt in _word_cues(seg[3], translated):
                timed.append(len(cues))
                cues.append(Cue(len(cues) + 1, s, e, src, tgt))
            continue
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
    if timed:
        times = [[c.start, c.end] for c in cues]
        sentences.settle_timing(times, [c.translation for c in cues])
        for i in timed:
            cues[i].end = times[i][1]
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
