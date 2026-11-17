"""Styled subtitles for burning into the picture (Advanced SubStation Alpha).

The video is rendered with ffmpeg's `ass` filter and *complex* shaping (HarfBuzz). Its simple
shaping, which the plain `subtitles` filter uses, turns Arabic lam-alef (لا) into a presentation
form that Noto Sans Arabic lacks, so it was drawn as a square.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from .core import Cue, _wrap

RTL_LANGS = {"ar", "fa", "ur", "he", "ps"}

# Font sizes are in script pixels for a 288-pixel-high script (PlayResY), i.e. relative to the
# video height: "medium" is about 6% of the picture height, the size used before styles existed.
SIZES = {"small": 14, "medium": 18, "large": 24, "xlarge": 30}
# libass sizes a font by its full line height (ascent + descent), not its em. Noto Sans Arabic has
# very tall line metrics (room for diacritics), so at the same Fontsize it draws letters at 47% of
# the nominal size where Noto Sans draws 73% (measured against a browser). Arabic-script fonts are
# scaled up by the ratio so every size setting looks the same in every language.
ARABIC_SCRIPT_SCALE = 1.55
# Numpad layout: 2 = bottom centre, 5 = middle centre, 8 = top centre.
POSITIONS = {"bottom": 2, "middle": 5, "top": 8}
BACKGROUNDS = ("outline", "box")

_HEX = re.compile(r"^#?([0-9a-fA-F]{6})$")
# Emoji and pictographs: no font the renderer can use draws them, so they would become squares.
_EMOJI = re.compile("[\U0001F000-\U0001FAFF\U0001FC00-\U0001FFFF️⃣]")


@dataclass(frozen=True)
class SubtitleStyle:
    size: str = "medium"
    position: str = "bottom"
    color: str = "#FFFFFF"
    background: str = "outline"

    @classmethod
    def from_dict(cls, data: dict | None) -> "SubtitleStyle":
        """Build a style from user input; anything unknown or malformed keeps its default."""
        data = data or {}
        default = cls()
        size = data.get("size") if data.get("size") in SIZES else default.size
        position = data.get("position") if data.get("position") in POSITIONS else default.position
        background = data.get("background") if data.get("background") in BACKGROUNDS else default.background
        match = _HEX.match(str(data.get("color") or ""))
        color = f"#{match.group(1).upper()}" if match else default.color
        return cls(size=size, position=position, color=color, background=background)

    def to_dict(self) -> dict:
        return {"size": self.size, "position": self.position, "color": self.color, "background": self.background}


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


def to_ass(cues: list[Cue], lang: str, style: SubtitleStyle | None = None) -> str:
    style = style or SubtitleStyle()
    arabic_script = lang in RTL_LANGS
    font = "Noto Sans Arabic" if arabic_script else "Noto Sans"  # other scripts fall back via fontconfig
    font_size = round(SIZES[style.size] * (ARABIC_SCRIPT_SCALE if arabic_script else 1), 1)
    primary = _ass_colour(style.color)
    if style.background == "box":
        # BorderStyle 4 (libass): one translucent box behind the whole subtitle, drawn in BackColour.
        border_style, outline, back_colour = 4, 0.6, _ass_colour("#000000", 0x60)
    else:
        border_style, outline, back_colour = 1, 1.2, "&H80000000"
    outline_colour = _ass_colour("#000000")
    margin_v = 0 if style.position == "middle" else 22
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
        f"0,0,0,0,100,100,0,0,{border_style},{outline},0,{POSITIONS[style.position]},16,16,{margin_v},1",
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ])
    events = []
    for cue in cues:
        text = _ass_text(cue.translation or cue.text)
        if text:
            events.append(f"Dialogue: 0,{_ass_time(cue.start)},{_ass_time(cue.end)},Default,,0,0,0,,{text}")
    return header + "\n" + "\n".join(events) + "\n"
