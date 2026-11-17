from app.modules import subtitles
from app.modules.subtitles import core as subtitles_core


def test_clean_segments_drops_empty_and_normalises():
    out = subtitles.clean_segments([(0, 1, "  hello   world "), (1, 2, "   "), (2, 2.1, "x")])
    assert [s[2] for s in out] == ["hello world", "x"]
    assert out[1][1] >= 2 + subtitles_core.MIN_CUE_SECONDS


def test_build_cues_keeps_short_segments_whole():
    cues = subtitles.build_cues([(0.0, 3.0, "I have a dream")], ["لدي حلم"])
    assert len(cues) == 1
    assert (cues[0].text, cues[0].translation) == ("I have a dream", "لدي حلم")


def test_build_cues_splits_long_segments_and_preserves_timing():
    src = "one two three four five six seven eight nine ten eleven twelve"
    tgt = "واحد اثنان ثلاثة أربعة خمسة ستة سبعة ثمانية تسعة عشرة أحد عشر"
    cues = subtitles.build_cues([(10.0, 30.0, src)], [tgt])
    assert len(cues) == 3
    assert cues[0].start == 10.0 and abs(cues[-1].end - 30.0) < 1e-6
    assert all(a.end == b.start for a, b in zip(cues, cues[1:]))
    assert " ".join(c.translation for c in cues) == tgt
    assert " ".join(c.text for c in cues) == src
    assert [c.index for c in cues] == [1, 2, 3]


def test_srt_and_vtt_format():
    cues = subtitles.build_cues([(1.2, 3725.004, "hi")], ["مرحبا"])
    cues[0].end = 3725.004
    srt = subtitles.to_srt(cues)
    assert srt.startswith("1\n00:00:01,200 --> 01:02:05,004\nمرحبا\n")
    vtt = subtitles.to_vtt(cues)
    assert vtt.startswith("WEBVTT\n\n1\n00:00:01.200 --> 01:02:05.004\n")
    assert subtitles.to_srt(cues, use_translation=False).endswith("hi\n")


def test_wrap_two_lines():
    wrapped = subtitles_core._wrap("a" * 30 + " " + "b" * 30)
    assert wrapped.count("\n") == 1


# --- text cleaning and burned-in (ASS) subtitles -------------------------------------------

from app.modules.subtitles import Cue, SubtitleStyle, clean_text, to_ass


def test_clean_text_removes_characters_that_render_as_squares():
    assert clean_text("نص� غريب و <unk> هنا\x07") == "نص غريب و هنا"
    assert clean_text("  مرحباً   بكم ") == "مرحباً بكم"


def test_style_from_dict_keeps_defaults_for_bad_input():
    assert SubtitleStyle.from_dict(None) == SubtitleStyle()
    style = SubtitleStyle.from_dict({"size": "huge", "position": "left", "color": "red", "background": "x"})
    assert style == SubtitleStyle()
    style = SubtitleStyle.from_dict({"size": "large", "position": "top", "color": "ffcc00", "background": "box"})
    assert style.to_dict() == {"size": "large", "position": "top", "color": "#FFCC00", "background": "box"}


def _style_line(ass: str) -> list[str]:
    line = next(l for l in ass.splitlines() if l.startswith("Style: Default,"))
    return line[len("Style: "):].split(",")


def test_to_ass_uses_the_arabic_font_and_default_style():
    ass = to_ass([Cue(1, 0.0, 2.5, "Hello", "السلام عليكم")], "ar")
    fields = _style_line(ass)
    assert fields[1] == "Noto Sans Arabic" and fields[2] == "27.9"  # medium (18) x Arabic-script scale
    assert fields[3] == "&H00FFFFFF"                                 # white text
    assert fields[15] == "1" and fields[18] == "2"                   # outline, bottom centre
    assert "Dialogue: 0,0:00:00.00,0:00:02.50,Default,,0,0,0,,السلام عليكم" in ass


def test_to_ass_applies_size_position_colour_and_box():
    style = SubtitleStyle.from_dict({"size": "xlarge", "position": "top", "color": "#FFCC00", "background": "box"})
    fields = _style_line(to_ass([Cue(1, 0, 1, "a", "b")], "en", style))
    assert fields[1] == "Noto Sans" and fields[2] == "30"
    assert fields[3] == "&H0000CCFF"                                 # #FFCC00 as &HAABBGGRR
    assert fields[15] == "4" and fields[18] == "8"                   # one box per subtitle, top centre
    assert fields[6] == "&H60000000"                                 # translucent black box


def test_to_ass_text_is_safe_and_wrapped():
    long_text = "كلمة " * 20 + "{\\b1}نص 😀👍"
    ass = to_ass([Cue(1, 0, 3, "x", long_text)], "ar")
    dialogue = ass.strip().splitlines()[-1]
    assert "\\N" in dialogue                        # two lines
    assert "{" not in dialogue and "😀" not in dialogue and "👍" not in dialogue
