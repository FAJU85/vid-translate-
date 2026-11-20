"""Sentence-aware subtitles from word timestamps.

Whisper's segments are chunks of audio, not sentences: a sentence often starts at the end of one
segment and finishes in the next. With word timestamps we can:

1. join the words into whole sentences (ending at . ! ? and their Arabic / CJK forms, at a long
   pause, or at a length cap), so each sentence is translated with its full context;
2. split each sentence into subtitles at the most natural points (commas, pauses), sized for
   reading: at most two lines of 42 characters and 7 seconds;
3. time each subtitle from the words actually spoken in it, keep it on screen long enough to read
   (about 17 characters per second, the common broadcast standard) without overlapping the next.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

Word = tuple[float, float, str]  # (start, end, text with Whisper's leading space)

SENTENCE_END = re.compile(r"[.!?…؟。！？]['\"’”»)\]]*$")
CLAUSE_END = re.compile(r"[,;:،؛，、；：—–]['\"’”»)\]]*$")
SENTENCE_PAUSE = 0.8  # seconds of silence that end a sentence
MAX_SENTENCE_SECONDS = 15.0  # longer "sentences" (no punctuation) are cut at the best clause point
MAX_SENTENCE_CHARS = 220

MAX_CUE_CHARS = 84  # two lines of ~42 characters
MAX_CUE_SECONDS = 7.0
MIN_CUE_SECONDS = 1.0
READING_CPS = 17.0  # characters per second a viewer can comfortably read
CUE_GAP = 0.08  # seconds kept between two subtitles
TAIL = 0.3  # subtitles stay a little after the last word ends
MIN_FLASH = 0.3  # the shortest a subtitle is ever shown, even when the next one starts at once


@dataclass
class Sentence:
    start: float
    end: float
    text: str
    words: list[Word]


def _join(words: list[Word]) -> str:
    """Words keep Whisper's own spacing (a leading space; none in Chinese or Japanese)."""
    return " ".join("".join(w[2] for w in words).split())


def _gap_after(words: list[Word], i: int) -> float:
    return words[i + 1][0] - words[i][1] if i + 1 < len(words) else 0.0


# Words a new subtitle can start with naturally, and that a subtitle should not end with
# (conjunctions, relative pronouns, "that"). Arabic first: Whisper often writes Arabic without
# punctuation, so these and the pauses are what show where a clause begins.
LINK_WORDS = frozenset(
    """
    و ف ثم أو أم بل لكن لكنّ ولكن أن أنّ إن إنّ لأن لأنّ كي حتى إذا إذ عندما بينما حيث كما التي الذي الذين اللذين
    اللتين اللواتي اللاتي ما لما مما بعدما قبل بعد بسبب رغم مع فإن وإن وأن ولأن وعندما وكما والتي والذي
    and but or nor so yet because that which who whom whose when while where if though although unless
    since until after before then than as
    et mais ou donc car que qui quand si parce
    y pero o que porque cuando si aunque
    und aber oder dass weil wenn als
    """.split()
)


def _bare(text: str) -> str:
    return re.sub(r"^\W+|\W+$", "", text.strip().lower())


def _best_break(
    words: list[Word],
    lo: int,
    hi: int,
    target: int | None = None,
    limits: tuple[int, int] | None = None,
    target_weight: float = 1.5,
) -> int:
    """Index after which to break, within [lo, hi).

    Prefers sentence and clause ends, pauses in the speech and the start of a new clause (the
    next word is a link word such as "but" / "لكن"); never ends a part on a link word if it can
    help; stays near `target` characters; and, given `limits` (left, right), avoids sides longer
    than their limit (a soft rule: a slightly long part beats a cut in the wrong place).
    """
    lengths, pos = [], 0
    for w in words:
        pos += len(w[2])
        lengths.append(pos)
    total = lengths[-1] or 1
    candidates = list(range(lo, hi))
    best, best_score = (candidates[-1] if candidates else hi - 1), None
    for i in candidates:
        text = words[i][2].strip()
        nxt = _bare(words[i + 1][2]) if i + 1 < len(words) else ""
        score = 0.0
        if SENTENCE_END.search(text):
            score -= 1.5
        elif CLAUSE_END.search(text):
            score -= 1.0
        score -= min(_gap_after(words, i), 1.0) * 1.5
        if nxt in LINK_WORDS:
            score -= 0.5
        if _bare(text) in LINK_WORDS:
            score += 1.0
        if target is not None:
            score += abs(lengths[i] - target) / total * target_weight
        if limits is not None:  # a part longer than its share costs more the further it goes over
            over = max(0, lengths[i] - limits[0]) + max(0, total - lengths[i] - limits[1])
            score += over / MAX_CUE_CHARS * 4
        if best_score is None or score < best_score:
            best, best_score = i, score
    return best


def split_sentences(words: list[Word]) -> list[list[Word]]:
    """Group a stream of words into sentences."""
    sentences: list[list[Word]] = []
    current: list[Word] = []
    for i, word in enumerate(words):
        current.append(word)
        too_long = current[-1][1] - current[0][0] > MAX_SENTENCE_SECONDS or len(_join(current)) > MAX_SENTENCE_CHARS
        if too_long and len(current) > 1:
            cut = _best_break(current, max(1, len(current) // 3) - 1, len(current) - 1)
            sentences.append(current[: cut + 1])
            current = current[cut + 1 :]
        text = word[2].strip()
        if SENTENCE_END.search(text) is not None or _gap_after(words, i) >= SENTENCE_PAUSE:
            sentences.append(current)
            current = []
    if current:
        sentences.append(current)
    return sentences


def sentences_from_segments(segments: list[tuple]) -> list[Sentence]:
    """Whole sentences from ASR segments. Segments without word timings are kept as they are."""
    out: list[Sentence] = []
    pending: list[Word] = []

    def flush() -> None:
        for group in split_sentences(pending):
            text = _join(group)
            if text:
                out.append(Sentence(group[0][0], group[-1][1], text, group))
        pending.clear()

    for seg in segments:
        words = [w for w in (seg[3] if len(seg) > 3 and seg[3] else []) if w[2].strip()]
        if words:
            pending.extend(words)
        else:
            flush()
            out.append(Sentence(seg[0], seg[1], seg[2], []))
    flush()
    return out


def split_words_for_cues(words: list[Word], translated: str) -> list[list[Word]]:
    """Split a sentence's words into as many subtitles as its translation and duration need."""
    duration = words[-1][1] - words[0][0]
    parts = max(1, -(-len(translated) // MAX_CUE_CHARS), int(-(-duration // MAX_CUE_SECONDS)))
    parts = min(parts, len(words))
    groups: list[list[Word]] = []
    rest = words
    while parts > 1 and len(rest) > 1:
        total = len(_join(rest))
        cut = _best_break(rest, 0, len(rest) - 1, target=total // parts, limits=(MAX_CUE_CHARS, MAX_CUE_CHARS * (parts - 1)))
        groups.append(rest[: cut + 1])
        rest = rest[cut + 1 :]
        parts -= 1
    groups.append(rest)
    # A natural cut (a pause right after the first word, say) can leave one part long in time even
    # when the text is short: split any part still over MAX_CUE_SECONDS again.
    out: list[list[Word]] = []
    for group in groups:
        if len(group) > 1 and group[-1][1] - group[0][0] > MAX_CUE_SECONDS:
            out.extend(_split_by_time(group))
        else:
            out.append(group)
    return out


def _split_by_time(words: list[Word]) -> list[list[Word]]:
    """Halve a run of words at its most natural point until no part is over MAX_CUE_SECONDS."""
    if len(words) < 2 or words[-1][1] - words[0][0] <= MAX_CUE_SECONDS:
        return [words]
    mid = (words[0][0] + words[-1][1]) / 2
    # Stay near the middle in time: only breaks in the middle half of the run are considered.
    lo = next((i for i, w in enumerate(words) if w[1] >= words[0][0] + (mid - words[0][0]) / 2), 0)
    hi = next((i for i, w in enumerate(words) if w[0] >= mid + (words[-1][1] - mid) / 2), len(words) - 1)
    lo = min(lo, len(words) - 2)  # a break after word i, for i in [lo, hi), keeps both sides non-empty
    hi = min(max(hi, lo + 1), len(words) - 1)
    cut = _best_break(words, lo, hi)
    return _split_by_time(words[: cut + 1]) + _split_by_time(words[cut + 1 :])


LONG_RUN = 20  # a "word" this long has no spaces to cut at (Chinese, Japanese, Thai): cut by character


def text_tokens(text: str) -> list[Word]:
    """Cut points of a text: its words, or single characters inside long runs without spaces."""
    tokens: list[Word] = []
    for word in text.split():
        if len(word) > LONG_RUN:
            tokens.append((0.0, 0.0, " " + word[0]))
            tokens.extend((0.0, 0.0, ch) for ch in word[1:])
        else:
            tokens.append((0.0, 0.0, " " + word))
    return tokens


def split_text_like(text: str, groups: list[list[Word]]) -> list[str]:
    """Cut a translation into as many pieces as the speech was cut into, in the same proportions,
    at the most natural places (punctuation, before a link word, never after one)."""
    tokens = text_tokens(text)
    if len(groups) <= 1 or len(tokens) < len(groups):
        return [text]
    sizes = [len(_join(g)) or 1 for g in groups]
    pieces: list[str] = []
    rest = tokens
    for k in range(len(groups) - 1):
        share = sizes[k] / sum(sizes[k:])
        left = len(groups) - k - 1  # pieces still to come after this one
        # The text must stay in step with the speech it is shown over, so distance from the
        # target counts more here than when cutting the speech itself.
        cut = _best_break(
            rest, 0, len(rest) - left,
            target=int(len(_join(rest)) * share),
            limits=(MAX_CUE_CHARS, MAX_CUE_CHARS * left),
            target_weight=4.0,
        )
        pieces.append(_join(rest[: cut + 1]))
        rest = rest[cut + 1 :]
    pieces.append(_join(rest))
    return pieces


def settle_timing(times: list[list[float]], texts: list[str], movable: list[bool] | None = None) -> None:
    """In place: [start, end] pairs (in order) made readable without overlapping the next one.

    A subtitle stays at least until its last word ends (plus a short tail), at least
    MIN_CUE_SECONDS, and long enough to read at READING_CPS; never past MAX_CUE_SECONDS, and never
    into the next subtitle. When two subtitles start almost together (a quick "Oh! No!"), the
    first keeps a short minimum and the next one, if `movable`, starts a moment later.
    """
    movable = movable or [True] * len(times)
    for i, (pair, text) in enumerate(zip(times, texts)):
        start, spoken_end = pair
        wanted = max(spoken_end + TAIL, start + MIN_CUE_SECONDS, start + len(text) / READING_CPS)
        end = min(wanted, start + MAX_CUE_SECONDS)  # a very short translation over long speech
        if i + 1 < len(times):
            nxt = times[i + 1]
            end = min(end, nxt[0] - CUE_GAP)
            if end < start + MIN_FLASH:
                end = start + MIN_FLASH
                if movable[i + 1]:
                    nxt[0] = max(nxt[0], end + CUE_GAP)
                    nxt[1] = max(nxt[1], nxt[0] + MIN_FLASH)
                else:
                    end = max(start + 0.01, min(end, nxt[0]))
        pair[1] = end
