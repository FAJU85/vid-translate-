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
