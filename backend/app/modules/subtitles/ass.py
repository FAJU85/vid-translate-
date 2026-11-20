"""Styled subtitles for burning into the picture (Advanced SubStation Alpha).

The video is rendered with ffmpeg's `ass` filter and *complex* shaping (HarfBuzz). Its simple
shaping, which the plain `subtitles` filter uses, turns Arabic lam-alef (لا) into a presentation
form that Noto Sans Arabic lacks, so it was drawn as a square.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from .core import Cue, _wrap
from .sentences import LONG_RUN

RTL_LANGS = {"ar", "fa", "ur", "he", "ps"}

# Font sizes are in script pixels for a 288-pixel-high script (PlayResY), i.e. relative to the
# video height: "medium" is about 6% of the picture height, the size used before styles existed.
SIZES = {"small": 14, "medium": 18, "large": 24, "xlarge": 30}
# Fonts, per writing system: (font family, bold, size scale). libass sizes a font by its full line
# height (OS/2 winAscent + winDescent), not its em. Arabic fonts have tall line metrics (room for
# diacritics): 2.11 em for Noto Sans Arabic, 1.70 Noto Naskh Arabic, 1.90 Noto Kufi Arabic, against
# 1.36 for Noto Sans and Noto Serif. Noto Sans Arabic is scaled by its ratio to Noto Sans (1.55,
# checked against a browser); Naskh and Kufi are scaled so their letters come out as tall as Noto
# Sans Arabic's (Naskh draws smaller letters inside its line), so a size looks the same in every font.
# Every font here is in the Space image (Debian fonts-noto-core); other scripts fall back through
# fontconfig.
FONTS = {
    "modern": {"latin": ("Noto Sans", False, 1.0), "arabic": ("Noto Sans Arabic", False, 1.55)},
    "classic": {"latin": ("Noto Serif", False, 1.0), "arabic": ("Noto Naskh Arabic", False, 1.45)},
    "bold": {"latin": ("Noto Sans", True, 1.0), "arabic": ("Noto Kufi Arabic", True, 1.35)},
}
ARABIC_SCRIPT_SCALE = FONTS["modern"]["arabic"][2]
# Numpad layout: 2 = bottom centre, 5 = middle centre, 8 = top centre.
POSITIONS = {"bottom": 2, "middle": 5, "top": 8}
BACKGROUNDS = ("outline", "box")
# Dynamic captions. none: the whole line at once; highlight: every word lights up as it is spoken;
# pop: a few words at a time, popping in, the spoken one lit (the short-video look).
ANIMATIONS = ("none", "highlight", "pop")
HIGHLIGHT_FALLBACK = "#FFD400"  # the lit word, when the text colour is white
POP_WORDS = 3  # at most this many words on screen in pop mode
POP_CHARS = 18  # ... and at most about this many characters

_HEX = re.compile(r"^#?([0-9a-fA-F]{6})$")
# Emoji and pictographs: no font the renderer can use draws them, so they would become squares.
_EMOJI = re.compile("[\U0001F000-\U0001FAFF\U0001FC00-\U0001FFFF️⃣]")


@dataclass(frozen=True)
class SubtitleStyle:
    size: str = "medium"
    position: str = "bottom"
    color: str = "#FFFFFF"
    background: str = "outline"
    font: str = "modern"
    bilingual: bool = False  # also show the original text, smaller, next to the translation
    voice: str = "female"  # dubbing: the voice that speaks the translation (female / male)
    animation: str = "none"  # dynamic captions (ANIMATIONS)

    @classmethod
    def from_dict(cls, data: dict | None) -> "SubtitleStyle":
        """Build a style from user input; anything unknown or malformed keeps its default."""
        data = data if isinstance(data, dict) else {}
        default = cls()

        def pick(key: str, allowed) -> str:
            value = data.get(key)
            return value if isinstance(value, str) and value in allowed else getattr(default, key)

        color = data.get("color")
        match = _HEX.match(color) if isinstance(color, str) else None
        return cls(
            size=pick("size", SIZES),
            position=pick("position", POSITIONS),
            color=f"#{match.group(1).upper()}" if match else default.color,
            background=pick("background", BACKGROUNDS),
            font=pick("font", FONTS),
            bilingual=data.get("bilingual") is True,
            voice=pick("voice", ("female", "male")),
            animation=pick("animation", ANIMATIONS),
        )

    def to_dict(self) -> dict:
        return {
            "size": self.size,
            "position": self.position,
            "color": self.color,
            "background": self.background,
            "font": self.font,
            "bilingual": self.bilingual,
            "voice": self.voice,
            "animation": self.animation,
        }


def _ass_colour(hex_rgb: str, alpha: int = 0) -> str:
    """#RRGGBB -> &HAABBGGRR (ASS stores blue first; alpha 0 is opaque)."""
    rgb = hex_rgb.lstrip("#")
    return f"&H{alpha:02X}{rgb[4:6]}{rgb[2:4]}{rgb[0:2]}".upper()


def _ass_time(seconds: float) -> str:
    cs = max(0, int(round(seconds * 100)))
    h, cs = divmod(cs, 360_000)
    m, cs = divmod(cs, 6000)
    s, cs = divmod(cs, 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def _ass_text(text: str) -> str:
    """Text safe for an ASS event line: no override blocks, no emoji, explicit line breaks."""
    text = _EMOJI.sub("", text)
    text = text.replace("\\", "⧵").replace("{", "(").replace("}", ")")  # ⧵ looks like a backslash
    return "\\N".join(line.strip() for line in _wrap(text).split("\n"))


Token = tuple[str, bool]  # a word, and whether a space follows it in the text


def _tokens(line: str) -> list[Token]:
    """The words of a line; text written without spaces (Chinese, Japanese) one character at a time.
    Each keeps whether a space followed it, so the line is rebuilt with exactly its own spacing."""
    out: list[Token] = []
    for word in line.split():
        parts = list(word) if len(word) > LONG_RUN else [word]
        out.extend((part, False) for part in parts[:-1])
        out.append((parts[-1], True))
    if out:
        out[-1] = (out[-1][0], False)
    return out


def word_times(words: list[str], start: float, end: float) -> list[tuple[float, float]]:
    """When each word is spoken, estimated: the translation has no timing of its own, so the cue's
    time is shared out by length (a long word takes longer to say), leaving its last moments quiet.
    The website's transcript uses the same rule (web/src/modules/translate/format.ts wordTimes)."""
    span = max(0.0, end - start)
    speech = span - min(0.3, span * 0.15)
    weights = [len(w) + 1 for w in words]
    total = sum(weights) or 1
    times, t = [], start
    for w in weights:
        d = speech * w / total
        times.append((t, t + d))
        t += d
    return times


def _lit_lines(lines: list[list[Token]], lit: int, colour: str) -> str:
    """ASS text of some lines of words with word number `lit` (counted across lines) in `colour`."""
    out, i = [], 0
    for line in lines:
        parts = []
        for k, (word, space) in enumerate(line):
            text = _ass_text(word)
            parts.append(f"{{\\1c{colour}}}{text}{{\\1c}}" if i == lit else text)
            if space and k < len(line) - 1:
                parts.append(" ")
            i += 1
        out.append("".join(parts))
    return "\\N".join(out)


def _pop_chunks(words: list[Token]) -> list[list[Token]]:
    """A cue's words in groups of at most POP_WORDS words and about POP_CHARS characters."""
    chunks: list[list[str]] = [[]]
    for w in words:
        cur = chunks[-1]
        if cur and (len(cur) >= POP_WORDS or len(" ".join(t for t, _ in cur + [w])) > POP_CHARS):
            chunks.append([])
        chunks[-1].append(w)
    return [c for c in chunks if c]


ORIGINAL_SCALE = 0.72  # the original text, in two-language subtitles, is this much smaller
ORIGINAL_COLOUR = "#E2E8F0"


def to_ass(cues: list[Cue], lang: str, style: SubtitleStyle | None = None, src_lang: str | None = None) -> str:
    """Styled subtitles in `lang`; with style.bilingual, the original (in `src_lang`) above them."""
    style = style or SubtitleStyle()
    font, bold, scale = FONTS[style.font]["arabic" if lang in RTL_LANGS else "latin"]
    font_size = round(SIZES[style.size] * scale, 1)
    primary = _ass_colour(style.color if style.animation == "none" else "#FFFFFF")
    if style.background == "box":
        # BorderStyle 4 (libass): one translucent box behind the whole subtitle, drawn in BackColour.
        border_style, outline, back_colour = 4, 0.6, _ass_colour("#000000", 0x60)
    else:
        border_style, outline, back_colour = 1, 1.2, "&H80000000"
    outline_colour = _ass_colour("#000000")
    margin_v = 0 if style.position == "middle" else 22
    # Encoding -1 makes libass take the line's direction from its text. Without it a right-to-left
    # line split by a colour tag (the lit word) is laid out piece by piece from the left: words swap.
    encoding = -1 if style.animation != "none" else 1
    header = "\n".join([
        "[Script Info]",
        "ScriptType: v4.00+",
        "PlayResX: 384",
        "PlayResY: 288",
        "WrapStyle: 0",
        "ScaledBorderAndShadow: yes",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, "
        "Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, "
        "Alignment, MarginL, MarginR, MarginV, Encoding",
        f"Style: Default,{font},{font_size:g},{primary},{primary},{outline_colour},{back_colour},"
        f"{-1 if bold else 0},0,0,0,100,100,0,0,{border_style},{outline},0,{POSITIONS[style.position]},16,16,{margin_v},{encoding}",
        *([_original_style(style, src_lang, border_style, outline, outline_colour, back_colour, margin_v)] if style.bilingual else []),
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ])
    events = []
    for cue in cues:
        text = _ass_text(cue.translation or cue.text)
        if text:
            events.extend(_animated_events(cue, style) if style.animation != "none" else
                          [f"Dialogue: 0,{_ass_time(cue.start)},{_ass_time(cue.end)},Default,,0,0,0,,{text}"])
        original = _ass_text(cue.text) if style.bilingual and cue.translation else ""
        if original and original != text:
            # Written after the translation: libass stacks a later bottom subtitle above an earlier one.
            events.append(f"Dialogue: 0,{_ass_time(cue.start)},{_ass_time(cue.end)},Original,,0,0,0,,{original}")
    return header + "\n" + "\n".join(events) + "\n"


def _original_style(style: SubtitleStyle, src_lang: str | None, border_style, outline, outline_colour, back_colour, margin_v) -> str:
    font, bold, scale = FONTS[style.font]["arabic" if (src_lang or "") in RTL_LANGS else "latin"]
    size = round(SIZES[style.size] * scale * ORIGINAL_SCALE, 1)
    colour = _ass_colour(ORIGINAL_COLOUR)
    return (
        f"Style: Original,{font},{size:g},{colour},{colour},{outline_colour},{back_colour},"
        f"0,0,0,0,100,100,0,0,{border_style},{outline},0,{POSITIONS[style.position]},16,16,{margin_v},1"
    )


def _animated_events(cue: Cue, style: SubtitleStyle) -> list[str]:
    """Dialogue lines for a cue with dynamic captions: one per spoken word, that word lit in the
    chosen colour (yellow when the colour is white) and the others white."""
    clean = _EMOJI.sub("", cue.translation or cue.text)
    lit = _ass_colour(style.color if style.color.upper() != "#FFFFFF" else HIGHLIGHT_FALLBACK)
    if style.animation == "highlight":
        groups = [[line for line in (_tokens(row) for row in _wrap(clean).split("\n")) if line]]
    else:  # pop: the words in small groups, each group on screen only while it is spoken
        groups = [[chunk] for chunk in _pop_chunks(_tokens(clean))]
    words = [w for lines in groups for line in lines for w, _ in line]
    if not words:
        return []
    times = word_times(words, cue.start, cue.end)
    events, i = [], 0
    for g, lines in enumerate(groups):
        count = sum(len(line) for line in lines)
        for k in range(count):
            start = cue.start if i == 0 else times[i][0]
            end = cue.end if i == len(words) - 1 else times[i + 1][0]
            # A new pop group grows in quickly as it appears. Next to the original line it fades in
            # instead: libass places a line by its first size, so a growing one would overlap it.
            pop = "" if style.animation != "pop" or k else (
                "{\\fad(120,0)}" if style.bilingual else "{\\fscx85\\fscy85\\t(0,120,\\fscx100\\fscy100)}")
            events.append(f"Dialogue: 0,{_ass_time(start)},{_ass_time(end)},Default,,0,0,0,,{pop}{_lit_lines(lines, k, lit)}")
            i += 1
    return events
