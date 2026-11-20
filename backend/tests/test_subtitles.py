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
    # Wrong types (only possible on a direct /invoke call) fall back too instead of raising.
    assert SubtitleStyle.from_dict({"size": [], "position": {}, "color": 5, "font": None}) == SubtitleStyle()
    assert SubtitleStyle.from_dict(["not", "a", "dict"]) == SubtitleStyle()
    style = SubtitleStyle.from_dict({"size": "large", "position": "top", "color": "ffcc00", "background": "box", "font": "bold"})
    assert style.to_dict() == {
        "size": "large", "position": "top", "color": "#FFCC00", "background": "box", "font": "bold", "bilingual": False, "voice": "female",
    }
    assert SubtitleStyle.from_dict({"bilingual": "yes"}).bilingual is False  # only a real true turns it on


def test_to_ass_fonts_per_writing_system():
    cues = [Cue(1, 0, 1, "a", "b")]
    expected = {
        ("modern", "en"): ("Noto Sans", "18", "0"),
        ("modern", "ar"): ("Noto Sans Arabic", "27.9", "0"),
        ("classic", "en"): ("Noto Serif", "18", "0"),
        ("classic", "ar"): ("Noto Naskh Arabic", "26.1", "0"),
        ("bold", "en"): ("Noto Sans", "18", "-1"),
        ("bold", "fa"): ("Noto Kufi Arabic", "24.3", "-1"),
    }
    for (font, lang), (family, size, bold) in expected.items():
        fields = _style_line(to_ass(cues, lang, SubtitleStyle.from_dict({"font": font})))
        assert (fields[1], fields[2], fields[7]) == (family, size, bold), (font, lang)


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


# ---------------------------------------------------------------- sentence-aware subtitles

from app.modules.subtitles import sentences


def words_of(text: str, start: float, step: float = 0.4) -> list:
    """Words spoken one after another, each `step` seconds long."""
    out = []
    for i, w in enumerate(text.split()):
        out.append((start + i * step, start + (i + 1) * step, " " + w))
    return out


def seg(words: list) -> tuple:
    return (words[0][0], words[-1][1], "".join(w[2] for w in words), words)


def test_a_sentence_split_across_two_asr_segments_is_joined():
    a = words_of("Today we are going", 0.0)
    b = words_of("to talk about subtitles. Then", a[-1][1])
    out = subtitles.sentence_segments([seg(a), seg(b)])
    assert [s[2] for s in out] == ["Today we are going to talk about subtitles.", "Then"]
    assert out[0][0] == 0.0 and out[1][0] == b[-1][0]


def test_sentences_end_at_arabic_punctuation_and_long_pauses():
    w = words_of("هل أنت مستعد؟ نعم", 0.0) + words_of("بعد الصمت", 10.0)
    out = subtitles.sentence_segments([seg(w)])
    assert [s[2] for s in out] == ["هل أنت مستعد؟", "نعم", "بعد الصمت"]


def test_very_long_unpunctuated_speech_is_cut_at_a_pause():
    w = words_of("one two three four five six seven eight nine ten", 0.0, step=1.0)
    w += words_of("eleven twelve thirteen fourteen fifteen", w[-1][1] + 0.6, step=1.0)
    out = subtitles.sentence_segments([seg(w)])
    assert len(out) == 2 and out[0][2].endswith("ten")  # cut at the 0.6 s pause


def test_chinese_words_are_joined_without_spaces():
    w = [(0.0, 0.3, "你"), (0.3, 0.6, "好"), (0.6, 0.9, "。")]
    assert subtitles.sentence_segments([seg(w)])[0][2] == "你好。"


def test_long_sentence_splits_at_the_comma_and_is_timed_from_its_words():
    src = "When the meeting finished late in the evening, everyone went home and slept for a very long time."
    w = words_of(src, 5.0)
    tgt = "عندما انتهى الاجتماع في وقت متأخر من المساء، عاد الجميع إلى منازلهم وناموا لفترة طويلة جداً جداً."
    cues = subtitles.build_cues([seg(w)], [tgt])
    assert len(cues) == 2
    assert cues[0].text.endswith("evening,") and cues[1].text.startswith("everyone")
    assert cues[0].start == 5.0 and cues[1].start == w[8][0]  # second cue starts with "everyone"
    assert cues[0].end <= cues[1].start - sentences.CUE_GAP + 1e-9
    assert " ".join(c.translation for c in cues) == tgt


def test_short_subtitles_stay_long_enough_to_read_but_never_overlap():
    a = words_of("Hi.", 0.0, step=0.2)  # 0.2 s of speech
    b = words_of("This next subtitle starts soon after.", 0.7)
    cues = subtitles.build_cues([seg(a), seg(b)], ["مرحبا.", "يبدأ هذا السطر التالي بعد قليل."])
    assert cues[0].end > a[-1][1]  # held on screen after the word
    assert cues[0].end <= cues[1].start - sentences.CUE_GAP + 1e-9  # but not into the next one
    last = cues[1]
    assert last.end - last.start >= len(last.translation) / sentences.READING_CPS - 1e-9


def test_segments_without_word_timings_still_work():
    out = subtitles.sentence_segments([(0.0, 2.0, "plain segment")])
    assert out == [(0.0, 2.0, "plain segment")]
    cues = subtitles.build_cues(out, ["نص"])
    assert (cues[0].start, cues[0].end) == (0.0, 2.0)


def test_a_part_still_too_long_after_the_natural_cut_is_split_again():
    # The comma is the natural cut, but it leaves the first part far over two lines.
    src = ("However those who knew the sea and its ships and its harbours very well saw plainly "
           "that nothing had happened to the vessel herself, for she sailed well.")
    w = words_of(src, 0.0, step=0.3)
    tgt = ("ومع ذلك فإن الذين يعرفون البحر وسفنه وموانئه جيداً رأوا بوضوح أنه لم يحدث شيء "
           "للسفينة نفسها على الإطلاق في تلك الرحلة الطويلة، لأنها أبحرت جيداً.")
    cues = subtitles.build_cues([seg(w)], [tgt])
    assert all(len(c.translation) <= sentences.MAX_CUE_CHARS for c in cues)
    assert " ".join(c.translation for c in cues) == tgt
    assert all(a.end <= b.start for a, b in zip(cues, cues[1:]))


def test_subtitles_starting_almost_together_never_overlap():
    segs = [(0.0, 0.3, "Oh! No!", [(0.0, 0.1, " Oh!"), (0.1, 0.3, " No!")])]
    cues = subtitles.build_cues(subtitles.sentence_segments(segs), ["آه!", "لا!"])
    assert len(cues) == 2
    assert cues[0].end <= cues[1].start - sentences.CUE_GAP + 1e-9
    assert cues[0].end - cues[0].start >= sentences.MIN_FLASH - 1e-9


def test_no_subtitle_lasts_longer_than_the_limit_even_with_a_short_translation():
    w = [(0.0, 0.5, " Well,")] + [(1.2 + i * 0.5, 1.7 + i * 0.5, " word") for i in range(18)]
    cues = subtitles.build_cues([(0.0, 10.2, "x", w)], ["حسنا، كلام قصير جدا هنا"])
    assert all(c.end - c.start <= sentences.MAX_CUE_SECONDS + 1e-9 for c in cues)
    assert all(a.end <= b.start for a, b in zip(cues, cues[1:]))


def test_translations_without_spaces_are_cut_by_character():
    w = [(i * 0.3, i * 0.3 + 0.3, " word") for i in range(30)]
    text = "这是一个很长的句子" * 13  # 117 characters, no spaces
    cues = subtitles.build_cues([(0.0, 9.0, "x", w)], [text])
    assert len(cues) >= 2
    assert all(len(c.translation) <= sentences.MAX_CUE_CHARS for c in cues)
    assert "".join(c.translation for c in cues) == text



def test_two_language_subtitles():
    cues = [subtitles.Cue(1, 0.0, 2.0, "Good morning", "صباح الخير"), subtitles.Cue(2, 5.0, 6.0, "Same", "Same")]
    srt = subtitles.to_bilingual_srt(cues)
    assert "1\n00:00:00,000 --> 00:00:02,000\nصباح الخير\nGood morning\n" in srt
    assert "Same\nSame" not in srt  # identical lines are not repeated
    ass = subtitles.to_ass(cues, "ar", SubtitleStyle(bilingual=True), "en")
    styles = [l for l in ass.splitlines() if l.startswith("Style: ")]
    assert len(styles) == 2 and styles[1].split(",")[1] == "Noto Sans"  # original in its own script's font
    lines = [l for l in ass.splitlines() if l.startswith("Dialogue")]
    assert lines[0].endswith(",Default,,0,0,0,,صباح الخير") and lines[1].endswith(",Original,,0,0,0,,Good morning")
    assert len(lines) == 3  # no second line where original and translation are the same
    assert "Original" not in subtitles.to_ass(cues, "ar", SubtitleStyle(), "en").split("[Events]")[1]


def test_transcript_has_both_languages_in_paragraphs():
    cues = [
        subtitles.Cue(1, 0.0, 1.0, "One.", "واحد."),
        subtitles.Cue(2, 1.2, 2.0, "Two.", "اثنان."),
        subtitles.Cue(3, 6.0, 7.0, "Three.", "ثلاثة."),
    ]
    text = subtitles.to_transcript(cues, "en", "ar")
    assert text.startswith("Original (en)\n\nOne. Two.\n\nThree.")
    assert "Translation (ar)\n\nواحد. اثنان.\n\nثلاثة." in text
