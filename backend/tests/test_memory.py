"""Translation memory: learned sentences and glossary terms decide before the model does."""
import pytest

from app.modules.translation import Memory, core
from app.modules.translation.memory import norm

PAYLOAD = {
    "sentences": [
        {"src": "en", "source": "Welcome back to the channel!", "translation": "أهلاً بعودتكم إلى القناة!"},
        {"src": "ar", "source": "السلام عليكم", "translation": "Peace be upon you"},
    ],
    "terms": [
        {"src": "en", "source": "KAVOX", "translation": "كافوكس"},
        {"src": "en", "source": "KAVOX Pro", "translation": "كافوكس برو"},
        {"src": "en", "source": "Riyadh", "translation": "الرياض"},
    ],
}


@pytest.fixture
def model(monkeypatch):
    """The local model, replaced by a recorder that 'translates' by tagging the text."""
    seen = []

    def fake(texts, src, tgt, progress):
        seen.append(list(texts))
        return [f"<{t}>" for t in texts]

    monkeypatch.setattr(core, "_nllb_translate", fake)
    return seen


def test_texts_are_compared_without_case_punctuation_or_diacritics():
    assert norm("Welcome back, to the CHANNEL!!") == norm("welcome back to the channel")
    assert norm("السَّلامُ عَلَيْكُم") == norm("السلام عليكم") == norm("الســلام عليكم")


def test_a_remembered_sentence_is_not_sent_to_the_model(model):
    memory = Memory.from_payload(PAYLOAD, "en")
    out, engine = core.translate_texts(["welcome back to the channel", "Something new."], "en", "ar", lambda f: None, memory)
    assert out == ["أهلاً بعودتكم إلى القناة!", "<Something new.>"]
    assert model == [["Something new."]] and engine == "memory+nllb"


def test_entries_of_another_source_language_are_ignored():
    assert Memory.from_payload(PAYLOAD, "fr").sentence("السلام عليكم") is None
    assert Memory.from_payload(PAYLOAD, "ar").sentence("السلام عليكم") == "Peace be upon you"


def test_glossary_terms_keep_their_fixed_translation(model):
    memory = Memory.from_payload(PAYLOAD, "en")
    out, _ = core.translate_texts(["Try kavox pro in Riyadh today."], "en", "ar", lambda f: None, memory)
    # The longest term wins ("KAVOX Pro", not "KAVOX"), any letter case, whole words only.
    assert model == [["Try ZQX1 in ZQX2 today."]]
    assert out == ["<Try كافوكس برو in الرياض today.>"]
    assert memory.protect("KAVOXIAN news")[1] == []  # not inside another word


def test_a_lost_placeholder_falls_back_to_the_plain_text(monkeypatch):
    calls = []

    def lossy(texts, src, tgt, progress):
        calls.append(list(texts))
        return ["translated without the placeholder" if "ZQX" in t else f"<{t}>" for t in texts]

    monkeypatch.setattr(core, "_nllb_translate", lossy)
    memory = Memory.from_payload(PAYLOAD, "en")
    out, _ = core.translate_texts(["Hello from Riyadh."], "en", "ar", lambda f: None, memory)
    assert calls == [["Hello from ZQX1."], ["Hello from Riyadh."]]
    assert out == ["<Hello from Riyadh.>"]


def test_no_memory_means_the_model_translates_everything(model):
    out, engine = core.translate_texts(["One.", "Two."], "en", "ar", lambda f: None)
    assert out == ["<One.>", "<Two.>"] and engine == "nllb"


@pytest.mark.parametrize("bad", [None, {}, {"sentences": [{"source": "x"}], "terms": [{"translation": "y"}, "z"]}])
def test_a_missing_or_broken_payload_is_an_empty_memory(bad):
    assert not Memory.from_payload(bad, "en")


def test_a_glossary_term_matches_with_or_without_arabic_diacritics():
    memory = Memory.from_payload({"terms": [{"src": "ar", "source": "الرياض", "translation": "Riyadh"}]}, "ar")
    for text in ["زرت الرِّياض اليوم", "زرت الرياض اليوم", "زرت الريـاض اليوم"]:
        protected, slots = memory.protect(text)
        assert protected == "زرت ZQX1 اليوم" and slots == ["Riyadh"], text


def test_only_the_exact_placeholders_are_accepted():
    memory = Memory()
    assert memory.restore("Hello ZQX1", ["X"]) == "Hello X"
    assert memory.restore("Hello ZQX10", ["X"]) is None  # not ZQX1
    assert memory.restore("ZQX1 and ZQX1", ["X"]) is None  # doubled
    assert memory.restore("ZQX2 then ZQX1", ["A", "B"]) == "B then A"


def test_a_rule_learned_from_the_text_as_recognised_still_matches_after_clean_up(model):
    payload = {"sentences": [{"src": "ar", "source": "ألف كيلو متر", "translation": "a thousand kilometres"}]}
    out, engine = core.translate_texts(["ألف كيلو متر"], "ar", "en", lambda f: None, Memory.from_payload(payload, "ar"))
    assert out == ["a thousand kilometres"] and engine == "memory"


def test_spacing_vowel_signs_keep_words_apart():
    # Devanagari: कल (tomorrow) and काल (time) differ only by a spacing vowel sign (Mc), kept.
    assert norm("कल") != norm("काल")


def test_a_dub_says_what_the_corrected_subtitles_say():
    from app.modules.jobs import pipeline
    from app.modules.subtitles import Cue

    segments = [(0.0, 4.0, "a b"), (5.0, 8.0, "c")]
    cues = [Cue(1, 0.0, 2.0, "a", "ONE"), Cue(2, 2.0, 4.0, "b", "TWO fixed"), Cue(3, 5.0, 8.0, "c", "THREE")]
    assert pipeline._sentences_from_cues(segments, cues, ["old", "old"]) == ["ONE TWO fixed", "THREE"]


# --- speech fixes ------------------------------------------------------------------------------

FIXES = {"fixes": [
    {"src": "ar", "source": "واشنطر", "translation": "واشنطن"},
    {"src": "ar", "source": "كا فوكس", "translation": "كافوكس"},
    {"src": "en", "source": "cavox", "translation": "KAVOX"},
]}


def test_fixes_keep_to_their_language():
    ar = Memory.from_payload(FIXES, "ar")
    assert len(ar.fixes) == 2 and bool(ar)
    assert ar.fix_text("وصل إلى واشنطر اليوم") == ("وصل إلى واشنطن اليوم", 1)
    en = Memory.from_payload(FIXES, "en")
    assert en.fix_text("Welcome to Cavox.") == ("Welcome to KAVOX.", 1)
    assert en.fix_text("cavoxes") == ("cavoxes", 0)  # whole words only


def test_fix_segments_keep_word_timing():
    memory = Memory.from_payload(FIXES, "ar")
    words = [(0.0, 0.5, " مرحبا"), (0.5, 0.8, " كا"), (0.8, 1.2, " فوكس"), (1.2, 1.6, " اليوم")]
    seg = (0.0, 1.6, "مرحبا كا فوكس اليوم", words)
    (out,), n = memory.fix_segments([seg])
    assert n == 1
    assert out[2] == "مرحبا كافوكس اليوم"
    assert out[3] == [(0.0, 0.5, " مرحبا"), (0.5, 1.2, " كافوكس"), (1.2, 1.6, " اليوم")]
    plain, n = memory.fix_segments([(0.0, 1.0, "في واشنطر")])
    assert n == 1 and plain[0][2] == "في واشنطن"
    untouched = [(0.0, 1.0, "لا شيء هنا", [])]
    assert memory.fix_segments(untouched) == (untouched, 0)


def test_hotwords_are_the_right_words():
    assert Memory.from_payload(FIXES, "ar").hotwords() == "كافوكس واشنطن"
    assert Memory.from_payload(None, "ar").hotwords() is None


def test_pronunciation_rules_change_only_what_the_voice_says():
    payload = {"say": [{"src": "ar", "source": "علم", "translation": "عَلَم"}, {"src": "ar", "source": "KAVOX", "translation": "كافوكس"}]}
    memory = Memory.from_payload(payload, "en", "ar")
    assert memory.pronounce("رفع العلم وعلم kavox اليوم، علم.") == "رفع العلم وعلم كافوكس اليوم، عَلَم."
    assert Memory.from_payload(payload, "en", "fr").pronounce("KAVOX") == "KAVOX"  # another language's rules
    assert Memory.from_payload(payload, "en").pronounce("KAVOX") == "KAVOX"


# --- which model translates ------------------------------------------------------------------

def test_pairs_with_an_opus_model_use_it_and_others_use_nllb(monkeypatch):
    from app.modules.translation import opus

    used = []
    monkeypatch.setattr(core, "_nllb_translate", lambda texts, s, t, p: used.append(("nllb", s, t)) or [f"N:{x}" for x in texts])
    monkeypatch.setattr(opus, "translate", lambda texts, s, t, p, tidy: used.append(("opus", s, t)) or [f"O:{x}" for x in texts]
                        if (s, t) in opus.PAIRS else None)
    assert core.translate_texts(["Hi."], "en", "ar", lambda f: None) == (["O:Hi."], "opus-mt")
    assert core.translate_texts(["Salut."], "fr", "ar", lambda f: None) == (["N:Salut."], "nllb")
    memory = Memory.from_payload(PAYLOAD, "en")
    out, engine = core.translate_texts(["welcome back to the channel", "New."], "en", "ar", lambda f: None, memory)
    assert engine == "memory+opus-mt" and out[1] == "O:New."


def test_without_its_model_files_a_pair_falls_back_to_nllb(tmp_path, monkeypatch):
    from app.modules.translation import opus

    monkeypatch.setattr(opus.config, "OPUS_DIR", str(tmp_path))
    monkeypatch.setattr(opus, "_broken", set())
    assert not opus.available("en", "ar")
    (tmp_path / "opus-mt-tc-big-en-ar").mkdir()
    (tmp_path / "opus-mt-tc-big-en-ar" / "model.bin").write_bytes(b"not a model")
    assert opus.available("en", "ar")
    # a model that cannot be loaded is set aside, and NLLB translates instead
    assert opus.translate(["Hi."], "en", "ar", lambda f: None, str) is None
    assert not opus.available("en", "ar")
    monkeypatch.setattr(opus.config, "OPUS_ENABLED", False)
    assert not opus.available("en", "fr")


def test_each_model_gets_a_placeholder_it_copies():
    memory = Memory.from_payload(PAYLOAD, "en")
    text, slots = memory.protect("Try kavox pro in Riyadh today.", "XQ")
    assert text == "Try XQ1 in XQ2 today."
    assert memory.restore("جرب XQ1 في XQ2 اليوم.", slots, "XQ") == "جرب كافوكس برو في الرياض اليوم."
    assert memory.restore("جرب ⁇X1 في XQ2 اليوم.", slots, "XQ") is None  # lost: translated again without it
    assert memory.restore("Try XQ1 at MAXQ2 store and XQ2.", slots, "XQ") is not None  # "MAXQ2" is no placeholder
