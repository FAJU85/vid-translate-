"""Dub timing, part of the jobs brick: what the voice says, how fast, and where it goes.

Timing lip-sync (isochrony), done mechanically:

1. Each sentence is spoken in ONE take, so its intonation and the way its words are said fit the
   whole sentence (a fragment spoken on its own sounds like a sentence of its own).
2. The voice reports when it says each word. The take is cut between words where the speaker
   paused, and each piece is placed where the speaker said that part, so the dub starts, pauses
   and stops with the speaker.
3. One speaking speed per sentence, chosen so the take lasts about as long as the speaker's own
   speech; neighbouring sentences change speed gradually (RATE_STEP), never in jumps.
4. What is still a little off is fitted by stretching each piece slightly (pitch kept, media
   FIT_SLOWER..FIT_FASTER); only a piece that cannot fit before the next line is sped up more.
5. A translation much shorter than what was said (Arabic into English, often) is not dragged out:
   the voice's own pauses between words (where it breathes, at commas) are made longer instead,
   so it still ends about when the speaker does.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .. import media, subtitles, voice

# A dubbed sentence may run into the pause before the next one, but never into it.
DUB_GAP = 0.08
# ...and a piece stops this long before the speaker's next stretch of speech in the same sentence.
PIECE_GAP = 0.05
# The voice speaks at most this much faster than normal (percent); past that, the track speeds it up.
DUB_MAX_RATE = 35
# ...and at most this much slower, so a short line still lasts as long as the speaker's mouth moves.
DUB_MIN_RATE = -15
# How close to the speaker's own timing a sentence must be to be spoken at normal speed.
FIT_LONG, FIT_SHORT = 1.03, 0.85
# Neighbouring sentences (less than NEAR seconds apart) differ in speed by at most RATE_STEP points.
RATE_STEP = 10
NEAR = 2.0
# Kept around the words of a piece: the start of the first sound, the fall of the last one.
LEAD, TAIL = 0.03, 0.06
# Longer pauses for a short translation: at the voice's own pauses of at least BREATH seconds, at
# most MAX_BREAKS of them per piece, each made at most MAX_PAUSE seconds longer.
BREATH = 0.12
MAX_BREAKS = 4
MAX_PAUSE = 0.6
SLOWEST = media.FIT_SLOWER


@dataclass
class Sentence:
    """One sentence to dub: its text, the speaker's stretches of speech and what is said over each."""

    text: str
    phrases: list[tuple[float, float]]  # (start, end) of each stretch of speech, in order
    pieces: list[str]  # the part of the text said over each stretch (as many as phrases)
    latest_end: float  # when the voice must have stopped: the next sentence


@dataclass
class Piece:
    start: float  # where it goes in the video
    window: float  # how long the speaker spoke there
    latest_end: float  # when it must have stopped
    t0: float  # the stretch of the take
    t1: float


def plan(segments: list, translations: list[str], duration: float) -> list[Sentence]:
    """The sentences to dub, from the recognised sentences and their translations."""
    out: list[Sentence] = []
    for i, (seg, translated) in enumerate(zip(segments, translations)):
        text = subtitles.clean_text(translated) or seg[2]
        phrases = subtitles.spoken_phrases(seg[3], text) if len(seg) > 3 and seg[3] else []
        phrases = phrases or [(seg[0], seg[1], text)]
        nxt = segments[i + 1][0] if i + 1 < len(segments) else max(duration, seg[1])
        out.append(Sentence(
            text=text,
            phrases=[(s, e) for s, e, _t in phrases],
            pieces=[t for _s, _e, t in phrases],
            # at least 0.4 s when there is room, but never past the next sentence's start
            latest_end=max(nxt - DUB_GAP, min(seg[0] + 0.4, nxt)),
        ))
    return out


def fit_rate(length: float, speech: float, room: float) -> int:
    """How much faster (or slower) the voice should speak a sentence of `length` seconds so that it
    lasts as long as the speaker's own `speech`, without running past `room`."""
    if length <= 0 or speech <= 0:
        return 0
    if length > room * FIT_LONG or length > speech * 1.25:
        target = min(room, max(speech, room * 0.9)) if length > room * FIT_LONG else speech * 1.1
        return min(DUB_MAX_RATE, int((length / target - 1) * 100) + 3)
    if length < speech * FIT_SHORT:
        return max(DUB_MIN_RATE, int((length / speech - 1) * 100))
    return 0


def smooth(rates: list[int], sentences: list[Sentence]) -> list[int]:
    """Speeds that change gradually: a sentence close to a faster one is spoken at most RATE_STEP
    points slower than it (it is only ever made faster, so nothing that had to fit stops fitting)."""
    out = list(rates)
    near = [
        sentences[i + 1].phrases[0][0] - sentences[i].phrases[-1][1] < NEAR for i in range(len(sentences) - 1)
    ]
    for _ in range(2):  # forward then backward, so a change spreads both ways
        for i in range(1, len(out)):
            if near[i - 1]:
                out[i] = max(out[i], out[i - 1] - RATE_STEP)
        for i in range(len(out) - 2, -1, -1):
            if near[i]:
                out[i] = max(out[i], out[i + 1] - RATE_STEP)
    return [min(DUB_MAX_RATE, r) for r in out]


def _letters(text: str) -> int:
    return sum(ch.isalnum() for ch in text)


def _word_groups(said: list[tuple[float, float, str]], pieces: list[str]) -> list[tuple[int, int]] | None:
    """Which of the voice's words belong to each piece, [(first, last)], by the share of letters
    each piece has; None when there are fewer words than pieces."""
    n, m = len(pieces), len(said)
    if n == 1 or m < n:
        return None
    total = sum(_letters(p) for p in pieces) or 1
    cumulative, run = [], 0
    for _s, _e, word in said:
        run += max(1, _letters(word))
        cumulative.append(run)
    scale = cumulative[-1] / total
    groups, first, share = [], 0, 0
    for k in range(n - 1):
        share += _letters(pieces[k])
        # the last word of piece k: as close to its share as possible, leaving a word for each later piece
        candidates = range(first, m - (n - k - 1))
        last = min(candidates, key=lambda j: abs(cumulative[j] - share * scale))
        groups.append((first, last))
        first = last + 1
    groups.append((first, m - 1))
    return groups


def layout(sentence: Sentence, take: Path, said: list[tuple[float, float, str]]) -> list[Piece]:
    """Where the stretches of a sentence's take go: each piece over the speaker's stretch of speech
    it translates, or the whole take over the whole sentence when it cannot be cut by words."""
    groups = _word_groups(said, sentence.pieces) if len(sentence.phrases) > 1 else None
    if not groups:
        if said:
            t0, t1 = said[0][0], said[-1][1]
        else:  # no word timing (eSpeak NG): the sound itself, without the silence around it
            t0, t1 = media.speech_bounds(take)
        start, end = sentence.phrases[0][0], sentence.phrases[-1][1]
        return [Piece(start, end - start, sentence.latest_end, max(0.0, t0 - LEAD), t1 + TAIL)]
    out = []
    for k, (a, b) in enumerate(groups):
        start, end = sentence.phrases[k]
        latest = sentence.phrases[k + 1][0] - PIECE_GAP if k + 1 < len(groups) else sentence.latest_end
        t0 = max(0.0, said[a][0] - LEAD, out[-1].t1 if out else 0.0)
        t1 = said[b][1] + TAIL
        if b + 1 < len(said):
            t1 = min(t1, said[b + 1][0])
        out.append(Piece(start, end - start, max(start + 0.05, latest), t0, t1))
    return out


def breathe(piece: Piece, said: list[tuple[float, float, str]]) -> list[Piece]:
    """A piece much shorter than the speaker's speech, split at the voice's own pauses, each made
    longer (up to MAX_PAUSE), so it ends about when the speaker does instead of long before."""
    spoken = (piece.t1 - piece.t0) / SLOWEST  # as slow as a piece is ever played
    missing = piece.window - spoken
    inside = [i for i, w in enumerate(said) if piece.t0 <= w[0] and w[1] <= piece.t1]
    if missing < 0.4 or len(inside) < 2:
        return [piece]
    gaps = [(said[j + 1][0] - said[j][1], j) for j in inside[:-1] if said[j + 1][0] - said[j][1] >= BREATH]
    breaks = sorted(j for _gap, j in sorted(gaps, reverse=True)[: min(MAX_BREAKS, int(missing / 0.2))])
    if not breaks:
        return [piece]
    extra = min(MAX_PAUSE, missing / len(breaks))
    cuts = [piece.t0, *[(said[j][1] + said[j + 1][0]) / 2 for j in breaks], piece.t1]
    out: list[Piece] = []
    at = piece.start
    for k, (t0, t1) in enumerate(zip(cuts, cuts[1:])):
        window = (t1 - t0) / SLOWEST
        out.append(Piece(at, window, piece.latest_end, t0, t1))
        at += window + extra
    # each part may run until the next part starts, the last one until the piece's own end
    return [Piece(p.start, p.window, (out[k + 1].start - PIECE_GAP) if k + 1 < len(out) else p.latest_end, p.t0, p.t1)
            for k, p in enumerate(out)]


def sentence_rate(pieces: list[Piece]) -> int:
    """The speed a sentence's take needs, from how its pieces compare with the speaker's timing."""
    length = sum(p.t1 - p.t0 for p in pieces)
    speech = sum(max(0.2, p.window) for p in pieces)
    room = sum(max(0.2, p.latest_end - p.start) for p in pieces)
    return fit_rate(length, speech, room)


def track_pieces(pieces: list[Piece], take: Path) -> list[media.DubPiece]:
    """The pieces as placed on the dub track, with the short ones given longer pauses."""
    said = voice.words(take)
    placed = [part for p in pieces for part in breathe(p, said)]
    return [media.DubPiece(p.start, p.latest_end, take, p.t0, p.t1, max(0.2, p.window)) for p in placed]


def takes_layout(sentences: list[Sentence], takes: list[Path | None]) -> list[list[Piece]]:
    return [layout(s, t, voice.words(t)) if t else [] for s, t in zip(sentences, takes, strict=True)]
